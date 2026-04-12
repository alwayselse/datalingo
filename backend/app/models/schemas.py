from pydantic import BaseModel
from typing import Optional, List
from uuid import UUID
from datetime import datetime

class LoginRequest(BaseModel):
    username: str
    password: str

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    role: Optional[str] = None
    name: Optional[str] = None
    course: Optional[str] = None

class ChatRequest(BaseModel):
    session_id: Optional[str] = None
    message: str

class SourceChunk(BaseModel):
    chunk_id: str
    content: str
    page_number: Optional[int]
    document_title: Optional[str]
    section_title: Optional[str]

class ChatResponse(BaseModel):
    session_id: str
    answer: str
    sources: List[SourceChunk]

class DocumentOut(BaseModel):
    id: str
    title: Optional[str]
    author: Optional[str]
    total_chunks: Optional[int]
    total_pages: Optional[int]
    status: Optional[str]
class PrereqAnswerRequest(BaseModel):
    session_id:     str
    topic_id:       str
    prereq_id:      str
    question:       str
    student_answer: str
    correct_answer: str

class SkipPrereqRequest(BaseModel):
    session_id: str
    prereq_id:  str