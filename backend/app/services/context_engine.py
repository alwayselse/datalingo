"""
context_engine.py — Full memory-aware context builder
Handles:
  - Session memory: rolling 5-msg summaries with sliding window
  - User memory: long-term learning profile injected when topic matches weak areas
  - BKT-aware adaptation: adjusts response depth based on p_known
  - Format detection and instruction building
"""

import os
import json
import re
from psycopg2.extras import RealDictCursor
from groq import Groq

groq_client = Groq(api_key=os.getenv("GROQ_API_KEY"))

SUMMARY_MODEL  = "llama-3.1-8b-instant"   # cheap + fast for summaries
DETECT_MODEL   = "llama-3.1-8b-instant"
MAIN_MODEL     = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")

# ── System prompt ─────────────────────────────────────────────────────────────

SYSTEM_PROMPT_TEMPLATE = """You are Datalingo, an intelligent adaptive learning tutor for data science students at Ramaiah University of Applied Sciences.

STUDENT PROFILE:
{student_profile}

CURRENT TOPIC: {topic_name}
STUDENT MASTERY LEVEL: {mastery_level} (p_known: {p_known:.2f})

ADAPTATION RULES:
- beginner (p_known < 0.4): Use simple language, concrete analogies, avoid jargon, build from first principles
- intermediate (0.4 ≤ p_known < 0.7): Balance theory and application, introduce terminology carefully
- advanced (p_known ≥ 0.7): Go deep, use technical precision, challenge with nuance

GOLDEN RULES:
- Do NOT include code, flowcharts, or math UNLESS the FORMAT GUIDANCE section below explicitly instructs you to — or the student directly asks for it
- If FORMAT GUIDANCE says to include a flowchart, YOU MUST include a Mermaid diagram — do not refuse
- NEVER cite sources or say "according to [Book]"
- Keep responses focused and appropriately concise
- Always be encouraging and supportive

KNOWLEDGE BASE (use to inform your answer, do not cite):
{rag_context}

{format_instructions}"""

# ── Format detection ──────────────────────────────────────────────────────────

FORMAT_DETECTOR_PROMPT = """You are a format detector for a data science tutoring system.

Analyze this student question and determine which response formats are STRICTLY necessary.
Be conservative — only mark true if the format is genuinely required, not just helpful.

Question: {query}

Respond with ONLY a JSON object, no markdown:
{{"needs_math": true/false, "needs_code": true/false, "needs_flowchart": true/false, "needs_steps": true/false, "needs_analogy": true/false}}

Strict guidelines:
- needs_math: ONLY if question explicitly involves deriving equations, probability calculations, or linear algebra operations. NOT for conceptual questions about math topics.
- needs_code: ONLY if student explicitly asks to write, implement, debug, or run code. NOT for questions that merely involve a library or algorithm conceptually.
- needs_flowchart: true if student uses words like "diagram", "flowchart", "visualize", "show me", "draw", "chart", "map out", "pipeline", "architecture", "step by step visually", or asks to "explain with a diagram". Also true if they ask HOW something works and a process/flow would genuinely clarify it.
- needs_steps: ONLY if student asks "how do I do X" as a practical task with multiple distinct actions. NOT for conceptual "how does X work" questions.
- needs_analogy: ONLY if student explicitly asks for an analogy, or the concept is highly abstract with no concrete grounding."""


def detect_formats(query: str, user_id: str = None) -> dict:
    defaults = {k: False for k in ["needs_math", "needs_code", "needs_flowchart", "needs_steps", "needs_analogy"]}
    try:
        res = groq_client.chat.completions.create(
            model=DETECT_MODEL,
            messages=[{"role": "user", "content": FORMAT_DETECTOR_PROMPT.format(query=query)}],
            max_tokens=100, temperature=0
        )
        text = res.choices[0].message.content.strip()
        text = re.sub(r"```json|```", "", text).strip()
        parsed = json.loads(text)
        # Force needs_code to False always (suppress unwanted code)
        parsed["needs_code"] = False
        return {k: bool(parsed.get(k, False)) for k in defaults}
    except Exception as e:
        print(f"[detect_formats] error: {e}")
        return defaults


def build_format_instructions(formats: dict) -> str:
    parts = []
    if formats.get("needs_math"):
        parts.append("If relevant, include mathematical notation using LaTeX.")
    if formats.get("needs_flowchart"):
        parts.append("""REQUIRED: Include a Mermaid diagram using EXACTLY this format:
```mermaid
graph TD
    A[Label] --> B[Label]
    B --> C[Label]
```
STRICT RULES — violating these will break rendering:
- Node labels: plain words ONLY. NO numbers, NO parentheses, NO special chars
- BAD: A[Layer 1], B[Conv(3x3)], C[Step #2]  GOOD: A[Input], B[Conv Layer], C[Processing]
- Arrows: use ONLY -->  never -->|label| or -->|text|
- Keep each label under 4 words
- Do not add any text or comments inside the mermaid block"""
)
    if formats.get("needs_steps"):
        parts.append("If relevant, use a numbered step-by-step format.")
    if formats.get("needs_analogy"):
        parts.append("If relevant, include a real-world analogy.")
    return "\nFORMAT GUIDANCE:\n" + "\n".join(parts) if parts else ""


def check_formats_used(response: str, formats: dict) -> list:
    missing = []
    if formats.get("needs_math") and "$$" not in response and "$" not in response:
        missing.append("math")
    if formats.get("needs_steps") and not re.search(r"^\d+\.", response, re.MULTILINE):
        missing.append("steps")
    return missing


def build_followup_prompt(missing: list) -> str:
    return ""  # Suppress follow-up injections to keep responses clean


# ── Session memory: 5-message rolling summaries ───────────────────────────────

SESSION_SUMMARY_PROMPT = """Summarize the following conversation between a student and a data science tutor.
Be concise (3-5 sentences). Capture: main topics discussed, key concepts explained, student's understanding level, and any confusion points.

Conversation:
{conversation}

Summary:"""


def _summarize_messages(messages: list) -> str:
    """Summarize a list of {role, content} dicts into a short string."""
    conv = "\n".join(
        f"{'Student' if m['role'] == 'user' else 'Tutor'}: {m['content'][:300]}"
        for m in messages
    )
    try:
        res = groq_client.chat.completions.create(
            model=SUMMARY_MODEL,
            messages=[{"role": "user", "content": SESSION_SUMMARY_PROMPT.format(conversation=conv)}],
            max_tokens=200, temperature=0.3
        )
        return res.choices[0].message.content.strip()
    except Exception as e:
        print(f"[_summarize_messages] error: {e}")
        return "Previous conversation covered various data science topics."


def _get_or_create_session_memory(session_id: str, db) -> dict:
    """
    Returns session memory record. Schema:
    session_memory: {
        chunk_summaries: ["summary of msgs 1-5", "summary of msgs 6-10", ...],
        combined_summary: "merged summary of all chunks so far",
        total_messages: int
    }
    Stored in chat_sessions.session_memory (jsonb column — add if not exists).
    """
    with db.cursor(cursor_factory=RealDictCursor) as cur:
        # Check if session_memory column exists, add it if not
        cur.execute("""
            SELECT column_name FROM information_schema.columns
            WHERE table_name='chat_sessions' AND column_name='session_memory'
        """)
        if not cur.fetchone():
            cur.execute("ALTER TABLE chat_sessions ADD COLUMN session_memory jsonb DEFAULT '{}'::jsonb")
            db.commit()

        cur.execute("SELECT session_memory FROM chat_sessions WHERE id = %s::uuid", (session_id,))
        row = cur.fetchone()
        if not row:
            return {"chunk_summaries": [], "combined_summary": "", "total_messages": 0}
        mem = row["session_memory"] or {}
        return {
            "chunk_summaries": mem.get("chunk_summaries", []),
            "combined_summary": mem.get("combined_summary", ""),
            "total_messages":   mem.get("total_messages", 0),
        }


def _save_session_memory(session_id: str, memory: dict, db) -> None:
    with db.cursor() as cur:
        cur.execute(
            "UPDATE chat_sessions SET session_memory = %s::jsonb WHERE id = %s::uuid",
            (json.dumps(memory), session_id)
        )
        db.commit()


def _get_recent_messages(session_id: str, limit: int, db) -> list:
    with db.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(
            """SELECT role, content FROM chat_messages
               WHERE session_id = %s::uuid
               ORDER BY created_at DESC LIMIT %s""",
            (session_id, limit)
        )
        rows = cur.fetchall()
    return list(reversed(rows))  # oldest first


def _count_messages(session_id: str, db) -> int:
    with db.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(
            "SELECT COUNT(*) AS cnt FROM chat_messages WHERE session_id = %s::uuid",
            (session_id,)
        )
        return cur.fetchone()["cnt"]


def maybe_summarize_session(session_id: str, db) -> dict:
    """
    Called after every user message is saved.
    If message count is a multiple of 5, summarize the last 5 messages
    and store as a new chunk. Merge all chunks into combined_summary.
    Returns the updated memory dict.
    """
    count = _count_messages(session_id, db)
    memory = _get_or_create_session_memory(session_id, db)
    memory["total_messages"] = count

    # Summarize every 5 messages (but only when we hit exactly a multiple of 5)
    if count > 0 and count % 5 == 0:
        # Get the last 5 messages
        last_5 = _get_recent_messages(session_id, 5, db)
        if last_5:
            chunk_summary = _summarize_messages(last_5)
            memory["chunk_summaries"].append(chunk_summary)

            # Merge all chunk summaries into one combined summary
            if len(memory["chunk_summaries"]) > 1:
                merge_prompt = f"""Merge these conversation summaries into one cohesive 4-6 sentence summary.
Preserve all key learning points, topics covered, and student understanding:

{chr(10).join(f'{i+1}. {s}' for i, s in enumerate(memory['chunk_summaries']))}

Merged summary:"""
                try:
                    res = groq_client.chat.completions.create(
                        model=SUMMARY_MODEL,
                        messages=[{"role": "user", "content": merge_prompt}],
                        max_tokens=250, temperature=0.3
                    )
                    memory["combined_summary"] = res.choices[0].message.content.strip()
                except Exception as e:
                    print(f"[maybe_summarize_session] merge error: {e}")
                    memory["combined_summary"] = " | ".join(memory["chunk_summaries"])
            else:
                memory["combined_summary"] = memory["chunk_summaries"][0]

            _save_session_memory(session_id, memory, db)

    return memory


# ── User memory: long-term learning profile ───────────────────────────────────

def get_user_memory(user_id: str, db) -> str:
    """Fetch the user's long-term memory summary."""
    with db.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(
            "SELECT summary FROM user_memory WHERE user_id = %s::uuid",
            (user_id,)
        )
        row = cur.fetchone()
    return row["summary"] if row else ""


def get_weak_topics(user_id: str, db) -> list:
    """Return list of topic_ids where p_known < 0.4."""
    with db.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(
            """SELECT topic_id FROM concept_mastery
               WHERE user_id = %s::uuid AND p_known < 0.4
               ORDER BY p_known ASC LIMIT 5""",
            (user_id,)
        )
        rows = cur.fetchall()
    return [r["topic_id"] for r in rows]


def should_inject_user_memory(current_topic_id: str, user_id: str, db) -> bool:
    """
    Only inject user memory if the current topic is one the student struggles with,
    or if a prerequisite of the current topic is weak.
    """
    if not current_topic_id:
        return False
    weak = get_weak_topics(user_id, db)
    if current_topic_id in weak:
        return True

    # Check prerequisites
    with db.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(
            "SELECT prerequisites FROM topics WHERE id = %s",
            (current_topic_id,)
        )
        row = cur.fetchone()
    if not row:
        return False
    prereqs = row.get("prerequisites") or []
    if isinstance(prereqs, str):
        try:
            prereqs = json.loads(prereqs)
        except Exception:
            prereqs = []
    return any(p in weak for p in prereqs)


def update_rolling_summary(user_id: str, session_id: str, db) -> None:
    """
    Called when session ends. Updates the user's long-term memory
    by merging this session's summary into their existing profile.
    """
    # Get this session's combined summary
    memory = _get_or_create_session_memory(session_id, db)
    session_summary = memory.get("combined_summary", "")

    if not session_summary:
        # Fall back to summarizing all messages
        all_msgs = _get_recent_messages(session_id, 50, db)
        if all_msgs:
            session_summary = _summarize_messages(all_msgs)

    if not session_summary:
        return

    # Get existing user memory
    existing = get_user_memory(user_id, db)

    # Get mastery snapshot
    with db.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(
            """SELECT t.name, cm.p_known
               FROM concept_mastery cm
               JOIN topics t ON t.id = cm.topic_id
               WHERE cm.user_id = %s::uuid
               ORDER BY cm.p_known ASC""",
            (user_id,)
        )
        mastery_rows = cur.fetchall()

    mastery_text = "\n".join(
        f"  - {r['name']}: {'struggling' if r['p_known'] < 0.4 else 'developing' if r['p_known'] < 0.7 else 'strong'} ({r['p_known']:.2f})"
        for r in mastery_rows
    ) if mastery_rows else "  No topics assessed yet."

    merge_prompt = f"""You maintain a learning profile for a data science student.

EXISTING PROFILE:
{existing or 'No profile yet — this is the first session.'}

NEW SESSION SUMMARY:
{session_summary}

CURRENT MASTERY SNAPSHOT:
{mastery_text}

Update the learning profile (5-8 sentences) to reflect the student's overall progress, 
persistent struggles, strengths, and learning patterns. Be specific and data-driven."""

    try:
        res = groq_client.chat.completions.create(
            model=SUMMARY_MODEL,
            messages=[{"role": "user", "content": merge_prompt}],
            max_tokens=400, temperature=0.3
        )
        new_summary = res.choices[0].message.content.strip()

        with db.cursor() as cur:
            cur.execute(
                """INSERT INTO user_memory (user_id, summary, session_count, last_updated)
                   VALUES (%s::uuid, %s, 1, NOW())
                   ON CONFLICT (user_id) DO UPDATE
                   SET summary      = EXCLUDED.summary,
                       session_count = user_memory.session_count + 1,
                       last_updated  = NOW()""",
                (user_id, new_summary)
            )
            db.commit()
        print(f"[update_rolling_summary] Updated memory for user {user_id}")
    except Exception as e:
        print(f"[update_rolling_summary] error: {e}")


# ── Main context builder ──────────────────────────────────────────────────────

TOPIC_NAMES = {
    "linear_algebra":           "Linear Algebra",
    "calculus":                 "Calculus",
    "programming_fundamentals": "Programming Fundamentals",
    "probability_statistics":   "Probability & Statistics",
    "data_manipulation":        "Data Manipulation",
    "data_visualization":       "Data Visualization",
    "sql_databases":            "SQL & Databases",
    "statistical_learning":     "Statistical Learning",
    "machine_learning":         "Machine Learning",
    "feature_engineering":      "Feature Engineering",
    "deep_learning":            "Deep Learning",
    "computer_vision":          "Computer Vision",
    "nlp":                      "NLP",
    "data_engineering":         "Data Engineering",
    "mlops":                    "MLOps",
}


def _get_mastery(user_id: str, topic_id: str, db) -> tuple:
    """Returns (p_known, level_string)."""
    if not topic_id:
        return 0.5, "intermediate"
    with db.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(
            "SELECT p_known FROM concept_mastery WHERE user_id=%s::uuid AND topic_id=%s",
            (user_id, topic_id)
        )
        row = cur.fetchone()
    p = row["p_known"] if row else 0.3
    level = "beginner" if p < 0.4 else "intermediate" if p < 0.7 else "advanced"
    return p, level


def build_prompt(
    user_id: str,
    session_id: str,
    current_topic_id: str,
    chunks: list,
    db,
    format_instructions: str = ""
) -> tuple:
    """
    Returns (system_prompt, history_messages).
    
    History construction (sliding window):
      - msg count <= 10:  full history
      - msg count 11-20:  combined_summary + last 5 messages  
      - msg count 21+:    last 5 messages only (user chose to stay)
    """

    # ── 1. Mastery ──
    p_known, mastery_level = _get_mastery(user_id, current_topic_id, db)
    topic_name = TOPIC_NAMES.get(current_topic_id, current_topic_id.replace("_", " ").title() if current_topic_id else "General")

    # ── 2. RAG context ──
    rag_context = "\n\n".join(
        f"[{c.get('doc_title', 'Source')} p.{c.get('page_number', '?')}]\n{c['content'][:600]}"
        for c in chunks[:4]
    ) if chunks else "No specific reference material found for this query."

    # ── 3. Student profile ──
    student_profile_parts = []

    # User memory — only inject if topic is a weak area
    if should_inject_user_memory(current_topic_id, user_id, db):
        user_mem = get_user_memory(user_id, db)
        if user_mem:
            student_profile_parts.append(f"LEARNING HISTORY:\n{user_mem}")

    # Weak topics summary
    weak = get_weak_topics(user_id, db)
    if weak:
        weak_names = [TOPIC_NAMES.get(t, t) for t in weak[:3]]
        student_profile_parts.append(f"KNOWN WEAK AREAS: {', '.join(weak_names)}")

    student_profile = "\n\n".join(student_profile_parts) if student_profile_parts else "New student — no history yet."

    # ── 4. System prompt ──
    system_prompt = SYSTEM_PROMPT_TEMPLATE.format(
        student_profile=student_profile,
        topic_name=topic_name,
        mastery_level=mastery_level,
        p_known=p_known,
        rag_context=rag_context,
        format_instructions=format_instructions,
    )

    # ── 5. Session memory ──
    memory = _get_or_create_session_memory(session_id, db)
    total_msgs = _count_messages(session_id, db)

    # ── 6. History construction (sliding window) ──
    history = []

    if total_msgs <= 10:
        # Full history — fetch all messages
        raw = _get_recent_messages(session_id, 20, db)
        history = [{"role": m["role"], "content": m["content"]} for m in raw]

    elif total_msgs <= 20:
        # Combined summary + last 5
        combined = memory.get("combined_summary", "")
        if combined:
            history.append({
                "role": "system",
                "content": f"[CONVERSATION SUMMARY — earlier in this session]\n{combined}"
            })
        last_5 = _get_recent_messages(session_id, 5, db)
        history.extend({"role": m["role"], "content": m["content"]} for m in last_5)

    else:
        # 21+ messages: only last 5 (user chose to stay past the banner)
        last_5 = _get_recent_messages(session_id, 5, db)
        history = [{"role": m["role"], "content": m["content"]} for m in last_5]

    return system_prompt, history


def get_message_count_for_session(session_id: str, db) -> int:
    """Public helper — used by chat.py to decide whether to send banner signal."""
    return _count_messages(session_id, db)