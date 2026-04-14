from fastapi import APIRouter, Depends, Query
from psycopg2.extras import RealDictCursor
from app.api.auth import get_current_user, get_db
from fastapi import HTTPException
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