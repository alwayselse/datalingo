from psycopg2 import pool
from psycopg2.extras import RealDictCursor
from qdrant_client import QdrantClient
from app.core.config import (
    POSTGRES_HOST, POSTGRES_PORT, POSTGRES_DB,
    POSTGRES_USER, POSTGRES_PASSWORD,
    QDRANT_HOST, QDRANT_PORT
)
import psycopg2

# ── Postgres connection pool ──────────────────────────────
_pg_pool = None

def get_pg_pool():
    global _pg_pool
    if _pg_pool is None:
        _pg_pool = pool.ThreadedConnectionPool(
            minconn=2,
            maxconn=10,
            host=POSTGRES_HOST,
            port=POSTGRES_PORT,
            dbname=POSTGRES_DB,
            user=POSTGRES_USER,
            password=POSTGRES_PASSWORD,
            sslmode='disable'
        )
    return _pg_pool

def get_db():
    pg_pool = get_pg_pool()
    conn = pg_pool.getconn()
    try:
        yield conn
    finally:
        pg_pool.putconn(conn)

def get_db_connection():
    return get_pg_pool().getconn()

def release_db_connection(conn):
    get_pg_pool().putconn(conn)

# ── Qdrant client ─────────────────────────────────────────
qdrant_client = QdrantClient(
    host=QDRANT_HOST,
    port=QDRANT_PORT,
    check_compatibility=False
)