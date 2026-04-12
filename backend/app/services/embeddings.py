from typing import List

import requests
from app.core.config import EMBEDDING_SERVICE_URL


def get_embedding(text: str, timeout: int = 30) -> List[float]:
    if not text:
        return []

    # Preferred contract: {"embedding": [...]}
    try:
        resp = requests.post(
            f"{EMBEDDING_SERVICE_URL}/embed",
            json={"text": text},
            timeout=timeout,
        )
        if resp.ok:
            payload = resp.json()
            embedding = payload.get("embedding") if isinstance(payload, dict) else None
            if isinstance(embedding, list) and embedding:
                return embedding
    except Exception:
        pass

    # Backward-compatible contract: {"vectors": [[...]]}
    resp = requests.post(
        f"{EMBEDDING_SERVICE_URL}/embed",
        json={"texts": [text]},
        timeout=timeout,
    )
    resp.raise_for_status()
    payload = resp.json()
    vectors = payload.get("vectors") if isinstance(payload, dict) else None
    if isinstance(vectors, list) and vectors and isinstance(vectors[0], list):
        return vectors[0]

    raise ValueError("Embedding service returned invalid payload")