from pydantic import BaseModel, EmailStr, Field, ConfigDict
from typing import Optional, List, Literal
from datetime import datetime

def to_camel(string: str) -> str:
    parts = string.split('_')
    return parts[0] + ''.join(word.capitalize() for word in parts[1:])

class CamelModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        from_attributes=True
    )

class TokenUsage(BaseModel):
    total: int = 0
    flash: int = 0
    pro: int = 0

class UserBase(BaseModel):
    email: EmailStr
    username: str

class UserCreate(UserBase):
    password: str

class UserResponse(UserBase):
    model_config = ConfigDict(
        populate_by_name=True,
        from_attributes=True
    )
    
    uid: str
    role: Literal["user", "admin"] = "user"
    tokensUsed: TokenUsage = Field(default_factory=TokenUsage, serialization_alias="tokensUsed")
    createdAt: Optional[datetime] = Field(default=None, serialization_alias="createdAt")
    lastAccessed: Optional[datetime] = Field(default=None, serialization_alias="lastAccessed")

class LoginRequest(BaseModel):
    email: EmailStr
    password: str

class RegisterRequest(BaseModel):
    email: EmailStr
    password: str
    username: str

class ResetPasswordRequest(BaseModel):
    email: EmailStr

class AuthResponse(BaseModel):
    token: str
    user: UserResponse

class ProjectFile(BaseModel):
    name: str
    content: str
    type: Literal["tex", "bib", "cls", "sty", "png", "jpg", "pdf"] = "tex"

class ProjectCreate(BaseModel):
    name: str
    theme: str
    custom_theme: Optional[str] = None

class ProjectUpdate(BaseModel):
    project_id: str
    files: List[ProjectFile]

class ProjectResponse(BaseModel):
    id: str
    name: str
    files: List[ProjectFile]
    main_file: str
    theme: str
    custom_theme: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

class CompileRequest(BaseModel):
    project_id: str
    main_file: str
    files: List[ProjectFile]

class CompileResponse(BaseModel):
    success: bool
    pdf_url: Optional[str] = None
    error: Optional[str] = None

class AutocompleteRequest(BaseModel):
    context: str
    cursor_position: int
    file_name: str

class AutocompleteResponse(BaseModel):
    suggestion: str
    tokens: int

class ChatRequest(BaseModel):
    project_id: str
    message: str
    context: str
    model: Optional[Literal["flash", "pro"]] = "flash"

class ChatResponse(BaseModel):
    response: str
    tokens: int

class AgentEditRequest(BaseModel):
    project_id: str
    instruction: str
    document: str
    model: Optional[Literal["flash", "pro"]] = "pro"

class DiffChange(BaseModel):
    start_line: int
    end_line: int
    original: str
    replacement: str
    reason: str

class AgentEditResponse(BaseModel):
    explanation: str
    changes: List[DiffChange]
    tokens: int

class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str
    tokens: int = 0

class ChatHistory(BaseModel):
    id: str
    uid: str
    project_id: str
    datetime: datetime
    messages: List[ChatMessage]

class AdminStats(BaseModel):
    total_users: int
    total_projects: int
    total_tokens: int
    active_today: int

class FeedbackRequest(BaseModel):
    feedback: str
