import hashlib
import json
import os
import re
import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import List, Optional, Tuple

import google.generativeai as genai
import httpx
from fastapi import APIRouter, Depends, File, Header, HTTPException, Query, UploadFile
from langextract import extract as langextract_extract
from psycopg2.extras import RealDictCursor
from pydantic import BaseModel
from qdrant_client import models as qmodels
from qdrant_client.models import Distance, PointStruct, VectorParams

from app.api.auth import get_current_user
from app.core.config import BA_UPLOAD_DIR, EMBEDDING_SERVICE_URL, GEMINI_API_KEY, GEMINI_MODEL
from app.core.db import get_db, qdrant_client

router = APIRouter(prefix="/ba/documents", tags=["ba-documents"])

SUPPORTED_EXTENSIONS = {".pdf", ".docx", ".txt", ".jpg", ".jpeg", ".png", ".webp"}
UPLOAD_BASE_DIR = BA_UPLOAD_DIR
GEMINI_MODEL_NAME = GEMINI_MODEL


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


@router.post("/upload")
async def upload_document(
    file: UploadFile = File(...),
    session_id: Optional[str] = Query(None),
    x_session_id: Optional[str] = Header(None, alias="X-Session-ID"),
    user=Depends(get_current_user),
    db=Depends(get_db),
):
    resolved_session_id = (session_id or x_session_id or "").strip() or str(uuid.uuid4())
    original_filename = _sanitize_filename(file.filename or "")
    if not original_filename:
        raise HTTPException(status_code=400, detail="filename is required")

    extension = Path(original_filename).suffix.lower()
    if extension not in SUPPORTED_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Unsupported file type")

    user_id = str(user["id"])
    _get_or_create_owned_session(resolved_session_id, user_id, db)
    _ensure_session_memory_column(db)

    file_bytes = await file.read()
    if not file_bytes:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")

    upload_dir = _resolve_upload_path(user_id)
    saved_path = upload_dir / f"{uuid.uuid4()}_{original_filename}"
    try:
        saved_path.write_bytes(file_bytes)
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Failed to save uploaded file") from exc

    doc_id = hashlib.md5(f"{user_id}_{original_filename}".encode()).hexdigest()

    extracted_doc = _extract_with_langextract(saved_path, original_filename)
    chunks = _build_chunks(extracted_doc, doc_id, original_filename)
    if not chunks:
        raise HTTPException(status_code=400, detail="No indexable content found in document")

    first_embedding = _embed_text(chunks[0]["text"])
    if not first_embedding:
        raise HTTPException(status_code=502, detail="Failed to generate embeddings")

    base_collection = f"ba_user_{user_id}"
    collection_name = _resolve_personal_collection(base_collection, len(first_embedding))

    _delete_existing_doc_points(collection_name, doc_id)

    with db.cursor() as cur:
        cur.execute(
            """
            DELETE FROM chunks
            WHERE metadata->>'source' = 'student_upload'
              AND metadata->>'user_id' = %s
              AND metadata->>'doc_id' = %s
            """,
            (user_id, doc_id),
        )
        db.commit()

    uploaded_at = datetime.utcnow().isoformat()

    points: List[PointStruct] = []
    inserted_rows = []

    for chunk in chunks:
        embedding = first_embedding if chunk["chunk_index"] == 0 else _embed_text(chunk["text"])
        if not embedding:
            continue

        point_id = str(uuid.uuid4())
        points.append(
            PointStruct(
                id=point_id,
                vector=embedding,
                payload={
                    "text": chunk["text"],
                    "content": chunk["text"],
                    "chunk_index": chunk["chunk_index"],
                    "filename": chunk["filename"],
                    "doc_title": chunk["filename"],
                    "doc_id": doc_id,
                    "user_id": user_id,
                    "owner_user_id": user_id,
                    "section_title": chunk["section_title"],
                    "page_number": chunk["page_number"],
                    "has_table": chunk["has_table"],
                    "has_formula": chunk["has_formula"],
                    "uploaded_at": uploaded_at,
                },
            )
        )

        inserted_rows.append((chunk, point_id))

    if not points:
        raise HTTPException(status_code=502, detail="Embedding generation failed for all chunks")

    try:
        qdrant_client.upsert(collection_name=collection_name, points=points, wait=True)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Qdrant upsert failed: {str(exc)}") from exc

    with db.cursor() as cur:
        for chunk, point_id in inserted_rows:
            cur.execute(
                """
                INSERT INTO chunks (chunk_index, content, token_count, vector_id, status, metadata)
                VALUES (%s, %s, %s, %s, 'synced', %s::jsonb)
                """,
                (
                    chunk["chunk_index"],
                    chunk["text"],
                    len(chunk["text"].split()),
                    point_id,
                    json.dumps(
                        {
                            "source": "student_upload",
                            "user_id": user_id,
                            "filename": original_filename,
                            "doc_id": doc_id,
                            "collection": collection_name,
                            "section_title": chunk["section_title"],
                            "has_table": chunk["has_table"],
                            "has_formula": chunk["has_formula"],
                        }
                    ),
                ),
            )

        cur.execute(
            "SELECT session_memory FROM chat_sessions WHERE id = %s::uuid",
            (resolved_session_id,),
        )
        row = cur.fetchone()
        existing = (row["session_memory"] if row else None) or {}
        if isinstance(existing, str):
            try:
                existing = json.loads(existing)
            except Exception:
                existing = {}

        existing["uploaded_collection"] = collection_name
        files = existing.get("uploaded_files", [])
        if not isinstance(files, list):
            files = []

        existing_entry = next((f for f in files if f.get("doc_id") == doc_id), None)
        payload_file = {
            "filename": original_filename,
            "doc_id": doc_id,
            "chunk_count": len(inserted_rows),
            "uploaded_at": uploaded_at,
            "summary": extracted_doc.summary,
            "key_terms": extracted_doc.key_terms[:10],
        }

        if existing_entry:
            existing_entry.update(payload_file)
        else:
            files.append(payload_file)

        existing["uploaded_files"] = files

        cur.execute(
            "UPDATE chat_sessions SET session_memory = %s::jsonb WHERE id = %s::uuid",
            (json.dumps(existing), resolved_session_id),
        )
        db.commit()

    return {
        "session_id": resolved_session_id,
        "collection_id": collection_name,
        "doc_id": doc_id,
        "chunk_count": len(inserted_rows),
        "filename": original_filename,
        "summary": extracted_doc.summary,
        "key_terms": extracted_doc.key_terms[:10],
        "section_count": len(extracted_doc.sections),
    }


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
