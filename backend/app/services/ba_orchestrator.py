import asyncio
import json
import os
import time
from typing import AsyncGenerator, Optional

import google.generativeai as genai
import httpx

from app.core.db import qdrant_client
from app.services.ba_dream_agent import process_dream_queue
from app.services.ba_memory_service import (
    build_memory_prompt_block,
    get_palace_context,
    queue_dream_job,
)


async def memory_agent(user_id: str, topic_id: str, query: str) -> dict:
    """
    Fetches MemPalace context for student + topic.
    Runs in parallel with RAG and Tool agents.
    Returns palace_context dict or empty fallback.
    """
    try:
        loop = asyncio.get_event_loop()
        context = await loop.run_in_executor(
            None,
            get_palace_context,
            user_id,
            topic_id,
            query,
        )
        return context or {}
    except Exception as exc:
        print(f"[MemoryAgent] failed: {exc}")
        return {
            "current_topic": {},
            "weak_prerequisites": [],
            "relevant_fragments": [],
            "has_prior_context": False,
        }


async def rag_agent(
    query: str,
    user_id: str,
    session_id: str,
    doc_filter: Optional[str] = None,
) -> dict:
    """
    Retrieves relevant chunks from Qdrant.
    Searches ba_user_{user_id} + rag_chunks in parallel.
    Returns {"chunks": [...], "has_doc_hits": bool}
    """
    _ = session_id
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            embed_resp = await client.post(
                os.environ.get("EMBEDDING_SERVICE_URL", "http://127.0.0.1:8001") + "/embed",
                json={"texts": [query]},
            )
            embed_resp.raise_for_status()
            resp_data = embed_resp.json() or {}
            vectors = resp_data.get("vectors") or resp_data.get("embedding")
            if isinstance(vectors, list) and len(vectors) > 0:
                embedding = vectors[0] if isinstance(vectors[0], list) else vectors
            else:
                embedding = []

        if not embedding:
            return {"chunks": [], "has_doc_hits": False}

        loop = asyncio.get_event_loop()
        search_tasks = [
            loop.run_in_executor(
                None,
                lambda: qdrant_client.search(
                    collection_name="rag_chunks",
                    query_vector=embedding,
                    limit=3,
                    score_threshold=0.5,
                    with_payload=True,
                ),
            )
        ]

        doc_collection = f"ba_user_{user_id}"
        doc_searched = False

        try:
            collections = qdrant_client.get_collections()
            col_names = [c.name for c in collections.collections]
            if doc_collection in col_names:
                doc_searched = True
                filter_condition = None
                if doc_filter:
                    from qdrant_client.models import FieldCondition, Filter, MatchValue

                    filter_condition = Filter(
                        must=[
                            FieldCondition(
                                key="doc_id",
                                match=MatchValue(value=doc_filter),
                            )
                        ]
                    )

                search_tasks.append(
                    loop.run_in_executor(
                        None,
                        lambda: qdrant_client.search(
                            collection_name=doc_collection,
                            query_vector=embedding,
                            limit=3,
                            score_threshold=0.5,
                            query_filter=filter_condition,
                            with_payload=True,
                        ),
                    )
                )
        except Exception:
            pass

        results = await asyncio.gather(*search_tasks, return_exceptions=True)

        chunks = []
        has_doc_hits = False

        for idx, result in enumerate(results):
            if isinstance(result, Exception):
                continue

            is_doc_result = doc_searched and idx == 1
            for hit in result:
                payload = getattr(hit, "payload", None) or {}
                text = payload.get("text") or payload.get("content") or ""
                if not text:
                    continue

                chunks.append(
                    {
                        "text": text,
                        "score": float(getattr(hit, "score", 0.0) or 0.0),
                        "source": "document" if is_doc_result else "course",
                        "page": payload.get("page_number") or payload.get("page"),
                        "filename": payload.get("filename")
                        or payload.get("doc_title")
                        or "Course material",
                    }
                )
                if is_doc_result:
                    has_doc_hits = True

        chunks.sort(key=lambda x: x["score"], reverse=True)
        seen = set()
        unique = []
        for chunk in chunks:
            key = chunk["text"][:80]
            if key in seen:
                continue
            seen.add(key)
            unique.append(chunk)

        return {"chunks": unique[:6], "has_doc_hits": has_doc_hits}

    except Exception as exc:
        print(f"[RAGAgent] failed: {exc}")
        return {"chunks": [], "has_doc_hits": False}


TOOL_KEYWORDS = {
    "forge": [
        "explain in my own words",
        "concept forge",
        "/forge",
        "test my understanding",
        "feynman",
    ],
    "formula": [
        "calculate",
        "formula",
        "compute",
        "/formula",
        "what is the value",
        "solve for",
        "rfm score",
        "clv formula",
        "ped",
        "elasticity value",
        "eoq",
        "churn rate",
    ],
    "case": [
        "case study",
        "netflix",
        "amazon",
        "zomato",
        "walmart",
        "airbnb",
        "/case",
        "real world example",
        "how did",
        "company example",
    ],
    "exam": [
        "/exam",
        "test me",
        "practice question",
        "exam question",
        "quiz me",
        "assess me",
    ],
    "brief": [
        "/brief",
        "pre-class",
        "brief me",
        "prepare me",
        "what should i know before",
        "summarize the topic",
    ],
    "mcq": ["/mcq", "multiple choice", "mcq", "quick test"],
    "doc": ["/doc", "[doc_only]", "in my document", "from my upload", "search my file"],
}


async def tool_agent(message: str, topic_id: Optional[str], palace_context: dict) -> dict:
    """
    Decides which tool to activate based on message content
    and student's mastery state.
    """
    _ = topic_id
    msg_lower = message.lower()
    detected_tool = None
    doc_filter = None

    for tool, keywords in TOOL_KEYWORDS.items():
        if any(keyword in msg_lower for keyword in keywords):
            detected_tool = tool
            break

    if "[doc_only:" in msg_lower:
        start = msg_lower.index("[doc_only:") + 10
        end = msg_lower.index("]", start) if "]" in msg_lower[start:] else len(msg_lower)
        doc_filter = message[start:end].strip()

    suggest_tool = None
    current = palace_context.get("current_topic", {})
    p_known = float(current.get("p_known", 0) or 0)
    session_count = int(current.get("session_count", 0) or 0)

    if not detected_tool:
        if any(word in msg_lower for word in ["formula", "calculate", "compute"]):
            suggest_tool = "formula"
        elif p_known >= 0.4 and session_count >= 2:
            suggest_tool = "forge"
        elif p_known >= 0.7:
            suggest_tool = "exam"

    tool_data = {}
    if detected_tool == "formula":
        if any(word in msg_lower for word in ["rfm", "recency", "frequency", "monetary"]):
            tool_data["formula"] = "rfm"
        elif any(word in msg_lower for word in ["clv", "lifetime value", "customer value"]):
            tool_data["formula"] = "clv"
        elif any(word in msg_lower for word in ["elasticity", "ped", "price elasticity"]):
            tool_data["formula"] = "ped"
        elif any(word in msg_lower for word in ["eoq", "order quantity", "inventory"]):
            tool_data["formula"] = "eoq"
        elif any(word in msg_lower for word in ["churn", "retention rate"]):
            tool_data["formula"] = "churn"

    if detected_tool == "case":
        for company in ["netflix", "amazon", "zomato", "walmart", "airbnb"]:
            if company in msg_lower:
                tool_data["company"] = company
                break

    return {
        "tool": detected_tool,
        "tool_data": tool_data,
        "suggest_tool": suggest_tool,
        "doc_filter": doc_filter,
    }


async def response_agent(
    message: str,
    user_name: str,
    topic_id: Optional[str],
    memory_context: dict,
    rag_result: dict,
    tool_result: dict,
    session_messages: list,
) -> AsyncGenerator[str, None]:
    """Synthesizes all context and streams response via Gemini."""
    genai.configure(api_key=os.environ["GEMINI_API_KEY"])
    model_name = os.environ.get("GEMINI_MODEL", "gemini-3.1-flash-lite-preview")

    rag_block = ""
    if rag_result.get("chunks"):
        rag_block = "\n\n--- RELEVANT KNOWLEDGE ---\n"
        for chunk in rag_result["chunks"][:4]:
            rag_block += f"\n{chunk.get('text', '')[:600]}\n"
        rag_block += "--- END KNOWLEDGE ---"

    memory_block = ""
    if memory_context.get("has_prior_context"):
        memory_block = build_memory_prompt_block(memory_context)

    history_block = ""
    if session_messages:
        history_block = "\n\n--- CONVERSATION HISTORY ---\n"
        for msg in session_messages[-6:]:
            role = "Student" if msg.get("role") == "user" else "DataLingo"
            history_block += f"{role}: {msg.get('content', '')[:300]}\n"
        history_block += "--- END HISTORY ---"

    tool_instruction = ""
    tool = tool_result.get("tool")
    suggest = tool_result.get("suggest_tool")

    if tool == "formula":
        formula = (tool_result.get("tool_data") or {}).get("formula", "")
        tool_instruction = f"""
The student is asking about a formula.
Explain the formula clearly with:
1. What each variable means in plain English
2. A worked example with real numbers
3. When to use it in a business context
{f'Focus specifically on the {formula.upper()} formula.' if formula else ''}
The Formula Lab tool will open automatically for them to
practice calculations.
"""
    elif tool == "case":
        company = (tool_result.get("tool_data") or {}).get("company", "")
        tool_instruction = f"""
The student wants a case study.
{'Focus on ' + company.title() + '.' if company else ''}
Structure your response as:
1. Business context (2 sentences)
2. The analytics challenge they faced
3. What data/techniques they used
4. The outcome and what we can learn
Keep it concrete and business-focused.
The Case Study tool will open for deeper exploration.
"""
    elif tool == "exam":
        tool_instruction = """
Generate ONE case-based exam question on this topic.
Format:
- Scenario (3-4 sentences with real numbers)
- The question
- What a good answer should cover (as a brief rubric)
Do not give the answer - student will submit via Exam Simulator.
"""
    elif tool == "forge":
        tool_instruction = """
The student wants to test their understanding via Concept Forge.
Prompt them to explain the concept in their own words.
Tell them the Concept Forge tool is open on the right.
Be encouraging and explain what a good explanation includes.
"""
    elif tool == "brief":
        tool_instruction = """
Generate a pre-class brief for this topic. Structure:
1. What you already know (connect to prerequisites)
2. What's coming (3-4 key concepts to learn)
3. Watch out for (2 common misconceptions)
4. Key formula or framework to remember
Keep it under 250 words. Be direct and practical.
"""
    elif suggest:
        tool_instruction = f"""
After your explanation, naturally suggest the student
try the {suggest.title()} tool to practice
(mention it casually at the end, one sentence only).
"""

    prereq_warning = ""
    weak = memory_context.get("weak_prerequisites", [])
    if weak:
        prereq_warning = f"""
Note: Student has weak mastery of prerequisite topics:
{', '.join(str(w.get('topic_id', '')) for w in weak[:2])}.
Briefly acknowledge any connections to these topics
and keep explanations foundational.
"""

    system_prompt = f"""NEVER introduce yourself. NEVER say "Welcome" or "I'm DataLingo" or any greeting. NEVER announce what you are
about to do. Go straight to answering the question.
NEVER start with "Of course", "Sure", "Certainly", "Great question", or any filler opener.
Start your response with the actual answer immediately.

You are DataLingo, an intelligent BA (Business Analytics)
tutor for university students at Ramaiah University of Applied Sciences.

Student: {user_name}
Current topic: {topic_id or 'General BA'}
If the topic appears to be data science (neural networks,
backpropagation, regression, etc.) and the student is
a business analytics student, still answer helpfully
but connect it to business analytics context where possible.

Your personality:
- Direct and practical, not overly formal
- Use real business examples and numbers
- Connect concepts to real companies students know
- Adapt complexity to the student's mastery level
- Never condescending, always encouraging

{memory_block}
{prereq_warning}
{tool_instruction}

Format guidelines:
- Use markdown for structure when helpful
- Use LaTeX for formulas: $formula$ inline, $$formula$$ block
- Keep responses focused - don't dump everything at once
- If the question is simple, answer simply
- For complex topics, use numbered steps or clear sections"""

    user_prompt = f"""{history_block}
{rag_block}

Student's message: {message}"""

    model = genai.GenerativeModel(model_name=model_name, system_instruction=system_prompt)

    try:
        response = model.generate_content(
            user_prompt,
            stream=True,
            generation_config=genai.types.GenerationConfig(
                temperature=0.7,
                max_output_tokens=1500,
            ),
        )
        for chunk in response:
            text = getattr(chunk, "text", None)
            if text:
                yield text
    except Exception as exc:
        yield f"I encountered an error generating a response: {exc}"


async def run_ba_pipeline(
    message: str,
    user_id: str,
    user_name: str,
    session_id: str,
    session_messages: list,
    topic_id: Optional[str] = None,
) -> AsyncGenerator[str, None]:
    """
    Entry point. Fans out 3 agents in parallel,
    then streams response from Agent 4.
    Also handles tool activation signals for frontend.
    """
    start = time.time()

    memory_task = memory_agent(user_id, topic_id or "", message)
    rag_task = rag_agent(message, user_id, session_id)

    memory_result, rag_result = await asyncio.gather(memory_task, rag_task)
    tool_result = await tool_agent(message, topic_id, memory_result)

    if tool_result.get("doc_filter") or tool_result.get("tool") == "doc":
        rag_result = await rag_agent(
            message,
            user_id,
            session_id,
            doc_filter=tool_result.get("doc_filter"),
        )

    print(f"[BA Pipeline] agents completed in {(time.time() - start) * 1000:.0f}ms")

    tool = tool_result.get("tool")
    suggest = tool_result.get("suggest_tool")
    if tool and tool not in ("doc", "mcq"):
        signal = json.dumps(
            {
                "type": "tool_activate",
                "tool": tool,
                "tool_data": tool_result.get("tool_data", {}),
            }
        )
        yield f"[TOOL_SIGNAL]{signal}"
    elif suggest:
        signal = json.dumps({"type": "tool_suggest", "tool": suggest})
        yield f"[TOOL_SIGNAL]{signal}"

    async for token in response_agent(
        message=message,
        user_name=user_name,
        topic_id=topic_id,
        memory_context=memory_result,
        rag_result=rag_result,
        tool_result=tool_result,
        session_messages=session_messages,
    ):
        yield token

    try:
        topics_touched = [topic_id] if topic_id else []
        recent_text = " ".join(m.get("content", "")[:100] for m in session_messages[-3:])
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(
            None,
            queue_dream_job,
            user_id,
            session_id,
            topics_touched,
            recent_text,
        )
        await loop.run_in_executor(None, process_dream_queue)
    except Exception as exc:
        print(f"[BA Pipeline] dream queue error: {exc}")
