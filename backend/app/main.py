import traceback
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from app.api import auth, chat, documents, analytics, admin, ba_documents
from app.core.db import get_pg_pool
from app.core.config import ALLOW_ORIGINS
from app.services.logger import log_error
from contextlib import asynccontextmanager

@asynccontextmanager
async def lifespan(app: FastAPI):
    get_pg_pool()
    print("✅ Postgres pool ready")
    yield

app = FastAPI(title="Datalingo API", version="0.1.0", lifespan=lifespan)

# ── Error logging middleware ──────────────────────────────────────────────────
@app.middleware("http")
async def error_logging_middleware(request: Request, call_next):
    try:
        response = await call_next(request)
        return response
    except Exception as e:
        log_error(
            endpoint=str(request.url.path),
            method=request.method,
            error_type=type(e).__name__,
            error_message=str(e),
            traceback_str=traceback.format_exc(),
            user_id=None
        )
        return JSONResponse(
            status_code=500,
            content={"detail": "Internal server error"}
        )

# ── CORS ──────────────────────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOW_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Session-ID"],
)

# ── Routers ───────────────────────────────────────────────────────────────────
app.include_router(auth.router)
app.include_router(chat.router)
app.include_router(documents.router)
app.include_router(ba_documents.router)
app.include_router(analytics.router)
app.include_router(admin.router)

@app.get("/health")
def health():
    return {"status": "ok", "service": "Datalingo API"}