import os

import psycopg2
from dotenv import load_dotenv
from qdrant_client import QdrantClient
from qdrant_client.http.models import Distance, VectorParams


def _load_env() -> None:
    # Required production path.
    load_dotenv("/home/deploy/datalingo/.env")
    # Local workspace fallback for development.
    load_dotenv(os.path.join(os.path.dirname(__file__), "..", "..", ".env"))


def _get_pg_connection():
    return psycopg2.connect(
        host=os.getenv("POSTGRES_HOST", "127.0.0.1"),
        port=int(os.getenv("POSTGRES_PORT", "5432")),
        dbname=os.getenv("POSTGRES_DB", "rag_db"),
        user=os.getenv("POSTGRES_USER", "rag_user"),
        password=os.getenv("POSTGRES_PASSWORD", "rag_password"),
    )


def main() -> None:
    _load_env()

    qdrant = QdrantClient(host="127.0.0.1", port=6333, timeout=60)
    conn = _get_pg_connection()

    created = 0
    skipped = 0

    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id
                FROM users
                WHERE course = 'business_analytics'
                ORDER BY username ASC
                """
            )
            user_rows = cur.fetchall()

        existing = {
            c.name
            for c in qdrant.get_collections().collections
        }

        for (user_id,) in user_rows:
            collection_name = f"ba_memory_{user_id}"
            if collection_name in existing:
                print(f"SKIP {collection_name}")
                skipped += 1
                continue

            qdrant.create_collection(
                collection_name=collection_name,
                vectors_config=VectorParams(size=1024, distance=Distance.COSINE),
            )
            print(f"OK   {collection_name}")
            created += 1

        print(f"Created {created} / Skipped {skipped} collections")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
