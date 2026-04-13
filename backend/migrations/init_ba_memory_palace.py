import os

import psycopg2
from dotenv import load_dotenv


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
    conn = _get_pg_connection()

    inserted = 0
    students = []
    topics = []

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
            students = [str(row[0]) for row in cur.fetchall()]

            cur.execute(
                """
                SELECT id
                FROM topics
                WHERE course = 'business_analytics'
                ORDER BY order_index ASC, created_at ASC
                """
            )
            topics = [str(row[0]) for row in cur.fetchall()]

            for user_id in students:
                for topic_id in topics:
                    cur.execute(
                        """
                        INSERT INTO ba_memory_palace (user_id, topic_id)
                        VALUES (%s, %s)
                        ON CONFLICT (user_id, topic_id) DO NOTHING
                        """,
                        (user_id, topic_id),
                    )
                    inserted += cur.rowcount

        conn.commit()
        print(
            f"Initialized {inserted} rows - {len(students)} students, {len(topics)} topics"
        )
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    main()
