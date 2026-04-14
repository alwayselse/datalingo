import hashlib
import json
import os
import re
import mimetypes
import tempfile
import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import List, Optional, Tuple

try:
    from google import genai as google_genai
except Exception:
    google_genai = None

import google.generativeai as genai
import httpx
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from langextract import extract as langextract_extract
from psycopg2.extras import RealDictCursor
from pydantic import BaseModel
from qdrant_client import models as qmodels
from qdrant_client.models import Distance, PointStruct, VectorParams

from app.api.auth import get_current_user
from app.core.config import BA_UPLOAD_DIR, EMBEDDING_SERVICE_URL, GEMINI_API_KEY, GEMINI_MODEL
from app.core.db import get_db, get_pg_pool, qdrant_client

router = APIRouter(prefix="/ba/documents", tags=["ba-documents"])

SUPPORTED_EXTENSIONS = {".pdf", ".docx", ".txt", ".jpg", ".jpeg", ".png", ".webp"}
UPLOAD_BASE_DIR = BA_UPLOAD_DIR
GEMINI_MODEL_NAME = GEMINI_MODEL
GEMINI_UPLOAD_MAX_BYTES = 20 * 1024 * 1024

ALLOWED_MIME_TYPES = {
    "application/pdf",
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/webp",
    "image/gif",
    "text/plain",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}


class DocumentSection(BaseModel):
    section_title: Optional[str] = None
    content: str
    page_number: Optional[int] = None
    has_table: bool = False
    has_formula: bool = False


class ExtractedDocument(BaseModel):
    document_title: Optional[str] = None
    summary: str
    sections: List[DocumentSection]
    key_terms: List[str]


def _sanitize_filename(filename: str) -> str:
    base = filename.strip().replace(" ", "_")
    base = re.sub(r"[^A-Za-z0-9._-]", "", base)
    return base or "document"


def _resolve_upload_path(user_id: str) -> Path:
    preferred = Path(UPLOAD_BASE_DIR) / str(user_id)
    fallback = Path.cwd() / "uploads" / "ba" / str(user_id)

    for candidate in (preferred, fallback):
        try:
            candidate.mkdir(parents=True, exist_ok=True)
            return candidate
        except Exception:
            continue

    raise HTTPException(status_code=500, detail="Unable to create upload directory")


def _get_or_create_owned_session(session_id: str, user_id: str, db) -> str:
    with db.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(
            """
            SELECT id, user_id
            FROM chat_sessions
            WHERE id = %s::uuid
            """,
            (session_id,),
        )
        existing = cur.fetchone()
        if existing:
            if str(existing["user_id"]) != user_id:
                raise HTTPException(status_code=404, detail="Session not found")
            return session_id

        cur.execute(
            """
            INSERT INTO chat_sessions (id, user_id, title)
            VALUES (%s::uuid, %s::uuid, %s)
            """,
            (session_id, user_id, "Document upload"),
        )
        db.commit()
    return session_id


def _ensure_session_memory_column(db) -> None:
    with db.cursor() as cur:
        cur.execute(
            """
            ALTER TABLE chat_sessions
            ADD COLUMN IF NOT EXISTS session_memory jsonb DEFAULT '{}'::jsonb
            """
        )
        db.commit()


def _extract_collection_vector_size(collection_name: str) -> Optional[int]:
    try:
        info = qdrant_client.get_collection(collection_name)
        params = getattr(getattr(info, "config", None), "params", None)
        vectors = getattr(params, "vectors", None)

        if isinstance(vectors, dict):
            first = next(iter(vectors.values()), None)
            return int(getattr(first, "size", 0) or 0) or None

        size = int(getattr(vectors, "size", 0) or 0)
        return size or None
    except Exception:
        return None


def _resolve_personal_collection(collection_name: str, vector_size: int) -> str:
    existing = qdrant_client.get_collections()
    names = [c.name for c in existing.collections]

    if collection_name not in names:
        qdrant_client.create_collection(
            collection_name=collection_name,
            vectors_config=VectorParams(size=vector_size, distance=Distance.COSINE),
        )
        return collection_name

    existing_size = _extract_collection_vector_size(collection_name)
    if existing_size is None or existing_size == vector_size:
        return collection_name

    alt_collection_name = f"{collection_name}_v{vector_size}"
    if alt_collection_name not in names:
        qdrant_client.create_collection(
            collection_name=alt_collection_name,
            vectors_config=VectorParams(size=vector_size, distance=Distance.COSINE),
        )
    return alt_collection_name


def _delete_existing_doc_points(collection_name: str, doc_id: str) -> None:
    doc_filter = qmodels.Filter(
        must=[
            qmodels.FieldCondition(
                key="doc_id",
                match=qmodels.MatchValue(value=doc_id),
            )
        ]
    )

    try:
        qdrant_client.delete(
            collection_name=collection_name,
            points_selector=qmodels.FilterSelector(filter=doc_filter),
            wait=True,
        )
    except Exception:
        # Fallback for qdrant-client variants
        try:
            qdrant_client.delete(collection_name=collection_name, points_selector=doc_filter, wait=True)
        except Exception:
            pass


def _coerce_extracted_document(result, original_filename: str) -> ExtractedDocument:
    if isinstance(result, ExtractedDocument):
        return result

    payload = None
    if isinstance(result, dict):
        payload = result
    elif hasattr(result, "model_dump"):
        payload = result.model_dump()
    elif hasattr(result, "dict"):
        payload = result.dict()
    elif hasattr(result, "data"):
        data = getattr(result, "data")
        if isinstance(data, dict):
            payload = data

    if not isinstance(payload, dict):
        raise ValueError("langextract returned unsupported structure")

    sections_raw = payload.get("sections") or []
    sections: List[DocumentSection] = []
    for raw in sections_raw:
        if isinstance(raw, DocumentSection):
            sections.append(raw)
            continue
        if not isinstance(raw, dict):
            continue
        content = str(raw.get("content") or "").strip()
        if not content:
            continue
        sections.append(
            DocumentSection(
                section_title=raw.get("section_title"),
                content=content,
                page_number=raw.get("page_number"),
                has_table=bool(raw.get("has_table", False)),
                has_formula=bool(raw.get("has_formula", False)),
            )
        )

    key_terms_raw = payload.get("key_terms") or []
    key_terms = [str(x).strip() for x in key_terms_raw if str(x).strip()]

    summary = str(payload.get("summary") or "").strip() or "Document processed successfully."
    title = str(payload.get("document_title") or original_filename)

    if not sections:
        sections = [
            DocumentSection(
                section_title="Section",
                content=summary,
                page_number=None,
                has_table=False,
                has_formula=False,
            )
        ]

    return ExtractedDocument(
        document_title=title,
        summary=summary,
        sections=sections,
        key_terms=key_terms,
    )


def _extract_with_langextract(saved_filepath: Path, original_filename: str) -> ExtractedDocument:
    api_key = GEMINI_API_KEY
    if not api_key:
        raise HTTPException(status_code=500, detail="GEMINI_API_KEY is not configured")

    try:
        result = langextract_extract(
            file_path=str(saved_filepath),
            schema=ExtractedDocument,
            model=GEMINI_MODEL_NAME,
            api_key=api_key,
            instructions=(
                "Extract all content from this document completely and accurately. "
                "Preserve all headings as section_title. "
                "For tables: convert to markdown table format in content field, set has_table=True. "
                "For mathematical formulas: use LaTeX notation, set has_formula=True. "
                "Include page numbers where identifiable. "
                "Extract a comprehensive 2-3 sentence summary of the entire document. "
                "List all important domain-specific terms in key_terms. "
                "Do not skip any sections. Extract everything."
            ),
        )
        return _coerce_extracted_document(result, original_filename)
    except Exception:
        try:
            genai.configure(api_key=api_key)
            try:
                gemini_model = genai.GenerativeModel(GEMINI_MODEL_NAME)
            except Exception:
                gemini_model = genai.GenerativeModel("gemini-1.5-flash")
            uploaded_file = genai.upload_file(str(saved_filepath))

            for _ in range(30):
                if getattr(uploaded_file.state, "name", "") == "ACTIVE":
                    break
                time.sleep(2)
                uploaded_file = genai.get_file(uploaded_file.name)

            raw_response = gemini_model.generate_content(
                [
                    uploaded_file,
                    """
                    Extract ALL text from this document completely.
                    Preserve structure: headings, tables (as markdown),
                    formulas (as LaTeX), bullet points.
                    Output only the extracted text.
                    """,
                ]
            )

            return ExtractedDocument(
                document_title=original_filename,
                summary="Document processed via fallback extraction.",
                sections=[
                    DocumentSection(
                        section_title="Section",
                        content=str(raw_response.text or ""),
                        page_number=None,
                        has_table=False,
                        has_formula=False,
                    )
                ],
                key_terms=[],
            )
        except Exception as exc:
            raise HTTPException(status_code=502, detail="Failed to extract document with Gemini") from exc


def _build_chunks(doc: ExtractedDocument, doc_id: str, filename: str):
    chunks = [
        {
            "text": f"[DOCUMENT SUMMARY]\n{doc.summary}\n\nKey Terms: {', '.join(doc.key_terms)}",
            "chunk_index": 0,
            "page_number": None,
            "section_title": "Document Summary",
            "has_table": False,
            "has_formula": False,
            "doc_id": doc_id,
            "filename": filename,
        }
    ]

    chunk_index = 1
    for section in doc.sections:
        section_content = (section.content or "").strip()
        if not section_content:
            continue

        words = section_content.split()
        title_prefix = f"[{section.section_title}]\n" if section.section_title else ""

        if len(words) <= 400:
            chunks.append(
                {
                    "text": f"{title_prefix}{section_content}",
                    "chunk_index": chunk_index,
                    "page_number": section.page_number,
                    "section_title": section.section_title,
                    "has_table": section.has_table,
                    "has_formula": section.has_formula,
                    "doc_id": doc_id,
                    "filename": filename,
                }
            )
            chunk_index += 1
            continue

        paragraphs = [p.strip() for p in section_content.split("\n\n") if p.strip()]
        current: List[str] = []
        current_words = 0

        for para in paragraphs:
            para_words = len(para.split())
            if current_words + para_words > 400 and current:
                chunks.append(
                    {
                        "text": f"{title_prefix}" + "\n\n".join(current),
                        "chunk_index": chunk_index,
                        "page_number": section.page_number,
                        "section_title": section.section_title,
                        "has_table": section.has_table,
                        "has_formula": section.has_formula,
                        "doc_id": doc_id,
                        "filename": filename,
                    }
                )
                chunk_index += 1
                current = [para]
                current_words = para_words
            else:
                current.append(para)
                current_words += para_words

        if current:
            chunks.append(
                {
                    "text": f"{title_prefix}" + "\n\n".join(current),
                    "chunk_index": chunk_index,
                    "page_number": section.page_number,
                    "section_title": section.section_title,
                    "has_table": section.has_table,
                    "has_formula": section.has_formula,
                    "doc_id": doc_id,
                    "filename": filename,
                }
            )
            chunk_index += 1

    return chunks


def _embed_text(text: str) -> Optional[List[float]]:
    try:
        with httpx.Client(timeout=30.0) as client:
            response = client.post(f"{EMBEDDING_SERVICE_URL}/embed", json={"text": text})
        response.raise_for_status()
        payload = response.json()
    except Exception:
        return None

    embedding = payload.get("embedding") if isinstance(payload, dict) else None
    if isinstance(embedding, list) and embedding:
        return embedding
    return None


def _resolve_mime_type(upload: UploadFile) -> str:
    mime_type = (upload.content_type or "").lower().strip()
    if not mime_type or mime_type == "application/octet-stream":
        guessed = mimetypes.guess_type(upload.filename or "")[0]
        mime_type = (guessed or "").lower().strip()
    if mime_type == "image/jpg":
        mime_type = "image/jpeg"
    return mime_type


def _state_name(file_obj) -> str:
    state = getattr(file_obj, "state", None)
    if state is None:
        return ""
    name = getattr(state, "name", None)
    if name:
        return str(name).upper()
    return str(state).upper()


def _upload_to_gemini(path: str, display_name: str, mime_type: str):
    api_key = os.environ.get("GEMINI_API_KEY") or GEMINI_API_KEY
    if not api_key:
        raise HTTPException(status_code=500, detail="GEMINI_API_KEY is not configured")

    if google_genai is not None:
        try:
            client = google_genai.Client(api_key=api_key)
            try:
                file_obj = client.files.upload(
                    file=path,
                    config={"display_name": display_name, "mime_type": mime_type},
                )
            except TypeError:
                file_obj = client.files.upload(file=path, display_name=display_name, mime_type=mime_type)
            return "google_genai", client, file_obj
        except Exception:
            pass

    try:
        genai.configure(api_key=api_key)
        file_obj = genai.upload_file(path=path, display_name=display_name, mime_type=mime_type)
        return "legacy", None, file_obj
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Failed to upload file to Gemini") from exc


def _refresh_gemini_file(sdk_kind: str, client, gemini_file):
    file_name = getattr(gemini_file, "name", "")
    if sdk_kind == "google_genai" and client is not None:
        try:
            return client.files.get(name=file_name)
        except TypeError:
            return client.files.get(file_name)
    return genai.get_file(file_name)


def _generate_file_summary(sdk_kind: str, client, gemini_file) -> str:
    model_name = os.environ.get("GEMINI_MODEL", "gemini-3.1-flash-lite-preview")
    prompt = (
        "Summarize this document in 2-3 sentences. "
        "What is it about and what are the key topics covered?"
    )

    if sdk_kind == "google_genai" and client is not None:
        try:
            response = client.models.generate_content(
                model=model_name,
                contents=[gemini_file, prompt],
            )
            text = getattr(response, "text", "")
            return (text or "").strip()
        except Exception:
            pass

    response = genai.GenerativeModel(model_name).generate_content([gemini_file, prompt])
    return str(getattr(response, "text", "") or "").strip()


def _delete_gemini_file(file_name: str) -> None:
    api_key = os.environ.get("GEMINI_API_KEY") or GEMINI_API_KEY
    if not api_key or not file_name:
        return

    if google_genai is not None:
        try:
            client = google_genai.Client(api_key=api_key)
            try:
                client.files.delete(name=file_name)
            except TypeError:
                client.files.delete(file_name)
            return
        except Exception:
            pass

    try:
        genai.configure(api_key=api_key)
        genai.delete_file(file_name)
    except Exception:
        pass


@router.post("/upload")
async def upload_document(
    file: UploadFile = File(...),
    session_id: str = Query(...),
    current_user=Depends(get_current_user),
    db=Depends(get_db),
):
    resolved_session_id = (session_id or "").strip()
    if not resolved_session_id:
        raise HTTPException(status_code=400, detail="session_id is required")

    original_filename = file.filename or "document"
    mime_type = _resolve_mime_type(file)
    if mime_type not in ALLOWED_MIME_TYPES:
        raise HTTPException(status_code=400, detail="Unsupported file type")

    file_bytes = await file.read()
    if not file_bytes:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")
    if len(file_bytes) > GEMINI_UPLOAD_MAX_BYTES:
        raise HTTPException(status_code=400, detail="File too large (max 20MB)")

    user_id = str(current_user["id"])
    _get_or_create_owned_session(resolved_session_id, user_id, db)
    _ensure_session_memory_column(db)

    suffix = Path(original_filename).suffix
    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp.write(file_bytes)
            tmp_path = tmp.name

        sdk_kind, client, gemini_file = _upload_to_gemini(tmp_path, original_filename, mime_type)

        max_wait = 30
        waited = 0
        state = _state_name(gemini_file)
        while state == "PROCESSING":
            if waited >= max_wait:
                raise HTTPException(status_code=500, detail="File processing timed out")
            time.sleep(2)
            waited += 2
            gemini_file = _refresh_gemini_file(sdk_kind, client, gemini_file)
            state = _state_name(gemini_file)

        if state == "FAILED":
            raise HTTPException(status_code=500, detail="File processing failed")

        summary = _generate_file_summary(sdk_kind, client, gemini_file)
        doc_id = str(uuid.uuid4())
        uploaded_at = datetime.utcnow().isoformat()

        with db.cursor(cursor_factory=RealDictCursor) as cur:
            # Create session if it doesn't exist yet
            cur.execute(
                """
                INSERT INTO chat_sessions (id, user_id, title)
                VALUES (%s::uuid, %s::uuid, %s)
                ON CONFLICT (id) DO NOTHING
                """,
                (resolved_session_id, user_id, f"Chat with {original_filename[:40]}"),
            )

            # Now read existing memory (may be empty for new session)
            cur.execute(
                "SELECT session_memory FROM chat_sessions WHERE id = %s::uuid",
                (resolved_session_id,),
            )
            row = cur.fetchone()
            session_memory = {}
            if row and row["session_memory"]:
                sm = row["session_memory"]
                session_memory = json.loads(sm) if isinstance(sm, str) else (sm or {})

            if not isinstance(session_memory, dict):
                session_memory = {}

            uploaded_files = session_memory.get("uploaded_files", [])
            if not isinstance(uploaded_files, list):
                uploaded_files = []

            uploaded_files.append(
                {
                    "doc_id": doc_id,
                    "filename": original_filename,
                    "gemini_file_uri": getattr(gemini_file, "uri", None),
                    "gemini_file_name": getattr(gemini_file, "name", None),
                    "mime_type": mime_type,
                    "summary": summary,
                    "uploaded_at": uploaded_at,
                }
            )
            session_memory["uploaded_files"] = uploaded_files
            session_memory["active_doc"] = {
                "doc_id": doc_id,
                "filename": original_filename,
                "gemini_file_uri": getattr(gemini_file, "uri", None),
                "gemini_file_name": getattr(gemini_file, "name", None),
                "mime_type": mime_type,
                "summary": summary,
            }

            cur.execute(
                "UPDATE chat_sessions SET session_memory = %s::jsonb WHERE id = %s::uuid",
                (json.dumps(session_memory), resolved_session_id),
            )
            db.commit()

        return {
            "doc_id": doc_id,
            "filename": original_filename,
            "summary": summary,
            "gemini_file_name": getattr(gemini_file, "name", ""),
            "status": "ready",
        }
    finally:
        if tmp_path:
            try:
                os.unlink(tmp_path)
            except Exception:
                pass


@router.delete("/active")
async def remove_active_document(
    session_id: str = Query(...),
    current_user=Depends(get_current_user),
    db=Depends(get_db),
):
    user_id = str(current_user["id"])

    with db.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(
            "SELECT session_memory FROM chat_sessions WHERE id = %s::uuid AND user_id = %s::uuid",
            (session_id, user_id),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Session not found")

        sm = row.get("session_memory") or {}
        if isinstance(sm, str):
            try:
                sm = json.loads(sm)
            except Exception:
                sm = {}
        if not isinstance(sm, dict):
            sm = {}

        active = sm.get("active_doc", {}) if isinstance(sm.get("active_doc"), dict) else {}
        file_name = str(active.get("gemini_file_name") or "")
        if file_name:
            _delete_gemini_file(file_name)

        sm.pop("active_doc", None)

        cur.execute(
            "UPDATE chat_sessions SET session_memory = %s::jsonb WHERE id = %s::uuid",
            (json.dumps(sm), session_id),
        )
        db.commit()

    return {"status": "removed"}


@router.get("/session/{session_id}")
def get_session_upload_state(
    session_id: str,
    user=Depends(get_current_user),
    db=Depends(get_db),
):
    user_id = str(user["id"])
    with db.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(
            "SELECT id FROM chat_sessions WHERE id = %s::uuid AND user_id = %s::uuid",
            (session_id, user_id),
        )
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="Session not found")

        cur.execute(
            "SELECT session_memory FROM chat_sessions WHERE id = %s::uuid",
            (session_id,),
        )
        row = cur.fetchone()

    session_memory = (row["session_memory"] if row else None) or {}
    if isinstance(session_memory, str):
        try:
            session_memory = json.loads(session_memory)
        except Exception:
            session_memory = {}

    return {
        "uploaded_collection": session_memory.get("uploaded_collection"),
        "uploaded_files": session_memory.get("uploaded_files", []),
    }
