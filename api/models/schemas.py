from pydantic import BaseModel, EmailStr, Field, ConfigDict
from typing import Optional, List, Literal, Dict
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
    invite_code: Optional[str] = None

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
    # updated_at the client last saw; omitted means "overwrite unconditionally"
    base_updated_at: Optional[str] = None

class ProjectResponse(BaseModel):
    id: str
    name: str
    files: List[ProjectFile]
    main_file: str
    theme: str
    custom_theme: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

class ProjectSummary(BaseModel):
    """Listing DTO: no file bodies. The list view never rendered them."""
    id: str
    name: str
    main_file: str = "main.tex"
    theme: str = ""
    custom_theme: Optional[str] = None
    folder: str = ""          # "" is root; nesting lives in the string, e.g. "thesis/ch2"
    sort_order: int = 0       # spaced in tens so a move rewrites one document
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

class ProjectPlacement(BaseModel):
    folder: Optional[str] = Field(default=None, max_length=200)
    sort_order: Optional[int] = None

class CompileRequest(BaseModel):
    project_id: str
    main_file: str
    files: List[ProjectFile]

class CompileResponse(BaseModel):
    success: bool
    pdf_url: Optional[str] = None
    error: Optional[str] = None
    synctex: bool = False  # whether click-to-source is available for this build

class SyncTexRequest(BaseModel):
    page: int = Field(..., ge=1)
    x: float  # PDF points from the page's left edge
    y: float  # PDF points from the page's top edge

class SyncTexResponse(BaseModel):
    file: str
    line: int

class SyncTexForwardRequest(BaseModel):
    file: str
    line: int = Field(..., ge=1)

class SyncTexForwardResponse(BaseModel):
    page: int
    x: float
    y: float

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

class SelectionContext(BaseModel):
    text: str
    start_line: int
    end_line: int

class AgentEditRequest(BaseModel):
    project_id: str
    instruction: str
    document: str
    file_name: Optional[str] = None  # active file being edited (e.g. "custom.cls", "main.tex")
    model: Optional[Literal["flash", "pro"]] = "pro"
    selection: Optional[SelectionContext] = None
    project_files: Optional[List[Dict]] = None  # [{name, content, type}, ...] for supporting files
    cursor_line: Optional[int] = None  # 1-based line number of the cursor in the editor

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
    totalUsers: int
    totalProjects: int
    totalTokens: int
    activeToday: int

class FeedbackRequest(BaseModel):
    feedback: str


# Provider / settings schemas

class UpdateProviderKeyRequest(BaseModel):
    provider: Literal["gemini", "openai", "anthropic", "mistral"]
    api_key: str

class UpdatePreferredProviderRequest(BaseModel):
    provider: Literal["gemini", "openai", "anthropic", "mistral"]

class UserSettingsResponse(BaseModel):
    preferred_provider: str = "gemini"
    providers_configured: Dict[str, bool] = {}


# Token cap schema

class SetTokenCapRequest(BaseModel):
    cap: int = Field(..., ge=0)


# Access request schemas

class AccessRequestCreate(BaseModel):
    name: str = Field(..., min_length=2, max_length=100)
    email: EmailStr
    institution: str = Field(..., max_length=200)
    use_case: str = Field(..., max_length=1000)

class AccessRequestResponse(BaseModel):
    id: str
    name: str
    email: str
    institution: str
    use_case: str
    status: Literal["pending", "approved", "rejected"]
    created_at: Optional[datetime] = None
    reviewed_by: Optional[str] = None
    reviewed_at: Optional[datetime] = None
    rejection_reason: Optional[str] = None

class RejectAccessRequestBody(BaseModel):
    reason: Optional[str] = None
