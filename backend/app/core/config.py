from dotenv import load_dotenv
import os
from pathlib import Path

# Load .env from project root (portable across machines/environments).
PROJECT_ROOT = Path(__file__).resolve().parents[3]
load_dotenv(PROJECT_ROOT / ".env")

POSTGRES_HOST     = os.getenv("POSTGRES_HOST", "127.0.0.1")
POSTGRES_PORT     = int(os.getenv("POSTGRES_PORT", 5433))
POSTGRES_DB       = os.getenv("POSTGRES_DB", "rag_db")
POSTGRES_USER     = os.getenv("POSTGRES_USER", "rag_user")
POSTGRES_PASSWORD = os.getenv("POSTGRES_PASSWORD", "rag_password")

QDRANT_HOST       = os.getenv("QDRANT_HOST", "127.0.0.1")
QDRANT_PORT       = int(os.getenv("QDRANT_PORT", 6333))
QDRANT_COLLECTION = os.getenv("QDRANT_COLLECTION", "rag_chunks")

SECRET_KEY        = os.getenv("SECRET_KEY")
if not SECRET_KEY:
	raise RuntimeError("SECRET_KEY environment variable is required")

ALGORITHM         = os.getenv("ALGORITHM", "HS256")
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", 1440))

GROQ_API_KEY      = os.getenv("GROQ_API_KEY")
GEMINI_API_KEY    = os.getenv("GEMINI_API_KEY")
GEMINI_MODEL      = os.getenv("GEMINI_MODEL", "gemini-2.5-flash-lite")
EMBEDDING_MODEL   = os.getenv("EMBEDDING_MODEL_NAME", "all-MiniLM-L6-v2")
EMBEDDING_SERVICE_URL = os.getenv("EMBEDDING_SERVICE_URL", "http://127.0.0.1:8001")
BA_UPLOAD_DIR     = os.getenv("BA_UPLOAD_DIR", "/home/deploy/uploads/ba")
CBKT_LEARNING_PROBABILITY = float(os.getenv("CBKT_LEARNING_PROBABILITY", 0.2))
CBKT_SLIP_PROBABILITY = float(os.getenv("CBKT_SLIP_PROBABILITY", 0.1))
CBKT_GUESS_PROBABILITY = float(os.getenv("CBKT_GUESS_PROBABILITY", 0.2))
CBKT_INITIAL_MASTERY = float(os.getenv("CBKT_INITIAL_MASTERY", 0.3))
RETRIEVAL_TOP_K   = int(os.getenv("RETRIEVAL_TOP_K", 5))
ALLOW_ORIGINS     = [
	origin.strip()
	for origin in os.getenv("ALLOW_ORIGINS", "http://localhost:3000").split(",")
	if origin.strip()
]