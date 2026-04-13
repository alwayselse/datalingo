import json
import uuid
from datetime import datetime
from typing import Any

import requests
from psycopg2.extras import Json, RealDictCursor
from qdrant_client import models as qmodels
from qdrant_client.http.models import PointStruct

from app.core.config import EMBEDDING_SERVICE_URL
from app.core.db import get_pg_pool, qdrant_client


_ALLOWED_UPDATE_KEYS = {
    "understanding_summary",
    "misconceptions",
    "effective_examples",
    "forge_attempts",
    "personal_connections",
    "p_known",
    "mastery_level",
    "last_studied_at",
    "session_count",
    "total_messages",
}


def _to_list(value: Any) -> list:
    if isinstance(value, list):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
            return parsed if isinstance(parsed, list) else []
        except Exception:
            return []
    return []


def _to_iso(dt: Any) -> str | None:
    if isinstance(dt, datetime):
        return dt.isoformat()
    return None


def _embed_text(text: str) -> list[float]:
    if not text:
        return []
    resp = requests.post(
        f"{EMBEDDING_SERVICE_URL}/embed",
        json={"text": text},
        timeout=60,
    )
    resp.raise_for_status()
    payload = resp.json() if resp.content else {}
    embedding = payload.get("embedding") if isinstance(payload, dict) else None
    if not isinstance(embedding, list):
        return []
    return embedding


def _search_memory_collection(user_id: str, embedding: list[float]) -> list:
    collection_name = f"ba_memory_{user_id}"

    if hasattr(qdrant_client, "search"):
        return qdrant_client.search(
            collection_name=collection_name,
            query_vector=embedding,
            limit=5,
            score_threshold=0.6,
            with_payload=True,
        )

    kwargs = {
        "collection_name": collection_name,
        "query": embedding,
        "limit": 5,
        "score_threshold": 0.6,
        "with_payload": True,
    }

    try:
        result = qdrant_client.query_points(**kwargs)
    except Exception:
        return []

    return getattr(result, "points", [])


def get_palace_context(user_id: str, topic_id: str, query_text: str) -> dict:
    pool = get_pg_pool()
    conn = pool.getconn()

    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                SELECT topic_id, understanding_summary, misconceptions, effective_examples,
                       p_known, mastery_level, last_studied_at, session_count
                FROM ba_memory_palace
                WHERE user_id = %s AND topic_id = %s
                """,
                (user_id, topic_id),
            )
            palace_row = cur.fetchone() or {}

            cur.execute(
                "SELECT prerequisites FROM topics WHERE id = %s",
                (topic_id,),
            )
            topic_row = cur.fetchone() or {}

            prereq_ids = _to_list(topic_row.get("prerequisites"))
            weak_prerequisites = []
            if prereq_ids:
                cur.execute(
                    """
                    SELECT topic_id, p_known, understanding_summary, last_studied_at
                    FROM ba_memory_palace
                    WHERE user_id = %s AND topic_id = ANY(%s)
                    """,
                    (user_id, prereq_ids),
                )
                prereq_rows = cur.fetchall() or []
                for row in prereq_rows:
                    p_known = float(row.get("p_known") or 0.0)
                    if p_known < 0.4:
                        weak_prerequisites.append(
                            {
                                "topic_id": str(row.get("topic_id")),
                                "p_known": p_known,
                                "understanding_summary": row.get("understanding_summary") or "",
                                "last_studied_at": _to_iso(row.get("last_studied_at")) or "",
                            }
                        )

        relevant_fragments = []
        try:
            embedding = _embed_text(query_text)
            if embedding:
                points = _search_memory_collection(user_id, embedding)
                for point in points:
                    payload = getattr(point, "payload", None) or {}
                    content = payload.get("content") or payload.get("text") or ""
                    if not content:
                        continue
                    relevant_fragments.append(
                        {
                            "content": content,
                            "fragment_type": payload.get("fragment_type") or "",
                            "topic_id": str(payload.get("topic_id") or ""),
                            "score": float(getattr(point, "score", 0.0) or 0.0),
                        }
                    )
        except Exception:
            relevant_fragments = []

        understanding_summary = palace_row.get("understanding_summary")
        misconceptions = _to_list(palace_row.get("misconceptions"))
        effective_examples = _to_list(palace_row.get("effective_examples"))

        current_topic = {
            "topic_id": str(palace_row.get("topic_id") or topic_id),
            "understanding_summary": understanding_summary,
            "misconceptions": misconceptions,
            "effective_examples": effective_examples,
            "p_known": float(palace_row.get("p_known") or 0.0),
            "mastery_level": palace_row.get("mastery_level") or "unassessed",
            "last_studied_at": _to_iso(palace_row.get("last_studied_at")),
            "session_count": int(palace_row.get("session_count") or 0),
        }

        return {
            "current_topic": current_topic,
            "weak_prerequisites": weak_prerequisites,
            "relevant_fragments": relevant_fragments,
            "has_prior_context": bool(understanding_summary),
        }
    finally:
        pool.putconn(conn)


def write_fragment(
    user_id: str,
    topic_id: str,
    fragment_type: str,
    content: str,
    session_id,
    metadata: dict = {},
) -> str:
    pool = get_pg_pool()
    conn = pool.getconn()

    metadata_payload = dict(metadata or {})

    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                SELECT id, p_known
                FROM ba_memory_palace
                WHERE user_id = %s AND topic_id = %s
                """,
                (user_id, topic_id),
            )
            palace_row = cur.fetchone()
            if not palace_row:
                raise ValueError("ba_memory_palace row not found for user/topic")

            palace_id = palace_row["id"]
            p_known_at_time = float(palace_row.get("p_known") or 0.0)

            session_id_value = None
            try:
                session_id_value = int(session_id)
            except Exception:
                session_id_value = None

            cur.execute(
                """
                INSERT INTO ba_memory_fragments
                    (user_id, topic_id, palace_id, fragment_type, content, source_session_id, metadata)
                VALUES
                    (%s, %s, %s, %s, %s, %s, %s)
                RETURNING id
                """,
                (
                    user_id,
                    topic_id,
                    palace_id,
                    fragment_type,
                    content,
                    session_id_value,
                    Json(metadata_payload),
                ),
            )
            fragment_id = str(cur.fetchone()["id"])

            embedding = _embed_text(content)
            if embedding:
                point_id = str(uuid.uuid4())
                qdrant_client.upsert(
                    collection_name=f"ba_memory_{user_id}",
                    points=[
                        PointStruct(
                            id=point_id,
                            vector=embedding,
                            payload={
                                "text": content,
                                "content": content,
                                "fragment_type": fragment_type,
                                "topic_id": topic_id,
                                "p_known_at_time": p_known_at_time,
                                "session_id": str(session_id),
                                "created_at": datetime.utcnow().isoformat(),
                            },
                        )
                    ],
                    wait=True,
                )

                cur.execute(
                    """
                    UPDATE ba_memory_fragments
                    SET vector_id = %s,
                        embedded_at = NOW()
                    WHERE id = %s
                    """,
                    (point_id, fragment_id),
                )

        conn.commit()
        return fragment_id
    except Exception:
        conn.rollback()
        raise
    finally:
        pool.putconn(conn)


def update_palace_node(user_id: str, topic_id: str, updates: dict) -> None:
    if not updates:
        updates = {}

    filtered = {k: v for k, v in updates.items() if k in _ALLOWED_UPDATE_KEYS}

    pool = get_pg_pool()
    conn = pool.getconn()

    try:
        set_clauses = []
        values = []

        for key, value in filtered.items():
            if key in {
                "misconceptions",
                "effective_examples",
                "forge_attempts",
                "personal_connections",
            }:
                set_clauses.append(f"{key} = %s")
                values.append(Json(value if isinstance(value, list) else []))
            else:
                set_clauses.append(f"{key} = %s")
                values.append(value)

        set_clauses.append("updated_at = NOW()")

        sql = (
            "UPDATE ba_memory_palace "
            f"SET {', '.join(set_clauses)} "
            "WHERE user_id = %s AND topic_id = %s"
        )

        values.extend([user_id, topic_id])

        with conn.cursor() as cur:
            cur.execute(sql, values)
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        pool.putconn(conn)


def queue_dream_job(
    user_id: str,
    session_id,
    topics_touched: list,
    raw_summary: str,
) -> str:
    pool = get_pg_pool()
    conn = pool.getconn()

    session_id_value = None
    try:
        session_id_value = int(session_id)
    except Exception:
        print(f"[BA Memory] queue_dream_job skipped: non-integer session_id={session_id}")
        pool.putconn(conn)
        return ""

    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                INSERT INTO ba_dream_queue
                    (user_id, session_id, status, topics_touched, raw_summary)
                VALUES
                    (%s, %s, 'pending', %s, %s)
                RETURNING id
                """,
                (
                    user_id,
                    session_id_value,
                    Json(topics_touched if isinstance(topics_touched, list) else []),
                    raw_summary,
                ),
            )
            queue_id = str(cur.fetchone()["id"])
        conn.commit()
        return queue_id
    except Exception:
        conn.rollback()
        raise
    finally:
        pool.putconn(conn)


def build_memory_prompt_block(palace_context: dict) -> str:
    current = palace_context.get("current_topic") or {}
    mastery_level = current.get("mastery_level") or "unassessed"
    p_known = float(current.get("p_known") or 0.0)
    session_count = int(current.get("session_count") or 0)

    lines = [
        "--- STUDENT MEMORY CONTEXT ---",
        f"Topic mastery: {mastery_level} ({p_known:.0%})",
        f"Sessions on this topic: {session_count}",
    ]

    understanding_summary = current.get("understanding_summary")
    if understanding_summary:
        lines.append("")
        lines.append(f"What they understand: {understanding_summary}")

    misconceptions = current.get("misconceptions") or []
    if misconceptions:
        lines.append("")
        lines.append("Past misconceptions (already corrected):")
        for item in misconceptions:
            if isinstance(item, dict):
                misconception = str(item.get("misconception") or "").strip()
                correction = str(item.get("correction") or "").strip()
                if misconception and correction:
                    lines.append(f"- {misconception} -> {correction}")
            elif isinstance(item, str) and item.strip():
                lines.append(f"- {item.strip()}")

    effective_examples = current.get("effective_examples") or []
    if effective_examples:
        lines.append("")
        lines.append("Examples that worked for them:")
        for example in effective_examples[:2]:
            lines.append(f"- {str(example)}")

    weak_prerequisites = palace_context.get("weak_prerequisites") or []
    if weak_prerequisites:
        lines.append("")
        lines.append("Weak prerequisites to be aware of:")
        for item in weak_prerequisites:
            topic = str(item.get("topic_id") or "")
            score = float(item.get("p_known") or 0.0)
            lines.append(f"- {topic}: {score:.0%} mastery")

    relevant_fragments = palace_context.get("relevant_fragments") or []
    if relevant_fragments:
        lines.append("")
        lines.append("Relevant past context:")
        for frag in relevant_fragments[:3]:
            content = str(frag.get("content") or "").strip()
            if content:
                lines.append(f"- {content}")

    lines.append("--- END MEMORY CONTEXT ---")
    return "\n".join(lines)
