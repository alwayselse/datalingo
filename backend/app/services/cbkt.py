import re
import json
from groq import Groq
from psycopg2.extras import RealDictCursor
import time
from app.core.config import (
    GROQ_API_KEY,
    CBKT_LEARNING_PROBABILITY,
    CBKT_SLIP_PROBABILITY,
    CBKT_GUESS_PROBABILITY,
    CBKT_INITIAL_MASTERY,
)

client = Groq(api_key=GROQ_API_KEY)

P_LEARN = CBKT_LEARNING_PROBABILITY
P_SLIP  = CBKT_SLIP_PROBABILITY
P_GUESS = CBKT_GUESS_PROBABILITY
P_INIT  = CBKT_INITIAL_MASTERY

TOPIC_LIST = """
linear_algebra, calculus, programming_fundamentals, probability_statistics,
data_manipulation, data_visualization, sql_databases, statistical_learning,
machine_learning, feature_engineering, deep_learning, computer_vision,
nlp, data_engineering, mlops
"""

BA_TOPIC_LIST = """
ba_frameworks, customer_data, data_extraction, data_viz_dashboards,
rfm_analysis, customer_seg_clv, causality_ba, experimental_design,
ab_testing, pricing_analytics, price_elasticity, promo_optimization,
time_series_ba, trend_seasonality, forecasting_methods, churn_analytics,
inventory_control, supply_chain_kpis, text_sentiment, multivariate_testing,
ethics_bias, data_privacy, ba_capstone
"""

CLASSIFIER_PROMPT = """You are a topic classifier for a data science learning platform.
Given a student's question, identify which ONE topic it belongs to from this list:
{topic_list}
If the question doesn't clearly belong to any topic, respond with "none".
Respond with ONLY the topic_id (snake_case), nothing else. Example: "machine_learning" or "none"
Student question: {query}"""

BA_CLASSIFIER_PROMPT = """You are a topic classifier for a 
business analytics learning platform.
Given a student's question, identify which ONE topic it belongs 
to from this list:
{topic_list}
If the question doesn't clearly belong to any topic, respond 
with "none".
Respond with ONLY the topic_id (snake_case), nothing else. 
Example: "rfm_analysis" or "none"
Student question: {query}"""

MCQ_PROMPT = """You are a data science instructor. Generate 1 multiple choice question to assess a student's understanding of: {topic_name}
Respond with ONLY valid JSON, no markdown:
{{"question": "...", "options": {{"A": "...", "B": "...", "C": "...", "D": "..."}}, "correct": "A"}}"""

MCQ_PROMPT_WITH_LEVEL = """You are a data science instructor. Generate 1 multiple choice question to assess a student's understanding of: {topic_name}

Difficulty level: {level}
- easy: Basic definitions and recall. One option is clearly correct.
- medium: Application and understanding. Options are plausible, requires thinking.
- hard: Deep understanding, edge cases, nuances. All options seem reasonable.

Respond with ONLY valid JSON, no markdown:
{{"question": "...", "options": {{"A": "...", "B": "...", "C": "...", "D": "..."}}, "correct": "A", "explanation": "One sentence: why the correct answer is right."}}"""

MCQ_BATCH_PROMPT = """You are a data science instructor. Generate exactly {count} multiple choice questions to assess a student's understanding of: {topic_name}

Difficulty level for all questions: {level}
- easy: Basic definitions and recall.
- medium: Application and understanding. Options are plausible.
- hard: Deep understanding, edge cases, nuances.

Respond with ONLY a valid JSON array, no markdown, no extra text:
[
  {{"question": "...", "options": {{"A": "...", "B": "...", "C": "...", "D": "..."}}, "correct": "A", "explanation": "One sentence why correct."}},
  ...
]"""

MASTERY_TIERED_PROMPT = """You are a data science instructor. Generate exactly 3 multiple choice questions to assess a student's understanding of: {topic_name}

Generate one question at each difficulty:
1. EASY: Basic definition or recall. Very clear correct answer.
2. MEDIUM: Application or understanding. Plausible distractors.
3. HARD: Deep understanding, edge cases, or nuances.

Respond with ONLY a valid JSON array of exactly 3 objects, no markdown:
[
  {{"level": "easy",   "question": "...", "options": {{"A": "...", "B": "...", "C": "...", "D": "..."}}, "correct": "A", "explanation": "..."}},
  {{"level": "medium", "question": "...", "options": {{"A": "...", "B": "...", "C": "...", "D": "..."}}, "correct": "B", "explanation": "..."}},
  {{"level": "hard",   "question": "...", "options": {{"A": "...", "B": "...", "C": "...", "D": "..."}}, "correct": "C", "explanation": "..."}}
]"""

TOPIC_ALIASES = {
    "linear algebra": "linear_algebra",
    "calculus": "calculus",
    "programming": "programming_fundamentals",
    "programming fundamentals": "programming_fundamentals",
    "probability": "probability_statistics",
    "statistics": "probability_statistics",
    "probability and statistics": "probability_statistics",
    "data manipulation": "data_manipulation",
    "pandas": "data_manipulation",
    "data visualization": "data_visualization",
    "visualization": "data_visualization",
    "sql": "sql_databases",
    "databases": "sql_databases",
    "statistical learning": "statistical_learning",
    "machine learning": "machine_learning",
    "ml": "machine_learning",
    "feature engineering": "feature_engineering",
    "deep learning": "deep_learning",
    "dl": "deep_learning",
    "neural networks": "deep_learning",
    "computer vision": "computer_vision",
    "cv": "computer_vision",
    "nlp": "nlp",
    "natural language processing": "nlp",
    "data engineering": "data_engineering",
    "mlops": "mlops",
}

# Level → p_known mapping for tiered mastery assessment
LEVEL_P_KNOWN = {
    "easy":   0.35,
    "medium": 0.55,
    "hard":   0.80,
}


def classify_topic(query: str, user_id: str | None = None, course: str | None = None) -> str | None:
    from app.services.logger import log_api_call
    try:
        start = time.time()
        is_ba = (course or "").lower() == "business_analytics"
        prompt = BA_CLASSIFIER_PROMPT if is_ba else CLASSIFIER_PROMPT
        topic_list = BA_TOPIC_LIST if is_ba else TOPIC_LIST
        r = client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=[{"role": "user", "content": prompt.format(topic_list=topic_list, query=query)}],
            temperature=0.0, max_tokens=20
        )
        log_api_call(user_id=user_id, model="llama-3.1-8b-instant",
                     prompt_tokens=r.usage.prompt_tokens, completion_tokens=r.usage.completion_tokens,
                     latency_ms=int((time.time() - start) * 1000), endpoint="classify")
        result = r.choices[0].message.content.strip().lower()
        return None if result == "none" else result
    except Exception as e:
        print(f"[CBKT] classify_topic error: {e}")
        return None


def classify_topic_by_name(name: str) -> str | None:
    cleaned = name.strip().lower()
    if cleaned in TOPIC_ALIASES:
        return TOPIC_ALIASES[cleaned]
    for alias, topic_id in TOPIC_ALIASES.items():
        if alias in cleaned or cleaned in alias:
            return topic_id
    return classify_topic(cleaned)


def get_unassessed_prerequisites(user_id: str, topic_id: str, db) -> list[str]:
    with db.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute("SELECT prerequisites FROM topics WHERE id = %s", (topic_id,))
        row = cur.fetchone()
    if not row or not row["prerequisites"]:
        return []
    prereqs = row["prerequisites"]
    with db.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(
            "SELECT topic_id FROM concept_mastery WHERE user_id=%s::uuid AND topic_id=ANY(%s::varchar[])",
            (user_id, prereqs)
        )
        assessed = {r["topic_id"] for r in cur.fetchall()}
    return [p for p in prereqs if p not in assessed]


def pick_most_relevant_prereqs(prereqs: list[str], topic_id: str, query: str) -> list[str]:
    query_lower = query.lower()
    scored = []
    for p in prereqs:
        p_words = p.replace("_", " ").lower().split()
        score = sum(1 for w in p_words if w in query_lower)
        scored.append((score, p))
    scored.sort(reverse=True)
    return [p for _, p in scored[:2]]


def generate_mcq(topic_id: str, user_id: str | None = None) -> dict:
    from app.services.logger import log_api_call
    topic_name = topic_id.replace("_", " ").title()
    try:
        start = time.time()
        r = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[{"role": "user", "content": MCQ_PROMPT.format(topic_name=topic_name)}],
            temperature=0.7, max_tokens=400
        )
        log_api_call(user_id=user_id, model="llama-3.3-70b-versatile",
                     prompt_tokens=r.usage.prompt_tokens, completion_tokens=r.usage.completion_tokens,
                     latency_ms=int((time.time() - start) * 1000), endpoint="mcq")
        raw = r.choices[0].message.content.strip().replace("```json", "").replace("```", "").strip()
        mcq = json.loads(raw)
        mcq["topic_id"] = topic_id
        return mcq
    except Exception as e:
        print(f"[CBKT] generate_mcq error: {e}")
        return {
            "topic_id": topic_id,
            "question": f"Which best describes {topic_name} in data science?",
            "options": {"A": "A core DS concept", "B": "A web framework", "C": "A database engine", "D": "A front-end library"},
            "correct": "A"
        }


def generate_mcq_batch(topic_id: str, count: int, level: str = "medium", user_id: str | None = None) -> list[dict]:
    """Generate all N questions at once for /mcq session flow."""
    from app.services.logger import log_api_call
    topic_name = topic_id.replace("_", " ").title()
    count = max(1, min(count, 30))
    try:
        start = time.time()
        r = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[{"role": "user", "content": MCQ_BATCH_PROMPT.format(
                topic_name=topic_name, count=count, level=level
            )}],
            temperature=0.7, max_tokens=200 * count
        )
        log_api_call(user_id=user_id, model="llama-3.3-70b-versatile",
                     prompt_tokens=r.usage.prompt_tokens, completion_tokens=r.usage.completion_tokens,
                     latency_ms=int((time.time() - start) * 1000), endpoint="mcq_batch")
        raw = r.choices[0].message.content.strip().replace("```json", "").replace("```", "").strip()
        questions = json.loads(raw)
        for q in questions:
            q["topic_id"] = topic_id
            q.setdefault("explanation", "")
        return questions
    except Exception as e:
        print(f"[CBKT] generate_mcq_batch error: {e}")
        # Fallback: return count copies of a generic question
        return [{"topic_id": topic_id, "question": f"Question {i+1}: Which best describes {topic_name}?",
                 "options": {"A": "Core concept", "B": "Web framework", "C": "Database", "D": "Library"},
                 "correct": "A", "explanation": f"{topic_name} is a core DS concept."} for i in range(count)]


def generate_tiered_mcq(topic_id: str, user_id: str | None = None) -> list[dict]:
    """Generate 3 tiered questions (easy/medium/hard) for auto-trigger mastery assessment."""
    from app.services.logger import log_api_call
    topic_name = topic_id.replace("_", " ").title()
    try:
        start = time.time()
        r = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[{"role": "user", "content": MASTERY_TIERED_PROMPT.format(topic_name=topic_name)}],
            temperature=0.7, max_tokens=800
        )
        log_api_call(user_id=user_id, model="llama-3.3-70b-versatile",
                     prompt_tokens=r.usage.prompt_tokens, completion_tokens=r.usage.completion_tokens,
                     latency_ms=int((time.time() - start) * 1000), endpoint="mcq_tiered")
        raw = r.choices[0].message.content.strip()
        # Robust JSON extraction — find the JSON array even if surrounded by text
        raw = re.sub(r"```json|```", "", raw).strip()
        # Find array start/end
        start_idx = raw.find("[")
        end_idx   = raw.rfind("]")
        if start_idx != -1 and end_idx != -1:
            raw = raw[start_idx:end_idx + 1]
        questions = json.loads(raw)
        for q in questions:
            q["topic_id"] = topic_id
            q.setdefault("explanation", "")
        return questions
    except Exception as e:
        print(f"[CBKT] generate_tiered_mcq error: {e}")
        return [
            {"topic_id": topic_id, "level": "easy",   "question": f"Basic: What is {topic_name}?", "options": {"A": "Core DS concept", "B": "Web tool", "C": "Database", "D": "Language"}, "correct": "A", "explanation": ""},
            {"topic_id": topic_id, "level": "medium", "question": f"Apply: How is {topic_name} used?", "options": {"A": "For predictions", "B": "For styling", "C": "For routing", "D": "For storage"}, "correct": "A", "explanation": ""},
            {"topic_id": topic_id, "level": "hard",   "question": f"Deep: What is a limitation of {topic_name}?", "options": {"A": "Scalability", "B": "Color choice", "C": "Font size", "D": "Icon set"}, "correct": "A", "explanation": ""},
        ]


def set_mastery_from_tiered_results(user_id: str, topic_id: str, answers: list[dict], db) -> str:
    """
    Determine mastery level from tiered answers.
    answers: [{"level": "easy"|"medium"|"hard", "correct": True|False}]
    Logic: highest level answered correctly = mastery level.
    If none correct → beginner (p=0.2).
    """
    level_order = ["hard", "medium", "easy"]
    correct_levels = {a["level"] for a in answers if a["correct"]}

    determined_level = None
    for lvl in level_order:
        if lvl in correct_levels:
            determined_level = lvl
            break

    p_known = LEVEL_P_KNOWN.get(determined_level, 0.2) if determined_level else 0.2

    with db.cursor() as cur:
        cur.execute(
            """INSERT INTO concept_mastery
               (user_id, topic_id, p_known, mastery_score, last_assessed, assessment_count)
               VALUES (%s::uuid, %s, %s, %s, NOW(), 3)
               ON CONFLICT (user_id, topic_id)
               DO UPDATE SET p_known=%s, mastery_score=%s, last_assessed=NOW(),
               assessment_count=concept_mastery.assessment_count+3""",
            (user_id, topic_id, p_known, p_known, p_known, p_known)
        )
        db.commit()

    return determined_level or "beginner"


def score_answer(student_answer: str, correct_answer: str) -> float:
    return 1.0 if student_answer.strip().upper() == correct_answer.strip().upper() else 0.0


def update_bkt(p_known: float, correct: bool) -> float:
    p_c_k = 1 - P_SLIP
    p_c_u = P_GUESS
    if correct:
        num = p_c_k * p_known
        den = (p_c_k * p_known) + (p_c_u * (1 - p_known))
    else:
        num = P_SLIP * p_known
        den = (P_SLIP * p_known) + ((1 - P_GUESS) * (1 - p_known))
    p_obs = num / den if den != 0 else p_known
    return min(p_obs + (1 - p_obs) * P_LEARN, 0.99)


def update_mastery(user_id: str, topic_id: str, correct: bool, db) -> tuple[float, float]:
    with db.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute("SELECT p_known FROM concept_mastery WHERE user_id=%s::uuid AND topic_id=%s", (user_id, topic_id))
        row = cur.fetchone()
    p_before = row["p_known"] if row else P_INIT
    p_after  = update_bkt(p_before, correct)
    with db.cursor() as cur:
        cur.execute(
            """INSERT INTO concept_mastery
               (user_id, topic_id, p_known, mastery_score, last_assessed, assessment_count)
               VALUES (%s::uuid, %s, %s, %s, NOW(), 1)
               ON CONFLICT (user_id, topic_id)
               DO UPDATE SET p_known=%s, mastery_score=%s, last_assessed=NOW(),
               assessment_count=concept_mastery.assessment_count+1""",
            (user_id, topic_id, p_after, p_after, p_after, p_after)
        )
        db.commit()
    return p_before, p_after


def save_mastery_event(user_id, topic_id, session_id, question, student_answer, score, p_before, p_after, db):
    with db.cursor() as cur:
        cur.execute(
            """INSERT INTO mastery_events
               (user_id, topic_id, session_id, question, student_answer, score, p_known_before, p_known_after)
               VALUES (%s::uuid, %s, %s::uuid, %s, %s, %s, %s, %s)""",
            (user_id, topic_id, session_id if session_id else None,
             question, student_answer, score, p_before, p_after)
        )
        db.commit()