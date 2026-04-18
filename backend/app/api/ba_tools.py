import asyncio
import json
import os
import re
from typing import Any

import google.generativeai as genai
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.api.auth import get_current_user
from app.core.db import get_db
from app.services.ba_memory_service import (
    get_palace_context,
    update_palace_node,
    write_fragment,
)

router = APIRouter()


def _normalize_topic_id(topic_id: str) -> str:
    raw = (topic_id or "").strip().lower()
    if not raw:
        return raw

    # Accept already-normalized IDs.
    if re.fullmatch(r"[a-z0-9_]+", raw):
        return raw

    raw = raw.replace("&", " and ").replace("/", " ")
    raw = re.sub(r"[^a-z0-9]+", "_", raw)
    raw = re.sub(r"_+", "_", raw).strip("_")
    return raw


def _require_ba(current_user=Depends(get_current_user)):
    if (current_user.get("course") or "") != "business_analytics":
        raise HTTPException(status_code=403, detail="BA course only")
    return current_user


require_ba = _require_ba


def _get_gemini() -> genai.GenerativeModel:
    genai.configure(api_key=os.environ["GEMINI_API_KEY"])
    return genai.GenerativeModel(
        os.environ.get("GEMINI_MODEL", "gemini-3.1-flash-lite-preview")
    )


def _extract_json_payload(text: str) -> dict[str, Any]:
    cleaned = (text or "").strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?", "", cleaned, flags=re.IGNORECASE).strip()
    if cleaned.endswith("```"):
        cleaned = cleaned[: -3].strip()

    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", cleaned, flags=re.DOTALL)
        if not match:
            raise
        parsed = json.loads(match.group(0))

    if not isinstance(parsed, dict):
        raise json.JSONDecodeError("Expected JSON object", cleaned, 0)
    return parsed


class ForgeRequest(BaseModel):
    topic_id: str
    explanation: str
    session_id: str


class ForgeResponse(BaseModel):
    score: int
    overall: str
    what_you_got_right: list[str]
    what_to_strengthen: list[str]
    corrected_explanation: str


@router.post("/forge", response_model=ForgeResponse)
async def concept_forge(
    body: ForgeRequest,
    current_user=Depends(_require_ba),
    db=Depends(get_db),
):
    _ = db
    model = _get_gemini()
    topic_id = _normalize_topic_id(body.topic_id)

    prompt = f"""
A business analytics student explained this concept:

Topic: {topic_id.replace('_', ' ').title()}
Their explanation: "{body.explanation}"

Evaluate their understanding. Return ONLY valid JSON:
{{
  "score": <1-10>,
  "overall": "<one sentence verdict>",
  "what_you_got_right": ["<point>", "<point>"],
  "what_to_strengthen": ["<point>", "<point>"],
  "corrected_explanation": "<ideal 2-sentence explanation>"
}}

Scoring guide:
1-3: Major misconceptions or very incomplete
4-6: Correct direction but missing key elements
7-8: Good understanding, minor gaps
9-10: Clear, accurate, well-articulated

Be encouraging but honest. Never hallucinate correct points.
"""

    try:
        response = model.generate_content(prompt)
        result = _extract_json_payload(getattr(response, "text", "") or "")

        result.setdefault("score", 1)
        result.setdefault("overall", "Good effort.")
        result.setdefault("what_you_got_right", [])
        result.setdefault("what_to_strengthen", [])
        result.setdefault("corrected_explanation", "")

        loop = asyncio.get_event_loop()
        await loop.run_in_executor(
            None,
            write_fragment,
            str(current_user["id"]),
            topic_id,
            "forge_attempt",
            f"Score {result['score']}/10: {body.explanation[:200]}",
            body.session_id,
            {"score": result["score"], "feedback": result["overall"]},
        )

        existing = await loop.run_in_executor(
            None,
            get_palace_context,
            str(current_user["id"]),
            topic_id,
            "",
        )
        current_attempts = (
            (existing or {}).get("current_topic", {}).get("forge_attempts", []) or []
        )
        if not isinstance(current_attempts, list):
            current_attempts = []

        current_attempts.append(
            {
                "score": result["score"],
                "attempt": body.explanation[:200],
                "feedback": result["overall"],
            }
        )

        await loop.run_in_executor(
            None,
            update_palace_node,
            str(current_user["id"]),
            topic_id,
            {"forge_attempts": current_attempts},
        )

        return ForgeResponse(**result)
    except json.JSONDecodeError:
        raise HTTPException(status_code=500, detail="Failed to parse evaluation")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


class ExamRequest(BaseModel):
    topic_id: str
    difficulty: str
    session_id: str


class ExamSubmitRequest(BaseModel):
    topic_id: str
    question: str
    answer: str
    session_id: str


@router.post("/exam/generate")
async def exam_generate(body: ExamRequest, current_user=Depends(_require_ba)):
    _ = current_user
    model = _get_gemini()
    topic_id = _normalize_topic_id(body.topic_id)

    prompt = f"""
Generate ONE case-based exam question for a business analytics
student.

Topic: {topic_id.replace('_', ' ').title()}
Difficulty: {body.difficulty}
Student level context:
  beginner = first time seeing this topic
  intermediate = understands basics, needs application
  advanced = ready for complex multi-step problems

Return ONLY valid JSON:
{{
  "question": "<scenario + question, 4-6 sentences, include real numbers>",
  "type": "case_based",
  "difficulty": "{body.difficulty}",
  "hints": ["<hint if stuck>"],
  "rubric": [
    {{"criterion": "<what to check>", "points": <1-5>}},
    {{"criterion": "<what to check>", "points": <1-5>}}
  ],
  "total_points": <sum of rubric points>
}}

Use realistic company names and numbers.
Do NOT include the answer.
"""

    try:
        response = model.generate_content(prompt)
        return _extract_json_payload(getattr(response, "text", "") or "")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/exam/submit")
async def exam_submit(body: ExamSubmitRequest, current_user=Depends(_require_ba)):
    model = _get_gemini()
    topic_id = _normalize_topic_id(body.topic_id)

    prompt = f"""
Grade this student's answer to a business analytics exam question.

Topic: {topic_id.replace('_', ' ').title()}
Question: {body.question}
Student's answer: {body.answer}

Return ONLY valid JSON:
{{
  "score": <0-100>,
  "grade": "<A/B/C/D/F>",
  "overall_feedback": "<2-3 sentence assessment>",
  "rubric_breakdown": [
    {{
      "criterion": "<what was checked>",
      "achieved": <true/false>,
      "feedback": "<specific comment>"
    }}
  ],
  "model_answer_hints": ["<key point they may have missed>"],
  "encourage": "<one encouraging sentence>"
}}
"""

    try:
        response = model.generate_content(prompt)
        result = _extract_json_payload(getattr(response, "text", "") or "")

        # Memory logging should never block returning the grade to the student.
        try:
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(
                None,
                write_fragment,
                str(current_user["id"]),
                topic_id,
                "forge_attempt",
                f"Exam score {result.get('score', 0)}/100: {body.answer[:150]}",
                body.session_id,
                {"score": result.get("score", 0), "type": "exam"},
            )
        except Exception:
            pass

        return result
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


class BriefRequest(BaseModel):
    topic_id: str
    session_id: str


@router.post("/brief")
async def preclass_brief(
    body: BriefRequest,
    current_user=Depends(_require_ba),
    db=Depends(get_db),
):
    _ = db
    model = _get_gemini()
    topic_id = _normalize_topic_id(body.topic_id)

    loop = asyncio.get_event_loop()
    palace = await loop.run_in_executor(
        None,
        get_palace_context,
        str(current_user["id"]),
        topic_id,
        f"prepare me for {topic_id}",
    )

    prior = (palace or {}).get("current_topic", {}) or {}
    weak_prereqs = (palace or {}).get("weak_prerequisites", []) or []
    summary = prior.get("understanding_summary", "")

    prompt = f"""
Generate a pre-class preparation brief for a BA student.

Topic: {topic_id.replace('_', ' ').title()}
{f"What they already know: {summary}" if summary else "Student has not studied this topic yet."}
{f"Weak prerequisites: {', '.join(str(w.get('topic_id')) for w in weak_prereqs)}" if weak_prereqs else ""}

Return ONLY valid JSON:
{{
  "topic": "{topic_id}",
  "read_time_minutes": <2-8>,
  "what_you_know": [
    "<connection to something they likely already know>"
  ],
  "whats_coming": [
    {{"concept": "<name>", "why_it_matters": "<1 sentence>"}}
  ],
  "watch_out_for": [
    {{"misconception": "<common mistake>", "reality": "<correct understanding>"}}
  ],
  "key_formula": {{
    "name": "<formula name or null>",
    "expression": "<LaTeX or plain text>",
    "plain_english": "<what it calculates>"
  }},
  "warm_up_question": "<one question to think about before starting>"
}}

Be specific to business analytics. Use real examples.
Keep what_you_know encouraging and relatable.
"""

    try:
        response = model.generate_content(prompt)
        return _extract_json_payload(getattr(response, "text", "") or "")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


class CaseChatRequest(BaseModel):
    case_id: str
    case_company: str
    case_context: str
    message: str
    history: list
    session_id: str


@router.post("/case-chat")
async def case_chat(
    body: CaseChatRequest,
    current_user=Depends(require_ba),
):
    _ = current_user
    genai.configure(api_key=os.environ["GEMINI_API_KEY"])
    model_name = os.environ.get("GEMINI_MODEL", "gemini-3.1-flash-lite-preview")

    system_prompt = f"""You are a Business Analytics tutor
discussing a specific case study with a university student.

Case: {body.case_company}
Case context: {body.case_context}

Your role:
- Answer questions ONLY in the context of this case study
- Connect answers to specific BA techniques and data from the case
- Use the actual numbers and metrics from the case in your answers
- When asked for calculations, work through them step by step
- Challenge the student to think critically, not just recall facts
- If asked something outside this case, bring it back:
  "In the context of {body.case_company}..."
- Keep answers focused and under 200 words unless calculation
  requires more space
- NEVER introduce yourself or say "Great question"
- Start your answer immediately

Format: use markdown. Use $formula$ for inline math.
Be direct, specific, and educational."""

    history_text = ""
    for msg in body.history[-6:]:
        role = "Student" if msg.get("role") == "user" else "Tutor"
        history_text += f"{role}: {msg.get('content', '')[:300]}\n"

    user_prompt = f"""{history_text}
Student: {body.message}"""

    model = genai.GenerativeModel(
        model_name=model_name,
        system_instruction=system_prompt,
    )

    def generate():
        try:
            response = model.generate_content(
                user_prompt,
                stream=True,
                generation_config=genai.types.GenerationConfig(
                    temperature=0.7,
                    max_output_tokens=800,
                ),
            )
            for chunk in response:
                if chunk.text:
                    yield f"data: {chunk.text}\n\n"
            yield "data: [DONE]\n\n"
        except Exception as e:
            yield f"data: Error: {str(e)}\n\n"
            yield "data: [DONE]\n\n"

    from fastapi.responses import StreamingResponse as SR
    return SR(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
