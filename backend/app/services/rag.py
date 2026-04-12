from app.core.db import qdrant_client
from app.core.config import QDRANT_COLLECTION, RETRIEVAL_TOP_K
from psycopg2.extras import RealDictCursor
from app.services.embeddings import get_embedding

def retrieve_chunks(query: str, db, top_k: int = RETRIEVAL_TOP_K):
    # 1. Get embedding from VPS embedding service
    query_vector = get_embedding(query)

    # 2. Search Qdrant
    results = qdrant_client.query_points(
        collection_name=QDRANT_COLLECTION,
        query=query_vector,
        limit=top_k,
        with_payload=True
    ).points

    if not results:
        return [], ""

    # 3. Get vector_ids
    vector_ids = [str(r.id) for r in results]

    # 4. Fetch from Postgres
    with db.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(
            """
            SELECT c.id, c.content, c.page_number, c.vector_id,
                   d.title as doc_title,
                   s.title as section_title
            FROM chunks c
            LEFT JOIN documents d ON c.document_id = d.id
            LEFT JOIN sections s ON c.section_id = s.id
            WHERE c.vector_id = ANY(%s)
            AND c.status = 'synced'
            """,
            (vector_ids,)
        )
        chunks = cur.fetchall()

    # 5. Build context string
    context = "\n\n---\n\n".join([
        f"[Source: {c['doc_title']}, Page {c['page_number']}]\n{c['content']}"
        for c in chunks
    ])

    return chunks, context