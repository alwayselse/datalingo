import os
from datetime import datetime

from fastapi import APIRouter, Depends, Query
from psycopg2.extras import RealDictCursor
from app.api.auth import get_current_user, get_db
from fastapi import HTTPException
from pydantic import BaseModel
from app.core.config import GROQ_API_KEY
router = APIRouter(prefix="/analytics", tags=["analytics"])


def require_teacher(user=Depends(get_current_user)):
    """Guard — only teacher or admin role can access analytics."""
    if user["role"] not in ("teacher", "admin"):
        raise HTTPException(status_code=403, detail="Access denied")
    return user


def require_student(user=Depends(get_current_user)):
    """Guard — only students can access self analytics endpoint."""
    if user["role"] != "student":
        raise HTTPException(status_code=403, detail="Access denied")
    return user


def _batch_from_email(email: str) -> str:
    """Infers batch year from email prefix e.g. 22SSDS... → 2022."""
    prefix = email[:2]
    mapping = {"22": "2022", "23": "2023", "24": "2024", "25": "2025"}
    return mapping.get(prefix, "unknown")


# ── 1. Overview ───────────────────────────────────────────────────────────────

@router.get("/overview")
def get_overview(
    user=Depends(require_teacher),
    db=Depends(get_db)
):
    """Class-wide summary stats."""
    with db.cursor(cursor_factory=RealDictCursor) as cur:

        # Total students
        cur.execute("SELECT COUNT(*) AS total FROM users WHERE role = 'student'")
        total_students = cur.fetchone()["total"]

        # Active in last 7 days
        cur.execute(
            """
            SELECT COUNT(DISTINCT user_id) AS active
            FROM chat_sessions
            WHERE created_at >= NOW() - INTERVAL '7 days'
            """
        )
        active_7d = cur.fetchone()["active"]

        # Total questions asked (user messages only)
        cur.execute(
            "SELECT COUNT(*) AS total FROM chat_messages WHERE role = 'user'"
        )
        total_questions = cur.fetchone()["total"]

        # Average mastery across all students and topics
        cur.execute(
            "SELECT COALESCE(AVG(p_known), 0) AS avg FROM concept_mastery"
        )
        avg_mastery = round(float(cur.fetchone()["avg"]), 3)

        # Most asked topic (by topic_id in mastery_events)
        cur.execute(
            """
            SELECT topic_id, COUNT(*) AS cnt
            FROM mastery_events
            GROUP BY topic_id
            ORDER BY cnt DESC
            LIMIT 1
            """
        )
        row = cur.fetchone()
        most_asked_topic = row["topic_id"] if row else None

        # Most struggled topic (lowest avg p_known with at least 3 assessments)
        cur.execute(
            """
            SELECT topic_id, AVG(p_known) AS avg_mastery
            FROM concept_mastery
            GROUP BY topic_id
            HAVING COUNT(*) >= 3
            ORDER BY avg_mastery ASC
            LIMIT 1
            """
        )
        row = cur.fetchone()
        most_struggled_topic = row["topic_id"] if row else None

    return {
        "total_students":      total_students,
        "active_last_7_days":  active_7d,
        "total_questions":     total_questions,
        "avg_mastery":         avg_mastery,
        "most_asked_topic":    most_asked_topic,
        "most_struggled_topic":most_struggled_topic
    }


# ── 2. Students list ──────────────────────────────────────────────────────────

@router.get("/students")
def get_students(
    batch:   str | None = Query(None, description="Filter by batch: 2022/2023/2024/2025"),
    search:  str | None = Query(None, description="Search by name (email prefix)"),
    sort_by: str        = Query("last_active", description="last_active | mastery | questions"),
    user=Depends(require_teacher),
    db=Depends(get_db)
):
    """
    Returns all students with activity and mastery summary.
    Supports batch filter, name search, and sorting.
    """
    with db.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(
            """
            SELECT
                u.id,
                u.username,
                u.email,
                u.created_at,
                COUNT(DISTINCT cs.id)           AS total_sessions,
                COUNT(cm2.id)                   AS total_questions,
                COALESCE(AVG(cm.p_known), 0)    AS avg_mastery,
                MAX(cs.created_at)              AS last_active
            FROM users u
            LEFT JOIN chat_sessions cs  ON cs.user_id  = u.id
            LEFT JOIN chat_messages cm2 ON cm2.session_id = cs.id AND cm2.role = 'user'
            LEFT JOIN concept_mastery cm ON cm.user_id = u.id
            WHERE u.role = 'student'
            GROUP BY u.id, u.username, u.email, u.created_at
            ORDER BY last_active DESC NULLS LAST
            """
        )
        rows = cur.fetchall()

    students = []
    for r in rows:
        email = r["email"]
        batch_year = _batch_from_email(email)

        # Batch filter
        if batch and batch_year != batch:
            continue

        # Name/email search
        if search and search.lower() not in email.lower():
            continue

        avg_mastery = round(float(r["avg_mastery"]), 3)
        students.append({
            "user_id":        str(r["id"]),
            "username":       r["username"],
            "email":          email,
            "batch":          batch_year,
            "total_sessions": r["total_sessions"],
            "total_questions":r["total_questions"],
            "avg_mastery":    avg_mastery,
            "last_active":    r["last_active"].isoformat() if r["last_active"] else None,
            "at_risk":        avg_mastery < 0.35 and r["total_questions"] < 5
        })

    # Sorting
    sort_map = {
        "last_active": lambda s: s["last_active"] or "",
        "mastery":     lambda s: s["avg_mastery"],
        "questions":   lambda s: s["total_questions"]
    }
    key = sort_map.get(sort_by, sort_map["last_active"])
    students.sort(key=key, reverse=True)

    return students


# ── 3. Per-student mastery radar ──────────────────────────────────────────────

def _build_student_detail_payload(user_id: str, db):
    with db.cursor(cursor_factory=RealDictCursor) as cur:

        # Student info
        cur.execute(
            "SELECT id, username, email, created_at FROM users WHERE id = %s::uuid AND role = 'student'",
            (user_id,)
        )
        student = cur.fetchone()
        if not student:
            raise HTTPException(status_code=404, detail="Student not found")

        # Mastery per topic (join with topics to get names)
        cur.execute(
            """
            SELECT
                t.id         AS topic_id,
                t.name       AS topic_name,
                t.prerequisites,
                COALESCE(cm.p_known, 0)          AS p_known,
                COALESCE(cm.assessment_count, 0) AS assessment_count,
                cm.last_assessed
            FROM topics t
            LEFT JOIN concept_mastery cm
                ON cm.topic_id = t.id AND cm.user_id = %s::uuid
            ORDER BY t.name
            """,
            (user_id,)
        )
        mastery_rows = cur.fetchall()

        # Recent questions (last 10)
        cur.execute(
            """
            SELECT cm.content, cm.created_at, cs.title AS session_title
            FROM chat_messages cm
            JOIN chat_sessions cs ON cs.id = cm.session_id
            WHERE cs.user_id = %s::uuid AND cm.role = 'user'
            ORDER BY cm.created_at DESC
            LIMIT 10
            """,
            (user_id,)
        )
        recent_questions = cur.fetchall()

        # Total questions count
        cur.execute(
            """
            SELECT COUNT(*) AS total
            FROM chat_messages cm
            JOIN chat_sessions cs ON cs.id = cm.session_id
            WHERE cs.user_id = %s::uuid AND cm.role = 'user'
            """,
            (user_id,)
        )
        total_questions = cur.fetchone()["total"]

    mastery_by_topic = [
        {
            "topic_id":         r["topic_id"],
            "topic_name":       r["topic_name"],
            "prerequisites":    r["prerequisites"],
            "p_known":          round(float(r["p_known"]), 3),
            "assessment_count": r["assessment_count"],
            "last_assessed":    r["last_assessed"].isoformat() if r["last_assessed"] else None,
            "level":            (
                "beginner"     if r["p_known"] < 0.4 else
                "intermediate" if r["p_known"] < 0.7 else
                "advanced"
            )
        }
        for r in mastery_rows
    ]

    return {
        "student": {
            "user_id":   str(student["id"]),
            "username":  student["username"],
            "email":     student["email"],
            "batch":     _batch_from_email(student["email"]),
            "joined":    student["created_at"].isoformat()
        },
        "total_questions":  total_questions,
        "avg_mastery":      round(
            sum(t["p_known"] for t in mastery_by_topic) / len(mastery_by_topic), 3
        ) if mastery_by_topic else 0,
        "mastery_by_topic": mastery_by_topic,
        "recent_questions": [
            {
                "question":      r["content"],
                "session_title": r["session_title"],
                "asked_at":      r["created_at"].isoformat()
            }
            for r in recent_questions
        ]
    }

@router.get("/student/{user_id}")
def get_student_detail(
    user_id: str,
    user=Depends(require_teacher),
    db=Depends(get_db)
):
    """Full mastery breakdown for one student — for radar chart."""
    return _build_student_detail_payload(user_id, db)


@router.get("/me")
def get_my_student_detail(
    user=Depends(require_student),
    db=Depends(get_db)
):
    """Student self-analytics payload for personal views like knowledge graph."""
    return _build_student_detail_payload(str(user["id"]), db)


@router.get("/ba/palace")
def get_ba_palace(
    current_user=Depends(get_current_user),
    db=Depends(get_db),
):
    if (current_user.get("course") or "") != "business_analytics":
        raise HTTPException(status_code=403, detail="BA course only")

    with db.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(
            """
            SELECT
                bmp.topic_id,
                t.name as topic_name,
                bmp.p_known,
                bmp.mastery_level,
                bmp.understanding_summary,
                bmp.session_count,
                bmp.last_studied_at,
                bmp.misconceptions,
                bmp.forge_attempts,
                bmp.effective_examples,
                bmp.updated_at
            FROM ba_memory_palace bmp
            LEFT JOIN topics t ON t.id = bmp.topic_id
            WHERE bmp.user_id = %s::uuid
            ORDER BY bmp.updated_at DESC
            """,
            (str(current_user["id"]),),
        )
        rows = cur.fetchall()

    result = []
    for row in rows:
        misconceptions = row.get("misconceptions") or []
        forge_attempts = row.get("forge_attempts") or []
        result.append(
            {
                "topic_id": row["topic_id"],
                "topic_name": row.get("topic_name"),
                "p_known": float(row.get("p_known") or 0),
                "mastery_level": row.get("mastery_level") or "unassessed",
                "understanding_summary": row.get("understanding_summary"),
                "session_count": row.get("session_count") or 0,
                "last_studied_at": row["last_studied_at"].isoformat()
                if row.get("last_studied_at")
                else None,
                "misconceptions_count": len(misconceptions)
                if isinstance(misconceptions, list)
                else 0,
                "forge_attempts_count": len(forge_attempts)
                if isinstance(forge_attempts, list)
                else 0,
            }
        )

    return {"rows": result, "total": len(result)}


# ── 4. Topic heatmap ──────────────────────────────────────────────────────────

@router.get("/topics")
def get_topic_heatmap(
    user=Depends(require_teacher),
    db=Depends(get_db)
):
    """Class-wide topic performance — for heatmap visualization."""
    with db.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(
            """
            SELECT
                t.id                              AS topic_id,
                t.name                            AS topic_name,
                COUNT(cm.user_id)                 AS students_assessed,
                COALESCE(AVG(cm.p_known), 0)      AS avg_mastery,
                COUNT(CASE WHEN cm.p_known < 0.4 THEN 1 END) AS struggling,
                COUNT(CASE WHEN cm.p_known >= 0.7 THEN 1 END) AS mastered,
                COUNT(me.id)                      AS total_assessments
            FROM topics t
            LEFT JOIN concept_mastery cm ON cm.topic_id = t.id
            LEFT JOIN mastery_events  me ON me.topic_id = t.id
            GROUP BY t.id, t.name
            ORDER BY avg_mastery ASC
            """
        )
        rows = cur.fetchall()

    return [
        {
            "topic_id":           r["topic_id"],
            "topic_name":         r["topic_name"],
            "students_assessed":  r["students_assessed"],
            "avg_mastery":        round(float(r["avg_mastery"]), 3),
            "struggling":         r["struggling"],
            "mastered":           r["mastered"],
            "total_assessments":  r["total_assessments"]
        }
        for r in rows
    ]


# ── 5. At-risk students ───────────────────────────────────────────────────────

@router.get("/at-risk")
def get_at_risk_students(
    user=Depends(require_teacher),
    db=Depends(get_db)
):
    """
    Students flagged as at-risk:
    - avg mastery < 0.35 AND fewer than 5 questions asked
    - OR no activity in last 14 days AND has started using the app
    """
    with db.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(
            """
            SELECT
                u.id,
                u.username,
                u.email,
                COUNT(DISTINCT cs.id)           AS total_sessions,
                COUNT(cm2.id)                   AS total_questions,
                COALESCE(AVG(cm.p_known), 0)    AS avg_mastery,
                MAX(cs.created_at)              AS last_active
            FROM users u
            LEFT JOIN chat_sessions  cs  ON cs.user_id    = u.id
            LEFT JOIN chat_messages  cm2 ON cm2.session_id = cs.id AND cm2.role = 'user'
            LEFT JOIN concept_mastery cm ON cm.user_id    = u.id
            WHERE u.role = 'student'
            GROUP BY u.id, u.username, u.email
            HAVING
                (COALESCE(AVG(cm.p_known), 0) < 0.35 AND COUNT(cm2.id) < 5)
                OR
                (MAX(cs.created_at) < NOW() - INTERVAL '14 days' AND COUNT(cs.id) > 0)
            ORDER BY avg_mastery ASC
            """
        )
        rows = cur.fetchall()

    return [
        {
            "user_id":         str(r["id"]),
            "username":        r["username"],
            "email":           r["email"],
            "batch":           _batch_from_email(r["email"]),
            "total_sessions":  r["total_sessions"],
            "total_questions": r["total_questions"],
            "avg_mastery":     round(float(r["avg_mastery"]), 3),
            "last_active":     r["last_active"].isoformat() if r["last_active"] else None,
            "risk_reason":     (
                "Low mastery + low engagement"
                if float(r["avg_mastery"]) < 0.35 and r["total_questions"] < 5
                else "Inactive for 14+ days"
            )
        }
        for r in rows
    ]
# ── 6. Generate student summary ───────────────────────────────────────────────

@router.post("/student/{user_id}/generate-summary")
def generate_student_summary(
    user_id: str,
    user=Depends(require_teacher),
    db=Depends(get_db)
):
    """
    Generates a comprehensive AI summary of a student's learning journey.
    Called when teacher clicks 'Generate Summary' on the dashboard.
    """
    with db.cursor(cursor_factory=RealDictCursor) as cur:

        # Student info
        cur.execute(
            "SELECT id, username, email, created_at FROM users WHERE id = %s::uuid AND role = 'student'",
            (user_id,)
        )
        student = cur.fetchone()
        if not student:
            raise HTTPException(status_code=404, detail="Student not found")

        # Mastery per topic
        cur.execute(
            """
            SELECT t.name, cm.p_known, cm.assessment_count, cm.last_assessed
            FROM concept_mastery cm
            JOIN topics t ON t.id = cm.topic_id
            WHERE cm.user_id = %s::uuid
            ORDER BY cm.p_known DESC
            """,
            (user_id,)
        )
        mastery_rows = cur.fetchall()

        # Total sessions + questions
        cur.execute(
            """
            SELECT
                COUNT(DISTINCT cs.id) AS sessions,
                COUNT(cm2.id)         AS questions
            FROM chat_sessions cs
            LEFT JOIN chat_messages cm2
                ON cm2.session_id = cs.id AND cm2.role = 'user'
            WHERE cs.user_id = %s::uuid
            """,
            (user_id,)
        )
        activity = cur.fetchone()

        # Last 20 questions asked
        cur.execute(
            """
            SELECT cm.content
            FROM chat_messages cm
            JOIN chat_sessions cs ON cs.id = cm.session_id
            WHERE cs.user_id = %s::uuid AND cm.role = 'user'
            ORDER BY cm.created_at DESC
            LIMIT 20
            """,
            (user_id,)
        )
        recent_qs = [r["content"] for r in cur.fetchall()]

        # Existing rolling memory summary
        cur.execute(
            "SELECT summary FROM user_memory WHERE user_id = %s::uuid",
            (user_id,)
        )
        memory_row = cur.fetchone()
        memory_summary = memory_row["summary"] if memory_row else "No session history yet."

    # Build context for LLM
    mastery_text = "\n".join(
        f"  - {r['name']}: {r['p_known']:.2f} p_known "
        f"({r['assessment_count']} assessments)"
        for r in mastery_rows
    ) or "  No topics assessed yet."

    strong = [r for r in mastery_rows if r["p_known"] >= 0.7]
    weak   = [r for r in mastery_rows if r["p_known"] <  0.4]

    questions_text = "\n".join(
        f"  - {q}" for q in recent_qs
    ) or "  No questions asked yet."

    prompt = f"""You are an academic advisor analyzing a data science student's learning progress.

STUDENT: {student['username']} ({student['email']})
BATCH: {_batch_from_email(student['email'])}
JOINED: {student['created_at'].date()}
TOTAL SESSIONS: {activity['sessions']}
TOTAL QUESTIONS ASKED: {activity['questions']}

MASTERY SCORES BY TOPIC:
{mastery_text}

STRONG TOPICS (p_known >= 0.7): {', '.join(r['name'] for r in strong) or 'None yet'}
WEAK TOPICS (p_known < 0.4): {', '.join(r['name'] for r in weak) or 'None yet'}

RECENT QUESTIONS ASKED:
{questions_text}

LEARNING MEMORY (from sessions):
{memory_summary}

Write a comprehensive, professional summary (200-300 words) for the teacher covering:
1. Overall learning progress and engagement level
2. Topics mastered and areas of strength
3. Topics needing attention and specific gaps
4. Learning patterns observed from the questions asked
5. Concrete recommendations for the teacher

Be specific, data-driven, and actionable. Write in third person."""

    try:
        from groq import Groq
        groq_client = Groq(api_key=GROQ_API_KEY)
        response = groq_client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=600,
            temperature=0.4
        )
        summary = response.choices[0].message.content.strip()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Summary generation failed: {e}")

    return {
        "user_id":  user_id,
        "username": student["username"],
        "email":    student["email"],
        "summary":  summary,
        "data": {
            "total_sessions":  activity["sessions"],
            "total_questions": activity["questions"],
            "topics_assessed": len(mastery_rows),
            "strong_topics":   [r["name"] for r in strong],
            "weak_topics":     [r["name"] for r in weak],
            "avg_mastery":     round(
                sum(r["p_known"] for r in mastery_rows) / len(mastery_rows), 3
            ) if mastery_rows else 0
        }
    }


@router.get("/ba/overview")
def get_ba_overview(
    user=Depends(require_teacher),
    db=Depends(get_db)
):
    with db.cursor(cursor_factory=RealDictCursor) as cur:
        # Total BA students
        cur.execute(
            """
            SELECT COUNT(*) as total FROM users
            WHERE course='business_analytics' AND role='student'
            """
        )
        total_students = cur.fetchone()["total"]

        # Active last 7 days (BA students only)
        cur.execute(
            """
            SELECT COUNT(DISTINCT cs.user_id) as active
            FROM chat_sessions cs
            JOIN users u ON u.id = cs.user_id::uuid
            WHERE u.course='business_analytics'
            AND cs.created_at >= NOW() - INTERVAL '7 days'
            """
        )
        active_7d = cur.fetchone()["active"]

        # Total messages from BA students
        cur.execute(
            """
            SELECT COUNT(*) as total
            FROM chat_messages cm
            JOIN chat_sessions cs ON cs.id = cm.session_id
            JOIN users u ON u.id = cs.user_id::uuid
            WHERE u.course='business_analytics'
            AND cm.role='user'
            """
        )
        total_messages = cur.fetchone()["total"]

        # BA topic coverage — how many students have session_count > 0 per topic
        cur.execute(
            """
            SELECT topic_id, COUNT(*) as student_count,
                   AVG(p_known) as avg_p_known,
                   SUM(session_count) as total_sessions
            FROM ba_memory_palace
            WHERE session_count > 0
            GROUP BY topic_id
            ORDER BY total_sessions DESC
            """
        )
        topic_activity = [dict(r) for r in cur.fetchall()]

        # Students with zero activity (no sessions at all)
        cur.execute(
            """
            SELECT COUNT(DISTINCT user_id) as inactive
            FROM ba_memory_palace
            WHERE user_id NOT IN (
                SELECT DISTINCT user_id FROM ba_memory_palace
                WHERE session_count > 0
            )
            """
        )
        inactive_students = cur.fetchone()["inactive"]

        # Dream queue health
        cur.execute(
            """
            SELECT status, COUNT(*) as count
            FROM ba_dream_queue
            WHERE created_at >= NOW() - INTERVAL '7 days'
            GROUP BY status
            """
        )
        dream_stats = {r["status"]: r["count"] for r in cur.fetchall()}

        # Most studied topic
        most_studied = topic_activity[0]["topic_id"] if topic_activity else None

        # Weakest topic (most students with p_known < 0.4)
        cur.execute(
            """
            SELECT topic_id,
                   COUNT(*) FILTER (WHERE p_known < 0.4
                     AND session_count > 0) as struggling
            FROM ba_memory_palace
            GROUP BY topic_id
            ORDER BY struggling DESC
            LIMIT 1
            """
        )
        row = cur.fetchone()
        weakest_topic = row["topic_id"] if row else None

        # Total fragments written (memory health)
        cur.execute("SELECT COUNT(*) as total FROM ba_memory_fragments")
        total_fragments = cur.fetchone()["total"]

    return {
        "total_students": total_students,
        "active_last_7_days": active_7d,
        "total_messages": total_messages,
        "inactive_students": inactive_students,
        "most_studied_topic": most_studied,
        "weakest_topic": weakest_topic,
        "total_memory_fragments": total_fragments,
        "topic_activity": topic_activity,
        "dream_health": dream_stats,
    }


@router.get("/ba/students")
def get_ba_students(
    user=Depends(require_teacher),
    db=Depends(get_db)
):
    with db.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(
            """
            SELECT
                u.id as user_id,
                u.username,
                u.email,
                u.name,
                COUNT(DISTINCT cs.id) as total_sessions,
                COUNT(DISTINCT cm.id) FILTER
                  (WHERE cm.role='user') as total_messages,
                COALESCE(
                    SUM(bmp.session_count), 0
                ) as palace_sessions,
                COALESCE(
                    AVG(bmp.p_known) FILTER
                    (WHERE bmp.session_count > 0), 0
                ) as avg_palace_mastery,
                COUNT(bmp.topic_id) FILTER
                  (WHERE bmp.session_count > 0) as topics_studied,
                COUNT(bmp.topic_id) FILTER
                  (WHERE bmp.understanding_summary IS NOT NULL
                  ) as topics_with_memory,
                MAX(cs.created_at) as last_active
            FROM users u
            LEFT JOIN chat_sessions cs
              ON cs.user_id::uuid = u.id
            LEFT JOIN chat_messages cm
              ON cm.session_id = cs.id
            LEFT JOIN ba_memory_palace bmp
              ON bmp.user_id = u.id
            WHERE u.course='business_analytics'
              AND u.role='student'
            GROUP BY u.id, u.username, u.email, u.name
            ORDER BY last_active DESC NULLS LAST
            """
        )
        rows = cur.fetchall()

    return [dict(r) for r in rows]


@router.get("/ba/student/{user_id}")
def get_ba_student_detail(
    user_id: str,
    user=Depends(require_teacher),
    db=Depends(get_db)
):
    with db.cursor(cursor_factory=RealDictCursor) as cur:
        # Student info
        cur.execute(
            """
            SELECT id, username, email, name, created_at
            FROM users WHERE id = %s::uuid
            """,
            (user_id,),
        )
        student = cur.fetchone()
        if not student:
            raise HTTPException(404, "Student not found")

        # Full palace data
        cur.execute(
            """
            SELECT
                bmp.topic_id,
                t.name as topic_name,
                bmp.p_known,
                bmp.mastery_level,
                bmp.session_count,
                bmp.understanding_summary,
                bmp.misconceptions,
                bmp.effective_examples,
                bmp.forge_attempts,
                bmp.last_studied_at,
                bmp.updated_at
            FROM ba_memory_palace bmp
            LEFT JOIN topics t ON t.id = bmp.topic_id
            WHERE bmp.user_id = %s::uuid
            ORDER BY bmp.session_count DESC, bmp.updated_at DESC
            """,
            (user_id,),
        )
        palace = [dict(r) for r in cur.fetchall()]

        # Recent fragments
        cur.execute(
            """
            SELECT topic_id, fragment_type,
                   LEFT(content, 200) as content,
                   created_at
            FROM ba_memory_fragments
            WHERE user_id = %s::uuid
            ORDER BY created_at DESC
            LIMIT 20
            """,
            (user_id,),
        )
        fragments = [dict(r) for r in cur.fetchall()]

        # Recent sessions
        cur.execute(
            """
            SELECT id, title, created_at,
                   (SELECT COUNT(*) FROM chat_messages cm
                    WHERE cm.session_id = cs.id
                    AND cm.role='user') as message_count
            FROM chat_sessions cs
            WHERE cs.user_id::uuid = %s::uuid
            ORDER BY created_at DESC
            LIMIT 10
            """,
            (user_id,),
        )
        sessions = [dict(r) for r in cur.fetchall()]

        # Weak prerequisites (p_known < 0.4, has sessions)
        weak = [
            p
            for p in palace
            if p["session_count"] > 0 and float(p["p_known"] or 0) < 0.4
        ]

    return {
        "student": dict(student),
        "palace": palace,
        "fragments": fragments,
        "recent_sessions": sessions,
        "weak_topics": weak,
        "summary": {
            "topics_studied": sum(1 for p in palace if p["session_count"] > 0),
            "topics_with_memory": sum(1 for p in palace if p["understanding_summary"]),
            "total_fragments": len(fragments),
            "avg_mastery": round(
                sum(float(p["p_known"] or 0) for p in palace if p["session_count"] > 0)
                / max(1, sum(1 for p in palace if p["session_count"] > 0)),
                3,
            ),
        },
    }


class AnnouncementCreate(BaseModel):
    title: str
    body: str
    course: str = "business_analytics"


@router.post("/announcements")
def create_announcement(
    body: AnnouncementCreate,
    user=Depends(require_teacher),
    db=Depends(get_db)
):
    with db.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(
            """
            INSERT INTO announcements
              (teacher_id, course, title, body)
            VALUES (%s::uuid, %s, %s, %s)
            RETURNING id, created_at
            """,
            (str(user["id"]), body.course, body.title, body.body),
        )
        row = cur.fetchone()
        db.commit()
    created_at = row["created_at"]
    if isinstance(created_at, datetime):
        created_at = created_at.isoformat()
    return {
        "id": str(row["id"]),
        "created_at": created_at,
    }


@router.get("/announcements")
def get_announcements(
    course: str = Query("business_analytics"),
    user=Depends(get_current_user),
    db=Depends(get_db)
):
    limit = max(1, min(100, int(os.getenv("ANNOUNCEMENTS_LIMIT", "20"))))
    with db.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(
            """
                 SELECT a.id, a.teacher_id, a.title, a.body, a.course,
                   a.created_at, a.is_active,
                   u.name as teacher_name
            FROM announcements a
            JOIN users u ON u.id = a.teacher_id
            WHERE a.course = %s
            ORDER BY a.created_at DESC
            LIMIT %s
            """,
            (course, limit),
        )
        rows = cur.fetchall()
    return [dict(r) for r in rows]


@router.delete("/announcements/{ann_id}")
def delete_announcement(
    ann_id: str,
    user=Depends(require_teacher),
    db=Depends(get_db)
):
    with db.cursor() as cur:
        cur.execute(
            """
            UPDATE announcements SET is_active = false
            WHERE id = %s::uuid AND teacher_id = %s::uuid
            """,
            (ann_id, str(user["id"])),
        )
        db.commit()
    return {"status": "deleted"}