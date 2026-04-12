from fastapi import APIRouter, Depends
from app.api.auth import get_current_user
from app.core.db import get_db
from psycopg2.extras import RealDictCursor

router = APIRouter(prefix="/documents", tags=["documents"])

@router.get("/")
def list_documents(user=Depends(get_current_user), db=Depends(get_db)):
    with db.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(
            "SELECT id, title, author, total_chunks, total_pages, status FROM documents ORDER BY title"
        )
        rows = cur.fetchall()
    return [dict(r) for r in rows]

@router.get("/{doc_id}/chunks")
def get_chunks(doc_id: str, user=Depends(get_current_user), db=Depends(get_db)):
    with db.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(
            """SELECT id, chunk_index, content, page_number 
               FROM chunks WHERE document_id=%s::uuid 
               ORDER BY chunk_index""",
            (doc_id,)
        )
        rows = cur.fetchall()
    return [dict(r) for r in rows]