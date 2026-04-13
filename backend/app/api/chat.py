import uuid
import json
import os
import re
import threading
try:
    from google import genai as google_genai
    from google.genai import types as google_genai_types
except Exception:
    google_genai = None
    google_genai_types = None
from app.core.db import get_pg_pool
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from fastapi.responses import StreamingResponse
from psycopg2.extras import RealDictCursor
from pydantic import BaseModel
from typing import Optional, List, AsyncGenerator
from qdrant_client import models as qmodels

from app.models.schemas import ChatRequest
from app.api.auth import get_current_user
from app.core.config import CBKT_INITIAL_MASTERY
from app.core.db import get_db, qdrant_client
from app.services.llm_router import stream_response
from app.services.cbkt import (
    classify_topic,
    classify_topic_by_name,
    generate_mcq_batch,
    generate_tiered_mcq,
    set_mastery_from_tiered_results,
    score_answer,
    update_mastery,
    save_mastery_event,
    get_unassessed_prerequisites,
    pick_most_relevant_prereqs
)
from app.services.context_engine import (
    build_prompt,
    update_rolling_summary,
    maybe_summarize_session,
    get_message_count_for_session,
    detect_formats,
    build_format_instructions,
    check_formats_used,
    build_followup_prompt,
)
from app.services.embeddings import get_embedding
from app.services.ba_dream_agent import process_dream_queue
from app.services.ba_memory_service import queue_dream_job

router = APIRouter(prefix="/chat", tags=["chat"])

LONG_CHAT_THRESHOLD = 20   # show banner at this many messages
# ── Pydantic models ───────────────────────────────────────────────────────────

class PrereqAnswerRequest(BaseModel):
    session_id:     Optional[str] = None
    topic_id:       str
    prereq_id:      str
    question:       str
    student_answer: str
    correct_answer: str

class SkipPrereqRequest(BaseModel):
    session_id: Optional[str] = None
    prereq_id:  str

class MCQBatchRequest(BaseModel):
    topic:      str
    count:      int = 3
    level:      str = "medium"
    session_id: Optional[str] = None

class MCQBatchAnswer(BaseModel):
    question_index: int
    student_answer: str
    correct_answer: str
    question:       str
    level:          Optional[str] = "medium"

class MCQBatchSubmitRequest(BaseModel):
    topic_id:   str
    answers:    List[MCQBatchAnswer]
    session_id: Optional[str] = None
    is_tiered:  bool = False

class MCQTieredRequest(BaseModel):
    topic_id:   str
    session_id: Optional[str] = None

# ── Helpers ───────────────────────────────────────────────────────────────────

def _get_or_create_session(session_id: str, user_id: str, title: str, db) -> str:
    with db.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute("SELECT id, user_id FROM chat_sessions WHERE id = %s::uuid", (session_id,))
        existing = cur.fetchone()
        if existing:
            if str(existing["user_id"]) != user_id:
                # Avoid leaking session existence across users.
                raise HTTPException(status_code=404, detail="Session not found")
        else:
            cur.execute(
                "INSERT INTO chat_sessions (id, user_id, title) VALUES (%s::uuid, %s::uuid, %s)",
                (session_id, user_id, title[:60])
            )
            db.commit()
    return session_id

def _save_message(session_id: str, user_id: str, role: str, content: str, sources: list, db) -> None:
    with db.cursor() as cur:
        cur.execute(
            """
            INSERT INTO chat_messages (session_id, role, content, sources)
            SELECT cs.id, %s, %s, %s
            FROM chat_sessions cs
            WHERE cs.id = %s::uuid AND cs.user_id = %s::uuid
            """,
            (role, content, json.dumps(sources), session_id, user_id)
        )
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="Session not found")
        db.commit()

def _ensure_owned_session(session_id: str, user_id: str, db) -> None:
    with db.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(
            "SELECT id FROM chat_sessions WHERE id = %s::uuid AND user_id = %s::uuid",
            (session_id, user_id)
        )
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="Session not found")

def _sse(data: str) -> str:
    return f"data: {data}\n\n"

def _clean_doc_prefix(message: str) -> str:
    return re.sub(r"\[DOC_ONLY:[^\]]*\]|\[DOC_ONLY\]", "", message).strip()

def _get_embedding(text: str) -> list:
    try:
        return get_embedding(text, timeout=30)
    except Exception:
        return []

def _qdrant_search(
    collection_name: str,
    query_vector: list,
    limit: int,
    doc_id: Optional[str] = None,
    extra_conditions: Optional[List[qmodels.FieldCondition]] = None,
):
    must_conditions: List[qmodels.FieldCondition] = []
    if doc_id:
        must_conditions.append(
            qmodels.FieldCondition(
                key="doc_id",
                match=qmodels.MatchValue(value=doc_id),
            )
        )
    if extra_conditions:
        must_conditions.extend(extra_conditions)

    query_filter = qmodels.Filter(must=must_conditions) if must_conditions else None

    # Support both client APIs depending on installed qdrant-client version.
    if hasattr(qdrant_client, "search"):
        kwargs = {
            "collection_name": collection_name,
            "query_vector": query_vector,
            "limit": limit,
            "with_payload": True,
        }
        if query_filter:
            kwargs["query_filter"] = query_filter
        return qdrant_client.search(**kwargs)

    kwargs = {
        "collection_name": collection_name,
        "query": query_vector,
        "limit": limit,
        "with_payload": True,
    }
    if query_filter:
        kwargs["query_filter"] = query_filter

    try:
        res = qdrant_client.query_points(**kwargs)
    except TypeError:
        if query_filter:
            kwargs.pop("query_filter", None)
            kwargs["filter"] = query_filter
        res = qdrant_client.query_points(**kwargs)
    return res.points

def _normalize_qdrant_hits(points: list, default_title: str, source_type: str) -> list:
    normalized = []
    for p in points:
        payload = getattr(p, "payload", None) or {}
        normalized.append(
            {
                "id": str(getattr(p, "id", "")),
                "content": payload.get("content") or payload.get("text") or "",
                "page_number": payload.get("page_number") or payload.get("page") or 1,
                "doc_title": payload.get("doc_title") or payload.get("filename") or payload.get("title") or default_title,
                "source_type": source_type,
            }
        )
    return [c for c in normalized if c["content"]]


def _is_document_summary_query(message: str) -> bool:
    m = message.lower().strip()
    summary_phrases = (
        "what is this document about",
        "summarize this document",
        "summary of this document",
        "overview of this document",
        "what is this about",
    )
    return any(p in m for p in summary_phrases)


def _prepend_summary_chunk_if_needed(collection_name: str, embedding: list, chunks: list, doc_id: Optional[str]):
    if not doc_id:
        return chunks

    try:
        summary_points = _qdrant_search(
            collection_name,
            embedding,
            1,
            doc_id=doc_id,
            extra_conditions=[
                qmodels.FieldCondition(
                    key="chunk_index",
                    match=qmodels.MatchValue(value=0),
                )
            ],
        )
    except Exception:
        return chunks

    summary_chunks = _normalize_qdrant_hits(summary_points, "Uploaded document", "uploaded")
    if not summary_chunks:
        return chunks

    summary_chunk = summary_chunks[0]
    if any(c.get("id") == summary_chunk.get("id") for c in chunks):
        return chunks

    return [summary_chunk] + chunks

def _get_session_memory(session_id: str, db) -> dict:
    if not session_id:
        return {}
    try:
        with db.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                "SELECT session_memory FROM chat_sessions WHERE id = %s::uuid",
                (session_id,),
            )
            row = cur.fetchone()
    except Exception:
        return {}

    session_memory = (row["session_memory"] if row else None) or {}
    if isinstance(session_memory, str):
        try:
            session_memory = json.loads(session_memory)
        except Exception:
            session_memory = {}
    return session_memory if isinstance(session_memory, dict) else {}


def _get_last_messages_text(session_id: str, db, limit: int = 5) -> str:
    with db.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(
            """
            SELECT role, content
            FROM chat_messages
            WHERE session_id = %s::uuid
            ORDER BY created_at DESC
            LIMIT %s
            """,
            (session_id, limit),
        )
        rows = cur.fetchall() or []

    rows = list(reversed(rows))
    lines = []
    for row in rows:
        role = str(row.get("role") or "").lower().strip()
        speaker = "Student" if role == "user" else "AI"
        lines.append(f"{speaker}: {row.get('content') or ''}")
    return "\n".join(lines)


def _extract_doc_mode(message: str):
    targeted_match = re.search(r"\[DOC_ONLY:([^\]]+)\]", message)
    doc_only_match = re.search(r"\[DOC_ONLY\]", message)

    clean_message = _clean_doc_prefix(message)
    if targeted_match:
        return "doc_targeted", targeted_match.group(1).strip().lower(), clean_message
    if doc_only_match:
        return "doc_only", None, clean_message
    return "normal", None, clean_message


def _normalize_filename_hint(name: str) -> str:
    cleaned = re.sub(r"\.[^.]+$", "", name.lower())
    cleaned = re.sub(r"[^a-z0-9_\-\s]", "", cleaned)
    return cleaned.strip()


def _match_doc_id(uploaded_files: list, target_hint: str) -> Optional[str]:
    if not target_hint:
        return None

    for file_meta in uploaded_files:
        if not isinstance(file_meta, dict):
            continue
        filename = str(file_meta.get("filename") or "")
        doc_id = file_meta.get("doc_id")
        if not filename or not doc_id:
            continue

        normalized = _normalize_filename_hint(filename)
        first_token = re.split(r"[_\-\s]", normalized)[0] if normalized else ""

        if target_hint in normalized or (first_token and first_token in target_hint):
            return str(doc_id)

    return None

def retrieve_chunks(message: str, user_id: str, session_id: str, db):
    mode, doc_target, clean_message = _extract_doc_mode(message)

    embedding = _get_embedding(clean_message)
    if not embedding:
        return [], "normal", False

    session_memory = _get_session_memory(session_id, db)
    upload_collection = session_memory.get("uploaded_collection")
    uploaded_files = session_memory.get("uploaded_files", []) if isinstance(session_memory.get("uploaded_files"), list) else []

    if mode == "doc_targeted":
        target_doc_id = _match_doc_id(uploaded_files, doc_target or "")
        if not upload_collection or not target_doc_id:
            return [], "no_doc", False

        try:
            upload_results = _qdrant_search(upload_collection, embedding, 6, doc_id=target_doc_id)
        except Exception:
            upload_results = []

        chunks = _normalize_qdrant_hits(upload_results, "Uploaded document", "uploaded")
        if _is_document_summary_query(clean_message):
            chunks = _prepend_summary_chunk_if_needed(upload_collection, embedding, chunks, target_doc_id)
        return chunks, "doc_targeted", bool(chunks)

    if mode == "doc_only":
        if not upload_collection or not uploaded_files:
            return [], "no_doc", False

        latest = uploaded_files[-1] if isinstance(uploaded_files[-1], dict) else {}
        latest_doc_id = str(latest.get("doc_id") or "")
        if not latest_doc_id:
            return [], "no_doc", False

        try:
            upload_results = _qdrant_search(upload_collection, embedding, 6, doc_id=latest_doc_id)
        except Exception:
            upload_results = []

        chunks = _normalize_qdrant_hits(upload_results, "Uploaded document", "uploaded")
        if _is_document_summary_query(clean_message):
            chunks = _prepend_summary_chunk_if_needed(upload_collection, embedding, chunks, latest_doc_id)
        return chunks, "doc_only", bool(chunks)

    if upload_collection:
        try:
            upload_results = _qdrant_search(upload_collection, embedding, 3)
        except Exception:
            upload_results = []

        try:
            course_results = _qdrant_search("rag_chunks", embedding, 3)
        except Exception:
            course_results = []

        upload_chunks = _normalize_qdrant_hits(upload_results, "Uploaded document", "uploaded")
        course_chunks = _normalize_qdrant_hits(course_results, "Course material", "course")
        return upload_chunks + course_chunks, "normal", bool(upload_chunks)

    try:
        course_results = _qdrant_search("rag_chunks", embedding, 6)
    except Exception:
        course_results = []
    course_chunks = _normalize_qdrant_hits(course_results, "Course material", "course")
    return course_chunks, "normal", False


async def stream_ba_response_gemini(prompt: str, system: str) -> AsyncGenerator[str, None]:
    api_key = os.environ["GEMINI_API_KEY"]
    model_name = os.environ.get("GEMINI_MODEL", "gemini-3.1-flash-lite-preview")

    if google_genai is not None and google_genai_types is not None:
        client = google_genai.Client(api_key=api_key)
        response = client.models.generate_content_stream(
            model=model_name,
            contents=prompt,
            config=google_genai_types.GenerateContentConfig(
                system_instruction=system,
                temperature=0.7,
                max_output_tokens=2048,
            ),
        )
        for chunk in response:
            text = getattr(chunk, "text", None)
            if text:
                yield text
        return

    try:
        import google.generativeai as legacy_genai
    except Exception as exc:
        raise RuntimeError("No compatible Gemini SDK found. Install google-genai or google-generativeai.") from exc

    legacy_genai.configure(api_key=api_key)
    model = legacy_genai.GenerativeModel(
        model_name=model_name,
        system_instruction=system,
    )
    response = model.generate_content(
        prompt,
        stream=True,
        generation_config=legacy_genai.types.GenerationConfig(
            temperature=0.7,
            max_output_tokens=2048,
        ),
    )
    for chunk in response:
        if chunk.text:
            yield chunk.text

# ── Main chat endpoint ────────────────────────────────────────────────────────

@router.post("/")
def chat(
    body: ChatRequest,
    background_tasks: BackgroundTasks,
    user=Depends(get_current_user),
    db=Depends(get_db),
):
    user_id    = str(user["id"])
    session_id = body.session_id or str(uuid.uuid4())
    clean_message = _clean_doc_prefix(body.message)

    _get_or_create_session(session_id, user_id, body.message, db)

    # Save user message FIRST so count is accurate for memory
    _save_message(session_id, user_id, "user", clean_message, [], db)

    # Trigger session summary every 5 messages (background-safe, fast)
    maybe_summarize_session(session_id, db)

    # Get message count AFTER saving — used for banner signal
    msg_count = get_message_count_for_session(session_id, db)

    topic_id  = classify_topic(clean_message, user_id=user_id)
    chunks, retrieval_mode, has_uploaded_hits = retrieve_chunks(body.message, user_id, session_id, db)

    DEFINITION_TRIGGERS = ("what is", "define", "what are", "who is", "meaning of", "what does")
    VISUAL_TRIGGERS = ("diagram", "flowchart", "visualize", "show me", "draw", "chart", "map out", "step by step visually", "explain with a diagram", "pipeline", "architecture")
    is_definition = any(clean_message.lower().strip().startswith(t) for t in DEFINITION_TRIGGERS)
    is_short = len(clean_message.split()) < 8
    is_visual_request = any(t in clean_message.lower() for t in VISUAL_TRIGGERS)

    if (is_definition or is_short) and not is_visual_request:
        formats = {k: False for k in ["needs_math", "needs_code", "needs_flowchart", "needs_steps", "needs_analogy"]}
    else:
        formats = detect_formats(clean_message, user_id=user_id)

    format_instructions = build_format_instructions(formats)

    system_prompt, history = build_prompt(
        user_id=user_id,
        session_id=session_id,
        current_topic_id=topic_id,
        chunks=chunks,
        db=db,
        format_instructions=format_instructions
    )

    if retrieval_mode == "no_doc":
        system_prompt += (
            "\n\nSYSTEM NOTE: The student used /doc but no matching document was found. "
            "Tell them to use /doc [filename_hint] [question], for example: "
            "/doc ikea what is their supply chain strategy?"
        )
    elif retrieval_mode in ("doc_only", "doc_targeted"):
        system_prompt += (
            "\n\nSYSTEM NOTE: Answer using ONLY the provided document excerpts. Do not use "
            "general knowledge. If the answer is not in the document, say so."
        )
    elif retrieval_mode == "normal" and has_uploaded_hits:
        system_prompt += (
            "\n\nSYSTEM NOTE: The following excerpts include the student's own uploaded notes. "
            "Prioritize these over course material when relevant."
        )

    full_response = []

    async def generate():
        # Always send session_id as first event (CORS-safe fallback)
        yield _sse(json.dumps({"session_id": session_id}))

        # Send long chat warning if threshold hit
        if msg_count >= LONG_CHAT_THRESHOLD:
            yield _sse(json.dumps({"long_chat_warning": True, "message_count": msg_count}))

        if (user.get("course") or "") == "business_analytics":
            async for token in stream_ba_response_gemini(clean_message, system_prompt):
                full_response.append(token)
                yield _sse(json.dumps({"token": token}))
        else:
            for token in stream_response(clean_message, system_prompt, history, user_id=user_id):
                full_response.append(token)
                yield _sse(json.dumps({"token": token}))

        complete = "".join(full_response)
        missing  = check_formats_used(complete, formats)
        followup = build_followup_prompt(missing)
        if followup:
            full_response.append(followup)
            yield _sse(json.dumps({"token": followup}))

        sources = [
            {"chunk_id": str(c["id"]), "page": c["page_number"], "title": c["doc_title"]}
            for c in chunks
        ]
        yield _sse(json.dumps({"sources": sources}))
        if followup:
            yield _sse(json.dumps({"follow_up": followup}))
        yield _sse("[DONE]")

        # Save assistant message
        final = "".join(full_response)
        _save_message(session_id, user_id, "assistant", final, sources, db)

        if (user.get("course") or "") == "business_analytics":
            detected_topics = [topic_id] if topic_id else []
            last_5_messages_text = _get_last_messages_text(session_id, db, limit=5)
            background_tasks.add_task(
                queue_dream_job,
                user_id=user_id,
                session_id=session_id,
                topics_touched=detected_topics,
                raw_summary=last_5_messages_text,
            )
            background_tasks.add_task(process_dream_queue)

    headers = {
        "X-Session-ID":    session_id,
        "Cache-Control":   "no-cache",
        "X-Accel-Buffering": "no",
    }
    return StreamingResponse(generate(), media_type="text/event-stream", headers=headers)

# ── End session ───────────────────────────────────────────────────────────────

@router.post("/end-session")
def end_session(body: dict, user=Depends(get_current_user), db=Depends(get_db)):
    session_id = body.get("session_id")
    if not session_id:
        raise HTTPException(status_code=400, detail="session_id required")
    user_id = str(user["id"])

    # Ensure caller owns the session before running summary work.
    _ensure_owned_session(session_id, user_id, db)

    def run_summary():
        try:
            pool = get_pg_pool()
            conn = pool.getconn()
            try:
                update_rolling_summary(user_id, session_id, conn)
            finally:
                pool.putconn(conn)
        except Exception as e:
            print(f"[EndSession] summary error: {e}")

    threading.Thread(target=run_summary, daemon=True).start()
    return {"status": "ok", "message": "Session ending, summary being generated"}

# ── Session history ───────────────────────────────────────────────────────────

@router.get("/sessions")
def get_sessions(user=Depends(get_current_user), db=Depends(get_db)):
    with db.cursor(cursor_factory=RealDictCursor) as cur:
        try:
            cur.execute(
                """
                SELECT id, title, created_at, updated_at, session_memory
                FROM chat_sessions
                WHERE user_id = %s::uuid
                ORDER BY created_at DESC
                """,
                (str(user["id"]),)
            )
        except Exception:
            # Backward-compatible fallback if session_memory column does not exist yet.
            cur.execute(
                "SELECT id, title, created_at, updated_at FROM chat_sessions WHERE user_id = %s::uuid ORDER BY created_at DESC",
                (str(user["id"]),)
            )
        rows = cur.fetchall()
    return [dict(r) for r in rows]

@router.get("/sessions/{session_id}/messages")
def get_messages(session_id: str, user=Depends(get_current_user), db=Depends(get_db)):
    _ensure_owned_session(session_id, str(user["id"]), db)

    with db.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(
            "SELECT role, content, sources, created_at FROM chat_messages WHERE session_id = %s::uuid ORDER BY created_at ASC",
            (session_id,)
        )
        rows = cur.fetchall()
    return [dict(r) for r in rows]

@router.delete("/sessions/{session_id}")
def delete_session(session_id: str, user=Depends(get_current_user), db=Depends(get_db)):
    """Delete a session and all its messages from the database."""
    _ensure_owned_session(session_id, str(user["id"]), db)

    with db.cursor() as cur:
        # Delete messages first (foreign key)
        cur.execute("DELETE FROM chat_messages WHERE session_id = %s::uuid", (session_id,))
        # Delete the session
        cur.execute("DELETE FROM chat_sessions WHERE id = %s::uuid", (session_id,))
        db.commit()
    return {"status": "deleted", "session_id": session_id}

# ── CBKT endpoints (unchanged) ────────────────────────────────────────────────

@router.post("/check-prereqs")
def check_prereqs(body: ChatRequest, user=Depends(get_current_user), db=Depends(get_db)):
    user_id  = str(user["id"])
    topic_id = classify_topic(body.message)
    if not topic_id:
        return {"status": "no_topic", "mcq_required": False, "proceed": True}
    unassessed = get_unassessed_prerequisites(user_id, topic_id, db)
    if not unassessed:
        return {"status": "all_assessed", "mcq_required": False, "proceed": True, "topic_id": topic_id}
    relevant = pick_most_relevant_prereqs(unassessed, topic_id, body.message)
    if not relevant:
        return {"status": "no_relevant_prereqs", "mcq_required": False, "proceed": True, "topic_id": topic_id}
    prereq_id = relevant[0]
    questions = generate_tiered_mcq(prereq_id, user_id=user_id)
    return {
        "status":    "mcq_required",
        "mcq_required": True,
        "proceed":   False,
        "topic_id":  topic_id,
        "prereq_id": prereq_id,
        "questions": questions,
        "can_skip":  True
    }


@router.post("/submit-prereq-answer")
def submit_prereq_answer(body: PrereqAnswerRequest, user=Depends(get_current_user), db=Depends(get_db)):
    """Scores a single prerequisite answer and updates mastery for that prerequisite topic."""
    user_id = str(user["id"])
    score = score_answer(body.student_answer, body.correct_answer)
    correct = score == 1.0

    p_before, p_after = update_mastery(user_id, body.prereq_id, correct, db)
    save_mastery_event(
        user_id=user_id,
        topic_id=body.prereq_id,
        session_id=body.session_id,
        question=body.question,
        student_answer=body.student_answer,
        score=score,
        p_before=p_before,
        p_after=p_after,
        db=db,
    )

    return {
        "status": "scored",
        "topic_id": body.topic_id,
        "prereq_id": body.prereq_id,
        "correct": correct,
        "score": score,
        "p_before": p_before,
        "p_after": p_after,
        "proceed": True,
    }

@router.post("/submit-tiered-answers")
def submit_tiered_answers(body: MCQBatchSubmitRequest, user=Depends(get_current_user), db=Depends(get_db)):
    user_id = str(user["id"])
    tiered_results = []
    for ans in body.answers:
        correct = score_answer(ans.student_answer, ans.correct_answer) == 1.0
        tiered_results.append({"level": ans.level or "medium", "correct": correct})
        save_mastery_event(
            user_id=user_id, topic_id=body.topic_id, session_id=body.session_id,
            question=ans.question, student_answer=ans.student_answer,
            score=1.0 if correct else 0.0, p_before=0.3, p_after=0.3, db=db
        )
    determined_level = set_mastery_from_tiered_results(user_id, body.topic_id, tiered_results, db)
    return {"status": "scored", "determined_level": determined_level, "results": tiered_results}

@router.post("/mcq-batch-generate")
def mcq_batch_generate(body: MCQBatchRequest, user=Depends(get_current_user), db=Depends(get_db)):
    count    = max(1, min(body.count, 30))
    topic_id = classify_topic_by_name(body.topic)
    if not topic_id:
        return {"error": f"Could not identify topic: {body.topic}", "questions": []}
    questions = generate_mcq_batch(topic_id=topic_id, count=count, level=body.level, user_id=str(user["id"]))
    return {
        "status": "ok", "topic_id": topic_id,
        "topic_name": topic_id.replace("_", " ").title(),
        "level": body.level, "count": count, "questions": questions,
    }

@router.post("/mcq-batch-submit")
def mcq_batch_submit(body: MCQBatchSubmitRequest, user=Depends(get_current_user), db=Depends(get_db)):
    user_id = str(user["id"])
    results = []
    for ans in body.answers:
        s = score_answer(ans.student_answer, ans.correct_answer)
        correct = s == 1.0
        p_before, p_after = update_mastery(user_id, body.topic_id, correct, db)
        save_mastery_event(
            user_id=user_id, topic_id=body.topic_id, session_id=body.session_id,
            question=ans.question, student_answer=ans.student_answer,
            score=s, p_before=p_before, p_after=p_after, db=db
        )
        results.append({
            "question_index": ans.question_index, "correct": correct,
            "student_answer": ans.student_answer, "correct_answer": ans.correct_answer,
        })
    return {"status": "scored", "results": results}

@router.post("/skip-prereq")
def skip_prereq(body: SkipPrereqRequest, user=Depends(get_current_user), db=Depends(get_db)):
    user_id = str(user["id"])
    with db.cursor() as cur:
        cur.execute(
            """INSERT INTO concept_mastery
               (user_id, topic_id, p_known, mastery_score, last_assessed, assessment_count)
               VALUES (%s::uuid, %s, %s, %s, NOW(), 0)
               ON CONFLICT (user_id, topic_id) DO NOTHING""",
            (user_id, body.prereq_id,
                 CBKT_INITIAL_MASTERY,
                 CBKT_INITIAL_MASTERY)
        )
        db.commit()
    return {"status": "skipped", "message": "Got it — proceeding with your question."}