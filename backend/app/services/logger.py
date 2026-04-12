import time
import traceback as tb
from psycopg2.extras import RealDictCursor
from app.core.db import get_pg_pool


def log_api_call(
    user_id: str | None,
    model: str,
    prompt_tokens: int,
    completion_tokens: int,
    latency_ms: int,
    endpoint: str
) -> None:
    """Saves a Groq API call record to api_logs table."""
    try:
        pool = get_pg_pool()
        conn = pool.getconn()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO api_logs
                        (user_id, model, prompt_tokens, completion_tokens,
                         total_tokens, endpoint, latency_ms)
                    VALUES
                        (%s::uuid, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        user_id,
                        model,
                        prompt_tokens,
                        completion_tokens,
                        prompt_tokens + completion_tokens,
                        endpoint,
                        latency_ms
                    )
                )
                conn.commit()
        finally:
            pool.putconn(conn)
    except Exception as e:
        print(f"[Logger] log_api_call error: {e}")


def log_error(
    endpoint: str,
    method: str,
    error_type: str,
    error_message: str,
    traceback_str: str,
    user_id: str | None = None
) -> None:
    """Saves an error record to error_logs table."""
    try:
        pool = get_pg_pool()
        conn = pool.getconn()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO error_logs
                        (user_id, endpoint, method, error_type, error_message, traceback)
                    VALUES
                        (%s::uuid, %s, %s, %s, %s, %s)
                    """,
                    (user_id, endpoint, method, error_type, error_message, traceback_str)
                )
                conn.commit()
        finally:
            pool.putconn(conn)
    except Exception as e:
        print(f"[Logger] log_error error: {e}")


def timed_groq_call(client, model: str, messages: list, endpoint: str,
                    user_id: str | None = None, **kwargs) -> any:
    """
    Wraps a synchronous Groq completions call.
    Logs model, tokens, latency automatically.
    Returns the full response object.
    """
    start = time.time()
    response = client.chat.completions.create(
        model=model,
        messages=messages,
        **kwargs
    )
    latency_ms = int((time.time() - start) * 1000)

    usage = response.usage
    if usage:
        log_api_call(
            user_id=user_id,
            model=model,
            prompt_tokens=usage.prompt_tokens,
            completion_tokens=usage.completion_tokens,
            latency_ms=latency_ms,
            endpoint=endpoint
        )

    return response