from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import OAuth2PasswordBearer
from passlib.context import CryptContext
from jose import jwt, JWTError
from datetime import datetime, timedelta
from app.models.schemas import LoginRequest, TokenResponse
from app.core.config import SECRET_KEY, ALGORITHM, ACCESS_TOKEN_EXPIRE_MINUTES
from app.core.db import get_db
from psycopg2.extras import RealDictCursor

router = APIRouter(prefix="/auth", tags=["auth"])
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")

def create_token(data: dict):
    payload = data.copy()
    payload.setdefault("exp", datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)

def get_current_user(token: str = Depends(oauth2_scheme), db=Depends(get_db)):
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = payload.get("sub")
        if not user_id:
            raise HTTPException(status_code=401, detail="Invalid token")
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")

    with db.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute("SELECT * FROM users WHERE id=%s::uuid", (user_id,))
        user = cur.fetchone()

    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user

@router.post("/login", response_model=TokenResponse)
def login(body: LoginRequest, db=Depends(get_db)):
    with db.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(
            """
            SELECT id, email, username, hashed_password, role, name, course
            FROM users
            WHERE email = %s
            """,
            (body.username.lower().strip(),)
        )
        user = cur.fetchone()

    if not user or not pwd_context.verify(body.password, user["hashed_password"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    payload = {
        "sub":  str(user["id"]),
        "role": user["role"],
        "name": user.get("name") or user["username"],  # real name from DB, fallback to username
        "course": user.get("course") or "data_science",
        "exp": datetime.utcnow() + timedelta(hours=24),
    }
    token = create_token(payload)
    return TokenResponse(
        access_token=token,
        token_type="bearer",
        role=user["role"],
        name=user.get("name") or user["username"],
        course=user.get("course") or "data_science",
    )