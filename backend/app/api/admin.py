import os
import sys
import csv
import io
import json
import time
import psutil
import platform
from datetime import datetime
from fastapi import APIRouter, Depends, Query, HTTPException
from fastapi.responses import StreamingResponse
from psycopg2 import IntegrityError
from psycopg2.extras import RealDictCursor
from pydantic import BaseModel
from typing import Optional
from passlib.context import CryptContext

from app.api.auth import get_current_user
from app.core.db import get_db

router = APIRouter(prefix="/admin", tags=["admin"])
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def require_admin(user=Depends(get_current_user)):
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


# ── Pydantic models ───────────────────────────────────────────────────────────

class AddUserRequest(BaseModel):
    name:     Optional[str] = None
    email:    str
    username: str
    password: str
    role:     str = "student"

class UpdateRoleRequest(BaseModel):
    role: str

class ResetPasswordRequest(BaseModel):
    new_password: str

class UpdateStatusRequest(BaseModel):
    is_active: bool


# ── 1. Overview ───────────────────────────────────────────────────────────────

@router.get("/overview")
def get_overview(user=Depends(require_admin), db=Depends(get_db)):
    with db.cursor(cursor_factory=RealDictCursor) as cur:

        cur.execute("SELECT COUNT(*) AS total FROM users WHERE role = 'student'")
        total_students = cur.fetchone()["total"]

        cur.execute("SELECT COUNT(*) AS total FROM users WHERE is_active = TRUE")
        active_users = cur.fetchone()["total"]

        cur.execute("SELECT COUNT(*) AS total FROM chat_messages")
        total_messages = cur.fetchone()["total"]

        cur.execute(
            "SELECT COUNT(*) AS total FROM chat_messages WHERE created_at >= NOW() - INTERVAL '24 hours'"
        )
        messages_today = cur.fetchone()["total"]

        cur.execute(
            "SELECT COUNT(*) AS total FROM chat_sessions WHERE created_at >= NOW() - INTERVAL '24 hours'"
        )
        sessions_today = cur.fetchone()["total"]

        cur.execute(
            "SELECT COUNT(DISTINCT user_id) AS total FROM chat_sessions WHERE created_at >= NOW() - INTERVAL '7 days'"
        )
        active_7d = cur.fetchone()["total"]

        cur.execute("SELECT COUNT(*) AS total FROM error_logs WHERE created_at >= NOW() - INTERVAL '24 hours'")
        errors_today = cur.fetchone()["total"]

        cur.execute("SELECT COALESCE(SUM(total_tokens), 0) AS total FROM api_logs WHERE created_at >= NOW() - INTERVAL '24 hours'")
        tokens_today = cur.fetchone()["total"]

        cur.execute("SELECT COALESCE(SUM(total_tokens), 0) AS total FROM api_logs")
        tokens_total = cur.fetchone()["total"]

    return {
        "total_students":   total_students,
        "active_users":     active_users,
        "total_messages":   total_messages,
        "messages_today":   messages_today,
        "sessions_today":   sessions_today,
        "active_7d":        active_7d,
        "errors_today":     errors_today,
        "tokens_today":     int(tokens_today),
        "tokens_total":     int(tokens_total)
    }


# ── 2. System health ──────────────────────────────────────────────────────────

@router.get("/system")
def get_system_health(user=Depends(require_admin)):
    cpu     = psutil.cpu_percent(interval=1)
    ram     = psutil.virtual_memory()
    disk    = psutil.disk_usage("/")
    process = psutil.Process(os.getpid())
    boot    = psutil.boot_time()
    uptime  = int(datetime.now().timestamp() - boot)

    return {
        "cpu_percent":      cpu,
        "ram_total_gb":     round(ram.total    / 1e9, 2),
        "ram_used_gb":      round(ram.used     / 1e9, 2),
        "ram_free_gb":      round(ram.available/ 1e9, 2),
        "ram_percent":      ram.percent,
        "disk_total_gb":    round(disk.total   / 1e9, 2),
        "disk_used_gb":     round(disk.used    / 1e9, 2),
        "disk_free_gb":     round(disk.free    / 1e9, 2),
        "disk_percent":     disk.percent,
        "process_ram_mb":   round(process.memory_info().rss / 1e6, 2),
        "uptime_seconds":   uptime,
        "python_version":   sys.version.split()[0],
        "platform":         platform.system()
    }


# ── 3. All messages (paginated) ───────────────────────────────────────────────

@router.get("/messages")
def get_all_messages(
    page:    int = Query(1, ge=1),
    user_id: Optional[str] = Query(None),
    user=Depends(require_admin),
    db=Depends(get_db)
):
    limit  = 50
    offset = (page - 1) * limit

    with db.cursor(cursor_factory=RealDictCursor) as cur:
        if user_id:
            cur.execute(
                """
                SELECT cm.id, cm.role, cm.content, cm.created_at,
                       cs.id AS session_id, cs.title AS session_title,
                       u.username, u.email
                FROM chat_messages cm
                JOIN chat_sessions cs ON cs.id = cm.session_id
                JOIN users u ON u.id = cs.user_id
                WHERE u.id = %s::uuid
                ORDER BY cm.created_at DESC
                LIMIT %s OFFSET %s
                """,
                (user_id, limit, offset)
            )
        else:
            cur.execute(
                """
                SELECT cm.id, cm.role, cm.content, cm.created_at,
                       cs.id AS session_id, cs.title AS session_title,
                       u.username, u.email
                FROM chat_messages cm
                JOIN chat_sessions cs ON cs.id = cm.session_id
                JOIN users u ON u.id = cs.user_id
                ORDER BY cm.created_at DESC
                LIMIT %s OFFSET %s
                """,
                (limit, offset)
            )
        rows = cur.fetchall()

        # Total count
        if user_id:
            cur.execute(
                """
                SELECT COUNT(*) AS total FROM chat_messages cm
                JOIN chat_sessions cs ON cs.id = cm.session_id
                WHERE cs.user_id = %s::uuid
                """,
                (user_id,)
            )
        else:
            cur.execute("SELECT COUNT(*) AS total FROM chat_messages")
        total = cur.fetchone()["total"]

    return {
        "page":        page,
        "total":       total,
        "total_pages": (total + limit - 1) // limit,
        "messages": [
            {
                "id":            str(r["id"]),
                "role":          r["role"],
                "content":       r["content"],
                "created_at":    r["created_at"].isoformat(),
                "session_id":    str(r["session_id"]),
                "session_title": r["session_title"],
                "username":      r["username"],
                "email":         r["email"]
            }
            for r in rows
        ]
    }


# ── 4. Message frequency ──────────────────────────────────────────────────────

@router.get("/messages/frequency")
def get_message_frequency(
    days: int = Query(7, ge=1, le=90),
    user=Depends(require_admin),
    db=Depends(get_db)
):
    """Messages per day for last N days."""
    with db.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(
            """
            SELECT
                DATE(created_at) AS date,
                COUNT(*) FILTER (WHERE role = 'user')      AS user_messages,
                COUNT(*) FILTER (WHERE role = 'assistant') AS assistant_messages
            FROM chat_messages
            WHERE created_at >= NOW() - (%s * INTERVAL '1 day')
            GROUP BY DATE(created_at)
            ORDER BY date ASC
            """,
            (days,)
        )
        rows = cur.fetchall()

    return [
        {
            "date":                r["date"].isoformat(),
            "user_messages":       r["user_messages"],
            "assistant_messages":  r["assistant_messages"]
        }
        for r in rows
    ]


# ── 5. Error logs ─────────────────────────────────────────────────────────────

@router.get("/logs/errors")
def get_error_logs(
    page:  int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    user=Depends(require_admin),
    db=Depends(get_db)
):
    offset = (page - 1) * limit
    with db.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(
            """
            SELECT id, user_id, endpoint, method, error_type,
                   error_message, traceback, created_at
            FROM error_logs
            ORDER BY created_at DESC
            LIMIT %s OFFSET %s
            """,
            (limit, offset)
        )
        rows = cur.fetchall()
        cur.execute("SELECT COUNT(*) AS total FROM error_logs")
        total = cur.fetchone()["total"]

    return {
        "page":        page,
        "total":       total,
        "total_pages": (total + limit - 1) // limit,
        "errors": [
            {
                "id":            str(r["id"]),
                "user_id":       str(r["user_id"]) if r["user_id"] else None,
                "endpoint":      r["endpoint"],
                "method":        r["method"],
                "error_type":    r["error_type"],
                "error_message": r["error_message"],
                "traceback":     r["traceback"],
                "created_at":    r["created_at"].isoformat()
            }
            for r in rows
        ]
    }


# ── 6. API usage logs ─────────────────────────────────────────────────────────

@router.get("/logs/api-usage")
def get_api_usage(
    page:  int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    user=Depends(require_admin),
    db=Depends(get_db)
):
    offset = (page - 1) * limit
    with db.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(
            """
            SELECT al.id, al.user_id, u.username, al.model,
                   al.prompt_tokens, al.completion_tokens, al.total_tokens,
                   al.endpoint, al.latency_ms, al.created_at
            FROM api_logs al
            LEFT JOIN users u ON u.id = al.user_id
            ORDER BY al.created_at DESC
            LIMIT %s OFFSET %s
            """,
            (limit, offset)
        )
        rows = cur.fetchall()
        cur.execute("SELECT COUNT(*) AS total FROM api_logs")
        total = cur.fetchone()["total"]

    return {
        "page":        page,
        "total":       total,
        "total_pages": (total + limit - 1) // limit,
        "logs": [
            {
                "id":                str(r["id"]),
                "user_id":           str(r["user_id"]) if r["user_id"] else None,
                "username":          r["username"],
                "model":             r["model"],
                "prompt_tokens":     r["prompt_tokens"],
                "completion_tokens": r["completion_tokens"],
                "total_tokens":      r["total_tokens"],
                "endpoint":          r["endpoint"],
                "latency_ms":        r["latency_ms"],
                "created_at":        r["created_at"].isoformat()
            }
            for r in rows
        ]
    }


@router.get("/logs/api-usage/summary")
def get_api_usage_summary(
    days: int = Query(7, ge=1, le=90),
    user=Depends(require_admin),
    db=Depends(get_db)
):
    """Daily token usage totals by model."""
    with db.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(
            """
            SELECT
                DATE(created_at)          AS date,
                model,
                COUNT(*)                  AS total_calls,
                SUM(prompt_tokens)        AS prompt_tokens,
                SUM(completion_tokens)    AS completion_tokens,
                SUM(total_tokens)         AS total_tokens,
                AVG(latency_ms)           AS avg_latency_ms
            FROM api_logs
            WHERE created_at >= NOW() - (%s * INTERVAL '1 day')
            GROUP BY DATE(created_at), model
            ORDER BY date DESC, total_tokens DESC
            """,
            (days,)
        )
        rows = cur.fetchall()

    return [
        {
            "date":               r["date"].isoformat(),
            "model":              r["model"],
            "total_calls":        r["total_calls"],
            "prompt_tokens":      int(r["prompt_tokens"] or 0),
            "completion_tokens":  int(r["completion_tokens"] or 0),
            "total_tokens":       int(r["total_tokens"] or 0),
            "avg_latency_ms":     round(float(r["avg_latency_ms"] or 0), 1)
        }
        for r in rows
    ]


# ── 7. Services health ────────────────────────────────────────────────────────

@router.get("/services/health")
def get_services_health(user=Depends(require_admin), db=Depends(get_db)):
    import requests as req
    from app.core.db import qdrant_client

    # Qdrant
    try:
        info = qdrant_client.get_collection("rag_chunks")
        qdrant_status = {
            "status":       "ok",
            "points_count": info.points_count,
            "collection":   "rag_chunks"
        }
    except Exception as e:
        qdrant_status = {"status": "error", "error": str(e)}

    # Embedding service
    try:
        r = req.get("http://127.0.0.1:8001/health", timeout=3)
        embedding_status = r.json()
        embedding_status["status"] = "ok"
    except Exception as e:
        embedding_status = {"status": "error", "error": str(e)}

    # Postgres
    try:
        with db.cursor() as cur:
            cur.execute("SELECT 1")
        postgres_status = {"status": "ok"}
    except Exception as e:
        postgres_status = {"status": "error", "error": str(e)}

    return {
        "postgres":  postgres_status,
        "qdrant":    qdrant_status,
        "embedding": embedding_status
    }


@router.get("/ba/document-stats")
def get_ba_document_stats(user=Depends(require_admin), db=Depends(get_db)):
    from app.core.db import qdrant_client
    from app.services.embeddings import get_embedding

    upload_summary = {
        "total_student_chunks": 0,
        "students_with_uploads": 0,
        "synced_chunks": 0,
        "pending_chunks": 0,
        "last_upload_at": None,
    }
    per_student = []
    qdrant_collections = []
    embedding_service = {
        "status": "offline",
        "latency_ms": None,
    }
    recent_errors = []

    def _to_dt(value):
        if not value:
            return None
        if isinstance(value, datetime):
            return value
        try:
            return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except Exception:
            return None

    def _parse_session_memory(value):
        if isinstance(value, dict):
            return value
        if isinstance(value, str):
            try:
                parsed = json.loads(value)
                if isinstance(parsed, dict):
                    return parsed
            except Exception:
                return {}
        return {}

    # Preferred source: legacy chunks table (if available in this deployment)
    used_chunks_table = False
    try:
        with db.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                SELECT
                  COUNT(*) FILTER (WHERE metadata->>'source' = 'student_upload') as total_student_chunks,
                  COUNT(DISTINCT metadata->>'user_id') FILTER (WHERE metadata->>'source' = 'student_upload') as students_with_uploads,
                  COUNT(*) FILTER (WHERE metadata->>'source' = 'student_upload' AND status = 'synced') as synced_chunks,
                  COUNT(*) FILTER (WHERE metadata->>'source' = 'student_upload' AND status = 'pending') as pending_chunks,
                  MAX(created_at) FILTER (WHERE metadata->>'source' = 'student_upload') as last_upload_at
                FROM chunks
                """
            )
            row = cur.fetchone() or {}
            upload_summary = {
                "total_student_chunks": int(row.get("total_student_chunks") or 0),
                "students_with_uploads": int(row.get("students_with_uploads") or 0),
                "synced_chunks": int(row.get("synced_chunks") or 0),
                "pending_chunks": int(row.get("pending_chunks") or 0),
                "last_upload_at": row.get("last_upload_at").isoformat() if row.get("last_upload_at") else None,
            }

            cur.execute(
                """
                SELECT
                  metadata->>'user_id' as user_id,
                  u.name,
                  u.username,
                  COUNT(*) as chunk_count,
                  array_agg(DISTINCT metadata->>'filename') as filenames,
                  MAX(created_at) as last_upload
                FROM chunks c
                LEFT JOIN users u ON u.id::text = metadata->>'user_id'
                WHERE metadata->>'source' = 'student_upload'
                GROUP BY metadata->>'user_id', u.name, u.username
                ORDER BY last_upload DESC
                """
            )
            rows = cur.fetchall()
            per_student = [
                {
                    "user_id": r.get("user_id"),
                    "name": r.get("name"),
                    "username": r.get("username"),
                    "chunk_count": int(r.get("chunk_count") or 0),
                    "filenames": [f for f in (r.get("filenames") or []) if f],
                    "last_upload": r.get("last_upload").isoformat() if r.get("last_upload") else None,
                }
                for r in rows
            ]
            used_chunks_table = True
    except Exception:
        db.rollback()

    # Fallback source: session_memory from chat_sessions (new BA upload architecture)
    if not used_chunks_table:
        try:
            with db.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute(
                    """
                    SELECT
                      cs.user_id::text AS user_id,
                      u.name,
                      u.username,
                      cs.session_memory
                    FROM chat_sessions cs
                    JOIN users u ON u.id = cs.user_id
                    WHERE cs.session_memory IS NOT NULL
                    """
                )
                rows = cur.fetchall()

            by_user = {}
            max_upload_dt = None
            total_chunks = 0

            for row in rows:
                memory = _parse_session_memory(row.get("session_memory"))
                uploaded_files = memory.get("uploaded_files", [])
                if not isinstance(uploaded_files, list) or not uploaded_files:
                    continue

                user_id = row.get("user_id")
                if not user_id:
                    continue

                if user_id not in by_user:
                    by_user[user_id] = {
                        "user_id": user_id,
                        "name": row.get("name"),
                        "username": row.get("username"),
                        "chunk_count": 0,
                        "filenames": set(),
                        "last_upload_dt": None,
                    }

                for file_meta in uploaded_files:
                    if not isinstance(file_meta, dict):
                        continue
                    filename = file_meta.get("filename")
                    if filename:
                        by_user[user_id]["filenames"].add(filename)

                    chunk_count = int(file_meta.get("chunk_count") or 0)
                    by_user[user_id]["chunk_count"] += max(chunk_count, 0)
                    total_chunks += max(chunk_count, 0)

                    uploaded_dt = _to_dt(file_meta.get("uploaded_at"))
                    if uploaded_dt and (
                        by_user[user_id]["last_upload_dt"] is None or uploaded_dt > by_user[user_id]["last_upload_dt"]
                    ):
                        by_user[user_id]["last_upload_dt"] = uploaded_dt
                    if uploaded_dt and (max_upload_dt is None or uploaded_dt > max_upload_dt):
                        max_upload_dt = uploaded_dt

            per_student = [
                {
                    "user_id": v["user_id"],
                    "name": v["name"],
                    "username": v["username"],
                    "chunk_count": int(v["chunk_count"]),
                    "filenames": sorted(list(v["filenames"])),
                    "last_upload": v["last_upload_dt"].isoformat() if v["last_upload_dt"] else None,
                }
                for v in by_user.values()
            ]
            per_student.sort(key=lambda x: x["last_upload"] or "", reverse=True)

            upload_summary = {
                "total_student_chunks": int(total_chunks),
                "students_with_uploads": len(per_student),
                "synced_chunks": int(total_chunks),
                "pending_chunks": 0,
                "last_upload_at": max_upload_dt.isoformat() if max_upload_dt else None,
            }
        except Exception:
            db.rollback()

    # Recent upload errors (schema-safe for existing error_logs table)
    try:
        with db.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                SELECT error_message, created_at
                FROM error_logs
                WHERE endpoint ILIKE %s OR endpoint ILIKE %s
                ORDER BY created_at DESC
                LIMIT 5
                """,
                ("%/ba/documents/upload%", "%ba/document%"),
            )
            err_rows = cur.fetchall()
            recent_errors = [
                {
                    "message": r.get("error_message"),
                    "created_at": r.get("created_at").isoformat() if r.get("created_at") else None,
                }
                for r in err_rows
                if r.get("error_message")
            ]
    except Exception:
        db.rollback()
        recent_errors = []

    # Query 3 — Qdrant BA collections
    try:
        collections = qdrant_client.get_collections().collections
        ba_collections = [c for c in collections if c.name.startswith("ba_user_")]
        for c in ba_collections:
            try:
                info = qdrant_client.get_collection(c.name)
                qdrant_collections.append(
                    {
                        "name": c.name,
                        "point_count": int(info.points_count or 0),
                    }
                )
            except Exception:
                qdrant_collections.append(
                    {
                        "name": c.name,
                        "point_count": 0,
                    }
                )
    except Exception:
        qdrant_collections = []

    # Query 4 — embedding service health
    start = time.perf_counter()
    try:
        embedding = get_embedding("health check", timeout=3)
        elapsed_ms = int((time.perf_counter() - start) * 1000)
        if embedding:
            embedding_service = {
                "status": "online",
                "latency_ms": elapsed_ms,
            }
    except Exception:
        embedding_service = {
            "status": "offline",
            "latency_ms": None,
        }

    return {
        "upload_summary": upload_summary,
        "per_student": per_student,
        "qdrant_collections": qdrant_collections,
        "embedding_service": embedding_service,
        "recent_errors": recent_errors,
    }


# ── 8. User management ────────────────────────────────────────────────────────

@router.get("/users")
def get_all_users(
    page:   int = Query(1, ge=1),
    search: Optional[str] = Query(None),
    role:   Optional[str] = Query(None),
    user=Depends(require_admin),
    db=Depends(get_db)
):
    limit  = 50
    offset = (page - 1) * limit

    with db.cursor(cursor_factory=RealDictCursor) as cur:
        filters = ["1=1"]
        params  = []

        if search:
            filters.append("(name ILIKE %s OR username ILIKE %s OR email ILIKE %s)")
            params += [f"%{search}%", f"%{search}%", f"%{search}%"]
        if role:
            filters.append("role = %s")
            params.append(role)

        where = " AND ".join(filters)
        cur.execute(
            f"""
            SELECT id, name, username, email, role, is_active, created_at
            FROM users
            WHERE {where}
            ORDER BY created_at DESC
            LIMIT %s OFFSET %s
            """,
            params + [limit, offset]
        )
        rows = cur.fetchall()
        cur.execute(f"SELECT COUNT(*) AS total FROM users WHERE {where}", params)
        total = cur.fetchone()["total"]

    return {
        "page":        page,
        "total":       total,
        "total_pages": (total + limit - 1) // limit,
        "users": [
            {
                "user_id":    str(r["id"]),
                "name":       r["name"],
                "username":   r["username"],
                "email":      r["email"],
                "role":       r["role"],
                "is_active":  r["is_active"],
                "created_at": r["created_at"].isoformat()
            }
            for r in rows
        ]
    }


@router.post("/users")
def add_user(body: AddUserRequest, user=Depends(require_admin), db=Depends(get_db)):
    role = (body.role or "student").strip().lower()
    if role not in ("student", "teacher", "admin"):
        raise HTTPException(status_code=400, detail="Role must be student, teacher, or admin")

    email = body.email.strip().lower()
    username = body.username.strip()
    password = body.password.strip()
    name = body.name.strip() if body.name else None

    if not email:
        raise HTTPException(status_code=400, detail="Email is required")
    if not username:
        raise HTTPException(status_code=400, detail="Username is required")
    if not password:
        raise HTTPException(status_code=400, detail="Password is required")

    hashed = pwd_context.hash(password)
    try:
        with db.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                INSERT INTO users (name, email, username, hashed_password, role)
                VALUES (%s, %s, %s, %s, %s)
                RETURNING id, name, username, email, role, is_active, created_at
                """,
                (name, email, username, hashed, role)
            )
            new_user = cur.fetchone()
            db.commit()
    except IntegrityError as e:
        db.rollback()
        msg = str(e)
        if "users_email_key" in msg:
            raise HTTPException(status_code=409, detail="Email already exists")
        if "users_username_key" in msg:
            raise HTTPException(status_code=409, detail="Username already exists")
        raise HTTPException(status_code=400, detail="Unable to create user")

    return {
        "status": "created",
        "user": {
            "user_id": str(new_user["id"]),
            "name": new_user["name"],
            "username": new_user["username"],
            "email": new_user["email"],
            "role": new_user["role"],
            "is_active": new_user["is_active"],
            "created_at": new_user["created_at"].isoformat() if new_user["created_at"] else None,
        },
    }


@router.delete("/users/{user_id}")
def delete_user(user_id: str, user=Depends(require_admin), db=Depends(get_db)):
    if user_id == str(user["id"]):
        raise HTTPException(status_code=400, detail="Cannot delete yourself")
    with db.cursor() as cur:
        cur.execute("DELETE FROM users WHERE id = %s::uuid", (user_id,))
        db.commit()
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="User not found")
    return {"status": "deleted", "user_id": user_id}


@router.patch("/users/{user_id}/role")
def update_role(user_id: str, body: UpdateRoleRequest, user=Depends(require_admin), db=Depends(get_db)):
    if body.role not in ("student", "teacher", "admin"):
        raise HTTPException(status_code=400, detail="Invalid role")
    with db.cursor() as cur:
        cur.execute(
            "UPDATE users SET role = %s WHERE id = %s::uuid",
            (body.role, user_id)
        )
        db.commit()
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="User not found")
    return {"status": "updated", "user_id": user_id, "role": body.role}


@router.patch("/users/{user_id}/password")
def reset_password(user_id: str, body: ResetPasswordRequest, user=Depends(require_admin), db=Depends(get_db)):
    hashed = pwd_context.hash(body.new_password)
    with db.cursor() as cur:
        cur.execute(
            "UPDATE users SET hashed_password = %s WHERE id = %s::uuid",
            (hashed, user_id)
        )
        db.commit()
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="User not found")
    return {"status": "password_reset", "user_id": user_id}


@router.patch("/users/{user_id}/status")
def update_status(user_id: str, body: UpdateStatusRequest, user=Depends(require_admin), db=Depends(get_db)):
    with db.cursor() as cur:
        cur.execute(
            "UPDATE users SET is_active = %s WHERE id = %s::uuid",
            (body.is_active, user_id)
        )
        db.commit()
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="User not found")
    return {"status": "updated", "user_id": user_id, "is_active": body.is_active}


@router.get("/users/export")
def export_users(user=Depends(require_admin), db=Depends(get_db)):
    """Returns all users as a downloadable CSV."""
    with db.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(
            "SELECT name, username, email, role, is_active, created_at FROM users ORDER BY created_at"
        )
        rows = cur.fetchall()

    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=["name", "username", "email", "role", "is_active", "created_at"])
    writer.writeheader()
    for r in rows:
        writer.writerow({
            "name":       r["name"],
            "username":   r["username"],
            "email":      r["email"],
            "role":       r["role"],
            "is_active":  r["is_active"],
            "created_at": r["created_at"].isoformat()
        })

    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=datalingo_users.csv"}
    )