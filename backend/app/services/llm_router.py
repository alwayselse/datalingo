import time
from groq import Groq
from app.core.config import GROQ_API_KEY
from typing import Generator

client = Groq(api_key=GROQ_API_KEY)

def route_model(query: str) -> str:
    query_lower = query.lower()
    if any(w in query_lower for w in ["code", "implement", "write", "debug", "function", "error", "syntax"]):
        return "llama-3.1-8b-instant"
    return "llama-3.3-70b-versatile"

def stream_response(
    query: str,
    system_prompt: str,
    history: list,
    user_id: str | None = None
) -> Generator:
    from app.services.logger import log_api_call
    model    = route_model(query)
    recent_history = history[-6:]
    messages = [{"role": "system", "content": system_prompt}]
    for msg in recent_history:
        messages.append({"role": msg["role"], "content": msg["content"]})

    # Avoid duplicate current-turn user message if history already contains it.
    last_msg = recent_history[-1] if recent_history else None
    is_duplicate_user_turn = (
        last_msg
        and last_msg.get("role") == "user"
        and last_msg.get("content", "").strip() == query.strip()
    )
    if not is_duplicate_user_turn:
        messages.append({"role": "user", "content": query})

    start  = time.time()
    stream = client.chat.completions.create(
        model=model,
        messages=messages,
        max_tokens=1024,
        stream=True
    )

    full_text = []
    for chunk in stream:
        delta = chunk.choices[0].delta.content
        if delta:
            full_text.append(delta)
            yield delta

    # Estimate tokens from output length (4 chars ≈ 1 token)
    completion_tokens = len("".join(full_text)) // 4
    # Estimate prompt tokens from messages length
    prompt_text       = " ".join(m["content"] for m in messages)
    prompt_tokens     = len(prompt_text) // 4
    latency_ms        = int((time.time() - start) * 1000)

    log_api_call(
        user_id=user_id,
        model=model,
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        latency_ms=latency_ms,
        endpoint="chat"
    )