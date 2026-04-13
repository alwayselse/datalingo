import json
from typing import Any

import google.generativeai as genai
from psycopg2.extras import RealDictCursor

from app.core.config import GEMINI_API_KEY, GEMINI_MODEL
from app.core.db import get_pg_pool
from app.services.ba_memory_service import update_palace_node, write_fragment


_SYSTEM_PROMPT = """
You are analyzing a tutoring conversation to extract
structured memory about what a student learned.
Return ONLY valid JSON. No markdown. No explanation.
""".strip()


def _strip_json_fences(text: str) -> str:
    cleaned = (text or "").strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.strip("`")
        cleaned = cleaned.replace("json", "", 1).strip()
    if cleaned.endswith("```"):
        cleaned = cleaned[:-3].strip()
    return cleaned


def _safe_parse_json(text: str) -> dict | None:
    payload_text = _strip_json_fences(text)
    try:
        parsed = json.loads(payload_text)
    except Exception:
        print("[BA Dream] warning: Gemini JSON parse failed")
        return None
    return parsed if isinstance(parsed, dict) else None


def process_dream_queue() -> None:
    pool = get_pg_pool()
    conn = pool.getconn()

    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                SELECT *
                FROM ba_dream_queue
                WHERE status = 'pending'
                ORDER BY created_at ASC
                LIMIT 1
                FOR UPDATE SKIP LOCKED
                """
            )
            job = cur.fetchone()
            if not job:
                conn.commit()
                return

            cur.execute(
                """
                UPDATE ba_dream_queue
                SET status = 'processing'
                WHERE id = %s
                """,
                (job["id"],),
            )
            conn.commit()

        try:
            process_session_dream(dict(job))
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE ba_dream_queue
                    SET status = 'done', processed_at = NOW(), error = NULL
                    WHERE id = %s
                    """,
                    (job["id"],),
                )
            conn.commit()
        except Exception as exc:
            conn.rollback()
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE ba_dream_queue
                    SET status = 'failed', processed_at = NOW(), error = %s
                    WHERE id = %s
                    """,
                    (str(exc), job["id"]),
                )
            conn.commit()
    except Exception as exc:
        conn.rollback()
        print(f"[BA Dream] process_dream_queue error: {exc}")
    finally:
        pool.putconn(conn)


def process_session_dream(job: dict) -> None:
    pool = get_pg_pool()
    conn = pool.getconn()

    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                SELECT role, content, created_at
                FROM chat_messages
                WHERE session_id::text = %s
                ORDER BY created_at ASC
                """,
                (str(job.get("session_id")),),
            )
            rows = cur.fetchall() or []

        rendered_lines: list[str] = []
        for row in rows:
            role = str(row.get("role") or "").lower().strip()
            prefix = "Student" if role == "user" else "AI"
            rendered_lines.append(f"{prefix}: {row.get('content') or ''}")

        topics_touched = job.get("topics_touched")
        if isinstance(topics_touched, str):
            try:
                topics_touched = json.loads(topics_touched)
            except Exception:
                topics_touched = []
        if not isinstance(topics_touched, list):
            topics_touched = []

        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            for topic_id in topics_touched:
                cur.execute("SELECT name FROM topics WHERE id = %s", (topic_id,))
                row = cur.fetchone()
                topic_name = (row or {}).get("name")
                if not topic_name:
                    continue

                topic_name_lower = topic_name.lower()
                matched = [
                    line for line in rendered_lines
                    if topic_name_lower in line.lower()
                ]
                if len(matched) < 2:
                    continue

                messages_text = "\n".join(matched)
                extract_memory_from_exchange(
                    str(job.get("user_id")),
                    str(topic_id),
                    messages_text,
                    session_id=job.get("session_id"),
                )

            for topic_id in topics_touched:
                cur.execute(
                    """
                    UPDATE ba_memory_palace
                    SET session_count = session_count + 1,
                        last_studied_at = NOW(),
                        updated_at = NOW()
                    WHERE user_id = %s AND topic_id = %s
                    """,
                    (str(job.get("user_id")), str(topic_id)),
                )

        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        pool.putconn(conn)


def extract_memory_from_exchange(
    user_id: str,
    topic_id: str,
    messages_text: str,
    session_id: Any = None,
) -> None:
    pool = get_pg_pool()
    conn = pool.getconn()

    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("SELECT name FROM topics WHERE id = %s", (topic_id,))
            row = cur.fetchone() or {}
            topic_name = row.get("name") or topic_id
    finally:
        pool.putconn(conn)

    if not GEMINI_API_KEY:
        print("[BA Dream] GEMINI_API_KEY not configured; skipping extraction")
        return

    genai.configure(api_key=GEMINI_API_KEY)
    model = genai.GenerativeModel(GEMINI_MODEL)

    user_prompt = f"""
Topic: {topic_name}

Conversation:
{messages_text}

Extract as JSON:
{{
  "understanding_summary": "2-3 sentence summary of what
    the student now understands. null if unclear.",
  "misconceptions": [
    {{"misconception": "...", "correction": "..."}}
  ],
  "effective_examples": ["example that visibly helped them"],
  "fragments": [
    {{
      "type": "insight|confusion|example_worked|\
               case_connection|formula_used",
      "content": "one specific memorable moment written
        to be useful when retrieved later as context"
    }}
  ]
}}
Return empty arrays if nothing found. Never hallucinate.
""".strip()

    response = model.generate_content(
        f"{_SYSTEM_PROMPT}\n\n{user_prompt}"
    )

    parsed = _safe_parse_json(getattr(response, "text", "") or "")
    if not parsed:
        return

    update_palace_node(
        user_id,
        topic_id,
        {
            "understanding_summary": parsed.get("understanding_summary"),
            "misconceptions": parsed.get("misconceptions")
            if isinstance(parsed.get("misconceptions"), list)
            else [],
            "effective_examples": parsed.get("effective_examples")
            if isinstance(parsed.get("effective_examples"), list)
            else [],
        },
    )

    fragments = parsed.get("fragments")
    if not isinstance(fragments, list):
        return

    for fragment in fragments:
        if not isinstance(fragment, dict):
            continue
        fragment_type = str(fragment.get("type") or "").strip()
        content = str(fragment.get("content") or "").strip()
        if not fragment_type or not content:
            continue
        write_fragment(
            user_id=user_id,
            topic_id=topic_id,
            fragment_type=fragment_type,
            content=content,
            session_id=session_id,
        )
