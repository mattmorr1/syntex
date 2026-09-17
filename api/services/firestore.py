import os
import asyncio
import functools
import threading
from datetime import datetime, timedelta, timezone
from typing import Optional, Dict, Any, List
import firebase_admin
from firebase_admin import credentials, firestore, auth
from google.cloud.firestore_v1.base_query import FieldFilter
from config import Config


PRESENCE_TTL_SECONDS = 90.0
DELTA_TTL_SECONDS = 120.0
SYNC_OVERLAP_SECONDS = 2.0


def offload(fn):
    """Run a blocking Firestore method body in a worker thread, off the event loop."""
    @functools.wraps(fn)
    async def wrapper(*args, **kwargs):
        return await asyncio.to_thread(fn, *args, **kwargs)
    return wrapper


def same_instant(a: Optional[str], b: Optional[str]) -> bool:
    """
    Compare two ISO timestamps by instant, not by spelling. The API serialises datetimes
    as '...Z' while serialize_timestamps emits '...+00:00', so string equality here
    reported a conflict on every save after the first.
    """
    if not a or not b:
        return False
    try:
        return (datetime.fromisoformat(a.replace("Z", "+00:00"))
                == datetime.fromisoformat(b.replace("Z", "+00:00")))
    except ValueError:
        return a == b


def can_access(project: Dict, uid: str) -> bool:
    """
    Who may open and edit a project: its owner, or anyone the owner shared it with.

    Single-sourced deliberately. The read gate and both mutating transactions each used to
    compare user_id themselves, so a membership check added to one of them would have left
    the others closed (feature half-works) or open (hole).
    """
    return project.get("user_id") == uid or uid in (project.get("member_uids") or [])


def is_owner(project: Dict, uid: str) -> bool:
    """Kept separate from can_access so "can edit" can never be mistaken for "can destroy"."""
    return project.get("user_id") == uid


def serialize_timestamps(data: Dict) -> Dict:
    """Convert Firestore Timestamps to ISO strings for JSON serialization"""
    result = {}
    for key, value in data.items():
        if hasattr(value, 'isoformat'):
            result[key] = value.isoformat()
        elif hasattr(value, '_seconds'):  # Firestore Timestamp
            result[key] = datetime.fromtimestamp(value._seconds).isoformat()
        else:
            result[key] = value
    return result

class FirestoreService:
    _instance = None
    _initialized = False
    _init_lock = threading.Lock()
    
    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance
    
    def __init__(self):
        if getattr(self, "_constructed", False):
            return  # singleton: never re-blank an initialized client
        self._constructed = True
        self.db = None
        self.enabled = False
        self._dev_data = {"users": {}, "projects": {}, "chats": {}, "invites": {}, "access_requests": {}}

    def _ensure_initialized(self):
        """Lazy initialization - only runs on first actual use. Called from worker threads."""
        if FirestoreService._initialized:
            return

        with FirestoreService._init_lock:
            if FirestoreService._initialized:
                return
            self._initialize_locked()

    def _initialize_locked(self):
        try:
            key_path = Config.FIREBASE_KEY_PATH
            print(f"Checking Firebase key at: {key_path}")
            if os.path.exists(key_path):
                if not firebase_admin._apps:
                    cred = credentials.Certificate(key_path)
                    firebase_admin.initialize_app(cred, {
                        "storageBucket": Config.FIREBASE_STORAGE_BUCKET,
                    })
                self.db = firestore.client()
                self.enabled = True
                print("Firebase initialized successfully")
            else:
                print(f"Warning: Firebase key not found at {key_path}")
                print("Running in development mode")
        except Exception as e:
            print(f"Firebase init failed: {e}")
        
        FirestoreService._initialized = True
    
    # User operations
    @offload
    def create_user(self, uid: str, email: str, username: str, role: str = "user") -> Dict:
        self._ensure_initialized()
        user_data = {
            "uid": uid,
            "email": email,
            "username": username,
            "role": role,
            "created_at": datetime.now(timezone.utc),
            "last_accessed": datetime.now(timezone.utc),
            "tokens_used": {"total": 0, "flash": 0, "pro": 0},
            "token_cap": Config.DEFAULT_TOKEN_CAP,
            "tokens_used_this_month": {"total": 0, "flash": 0, "pro": 0},
            "token_month_year": datetime.now(timezone.utc).strftime("%Y-%m"),
        }
        
        if self.enabled:
            self.db.collection("users").document(uid).set(user_data)
        else:
            self._dev_data["users"][uid] = user_data
            
        return user_data
    
    @offload
    def get_user(self, uid: str) -> Optional[Dict]:
        self._ensure_initialized()
        if self.enabled:
            doc = self.db.collection("users").document(uid).get()
            if doc.exists:
                data = doc.to_dict()
                data["uid"] = uid
                return data
            return None
        return self._dev_data["users"].get(uid)
    
    @offload
    def get_user_by_email(self, email: str) -> Optional[Dict]:
        self._ensure_initialized()
        if self.enabled:
            users = self.db.collection("users").where(filter=FieldFilter("email", "==", email)).limit(1).stream()
            for user in users:
                data = user.to_dict()
                data["uid"] = user.id
                return data
            return None
        for uid, user in self._dev_data["users"].items():
            if user["email"] == email:
                return user
        return None
    
    @offload
    def update_user_tokens(self, uid: str, flash_tokens: int = 0, pro_tokens: int = 0):
        self._ensure_initialized()
        if self.enabled:
            user_ref = self.db.collection("users").document(uid)
            user_ref.update({
                "tokens_used.flash": firestore.Increment(flash_tokens),
                "tokens_used.pro": firestore.Increment(pro_tokens),
                "tokens_used.total": firestore.Increment(flash_tokens + pro_tokens),
                "last_accessed": datetime.now(timezone.utc)
            })
        else:
            if uid in self._dev_data["users"]:
                user = self._dev_data["users"][uid]
                user["tokens_used"]["flash"] += flash_tokens
                user["tokens_used"]["pro"] += pro_tokens
                user["tokens_used"]["total"] += flash_tokens + pro_tokens
    
    @offload
    def update_last_accessed(self, uid: str):
        self._ensure_initialized()
        if self.enabled:
            self.db.collection("users").document(uid).update({
                "last_accessed": datetime.now(timezone.utc)
            })
        elif uid in self._dev_data["users"]:
            self._dev_data["users"][uid]["last_accessed"] = datetime.now(timezone.utc)
    
    @offload
    def update_user_settings(self, uid: str, settings: Dict) -> bool:
        """Update user settings like custom API key."""
        if self.enabled:
            self.db.collection("users").document(uid).update({
                "settings": settings,
                "last_accessed": datetime.now(timezone.utc)
            })
            return True
        elif uid in self._dev_data["users"]:
            self._dev_data["users"][uid]["settings"] = settings
            return True
        return False

    async def get_user_settings(self, uid: str) -> Dict:
        """Get user settings."""
        user = await self.get_user(uid)
        if user:
            return user.get("settings", {})
        return {}

    @offload
    def get_all_users(self) -> List[Dict]:
        self._ensure_initialized()
        if self.enabled:
            users = []
            for doc in self.db.collection("users").stream():
                data = doc.to_dict()
                data["uid"] = doc.id
                users.append(data)
            return users
        return list(self._dev_data["users"].values())
    
    @offload
    def delete_user(self, uid: str):
        self._ensure_initialized()
        if self.enabled:
            self.db.collection("users").document(uid).delete()
            try:
                auth.delete_user(uid)
            except:
                pass
        else:
            self._dev_data["users"].pop(uid, None)
    
    @offload
    def reset_user_tokens(self, uid: str):
        self._ensure_initialized()
        if self.enabled:
            self.db.collection("users").document(uid).update({
                "tokens_used": {"total": 0, "flash": 0, "pro": 0}
            })
        elif uid in self._dev_data["users"]:
            self._dev_data["users"][uid]["tokens_used"] = {"total": 0, "flash": 0, "pro": 0}

    # Monthly token cap methods

    @offload
    def check_and_reset_monthly_tokens(self, uid: str, user_data: Dict) -> Dict:
        """Lazily reset monthly token counter if the month has rolled over."""
        self._ensure_initialized()
        current_month = datetime.now(timezone.utc).strftime("%Y-%m")
        stored_month = user_data.get("token_month_year", current_month)
        if stored_month != current_month:
            reset = {
                "tokens_used_this_month": {"total": 0, "flash": 0, "pro": 0},
                "token_month_year": current_month,
            }
            if self.enabled:
                self.db.collection("users").document(uid).update(reset)
            elif uid in self._dev_data["users"]:
                self._dev_data["users"][uid].update(reset)
            user_data = {**user_data, **reset}
        return user_data

    @offload
    def update_monthly_tokens(self, uid: str, flash_tokens: int = 0, pro_tokens: int = 0):
        self._ensure_initialized()
        total = flash_tokens + pro_tokens
        if self.enabled:
            self.db.collection("users").document(uid).update({
                "tokens_used_this_month.flash": firestore.Increment(flash_tokens),
                "tokens_used_this_month.pro": firestore.Increment(pro_tokens),
                "tokens_used_this_month.total": firestore.Increment(total),
            })
        elif uid in self._dev_data["users"]:
            u = self._dev_data["users"][uid]
            m = u.setdefault("tokens_used_this_month", {"total": 0, "flash": 0, "pro": 0})
            m["flash"] += flash_tokens
            m["pro"] += pro_tokens
            m["total"] += total

    @offload
    def set_user_token_cap(self, uid: str, cap: int):
        self._ensure_initialized()
        if self.enabled:
            self.db.collection("users").document(uid).update({"token_cap": cap})
        elif uid in self._dev_data["users"]:
            self._dev_data["users"][uid]["token_cap"] = cap

    # Provider settings

    async def update_provider_key(self, uid: str, provider: str, encrypted_key: Optional[str]):
        """Store or remove an encrypted API key for a provider in user settings."""
        self._ensure_initialized()
        user = await self.get_user(uid)
        if not user:
            return False
        settings = user.get("settings") or {}
        providers = settings.get("providers") or {}
        if encrypted_key is None:
            providers.pop(provider, None)
        else:
            providers[provider] = encrypted_key
        settings["providers"] = providers
        return await self.update_user_settings(uid, settings)

    async def update_preferred_provider(self, uid: str, provider: str):
        self._ensure_initialized()
        user = await self.get_user(uid)
        if not user:
            return False
        settings = user.get("settings") or {}
        settings["preferred_provider"] = provider
        return await self.update_user_settings(uid, settings)

    # Access requests

    @offload
    def create_access_request(self, name: str, email: str, institution: str, use_case: str) -> Dict:
        self._ensure_initialized()
        import uuid
        req_id = str(uuid.uuid4())
        data = {
            "id": req_id,
            "name": name,
            "email": email,
            "institution": institution,
            "use_case": use_case,
            "status": "pending",
            "created_at": datetime.now(timezone.utc),
            "reviewed_by": None,
            "reviewed_at": None,
            "rejection_reason": None,
        }
        if self.enabled:
            self.db.collection("access_requests").document(req_id).set(data)
        else:
            self._dev_data["access_requests"][req_id] = data
        return data

    @offload
    def get_access_requests(self, status: Optional[str] = None) -> List[Dict]:
        self._ensure_initialized()
        if self.enabled:
            query = self.db.collection("access_requests")
            if status:
                query = query.where(filter=FieldFilter("status", "==", status))
            results = []
            for doc in query.order_by("created_at", direction=firestore.Query.DESCENDING).stream():
                d = doc.to_dict()
                d["id"] = doc.id
                results.append(d)
            return results
        reqs = list(self._dev_data["access_requests"].values())
        if status:
            reqs = [r for r in reqs if r["status"] == status]
        return sorted(reqs, key=lambda r: r.get("created_at", ""), reverse=True)

    @offload
    def get_access_request(self, req_id: str) -> Optional[Dict]:
        self._ensure_initialized()
        if self.enabled:
            doc = self.db.collection("access_requests").document(req_id).get()
            if doc.exists:
                d = doc.to_dict()
                d["id"] = doc.id
                return d
            return None
        return self._dev_data["access_requests"].get(req_id)

    @offload
    def get_access_request_by_email(self, email: str) -> Optional[Dict]:
        self._ensure_initialized()
        if self.enabled:
            for doc in self.db.collection("access_requests").where(filter=FieldFilter("email", "==", email)).limit(1).stream():
                d = doc.to_dict()
                d["id"] = doc.id
                return d
            return None
        for r in self._dev_data["access_requests"].values():
            if r["email"].lower() == email.lower():
                return r
        return None

    @offload
    def update_access_request(self, req_id: str, status: str, reviewed_by: str,
                                     rejection_reason: Optional[str] = None):
        self._ensure_initialized()
        update = {
            "status": status,
            "reviewed_by": reviewed_by,
            "reviewed_at": datetime.now(timezone.utc),
            "rejection_reason": rejection_reason,
        }
        if self.enabled:
            self.db.collection("access_requests").document(req_id).update(update)
        elif req_id in self._dev_data["access_requests"]:
            self._dev_data["access_requests"][req_id].update(update)

    # Project operations
    @offload
    def create_project(self, uid: str, name: str, theme: str, files: List[Dict], 
                            main_file: str, custom_theme: str = None) -> Dict:
        self._ensure_initialized()
        import uuid
        project_id = str(uuid.uuid4())
        project_data = {
            "user_id": uid,
            "name": name,
            "theme": theme,
            "custom_theme": custom_theme,
            "files": files,
            "main_file": main_file,
            "folder": "",
            "sort_order": 0,
            "created_at": datetime.now(timezone.utc),
            "updated_at": datetime.now(timezone.utc)
        }

        if self.enabled:
            self.db.collection("projects").document(project_id).set(project_data)
        else:
            self._dev_data["projects"][project_id] = project_data
            
        return {"id": project_id, **serialize_timestamps(project_data)}
    
    @offload
    def get_project(self, project_id: str, uid: str) -> Optional[Dict]:
        self._ensure_initialized()
        if self.enabled:
            doc = self.db.collection("projects").document(project_id).get()
            if doc.exists:
                data = serialize_timestamps(doc.to_dict())
                if can_access(data, uid):
                    return {"id": project_id, **data}
            return None
        project = self._dev_data["projects"].get(project_id)
        if project and can_access(project, uid):
            return {"id": project_id, **serialize_timestamps(project)}
        return None
    
    @offload
    def get_user_projects(self, uid: str) -> List[Dict]:
        self._ensure_initialized()
        if self.enabled:
            # Field mask: the listing never renders file bodies, and they dominate doc size.
            # user_id is in the mask because the client needs it to tell owned from shared.
            mask = ["user_id", "name", "main_file", "theme", "custom_theme",
                    "folder", "sort_order", "created_at", "updated_at"]
            col = self.db.collection("projects")
            # Two queries rather than one: Firestore cannot answer "owner OR member" in a
            # single index scan. The owner is never in member_uids, so overlap is not
            # expected, but the dict keyed by id makes a duplicate impossible anyway.
            found: Dict[str, Dict] = {}
            for query in (col.where(filter=FieldFilter("user_id", "==", uid)).select(mask),
                          col.where(filter=FieldFilter("member_uids", "array_contains", uid)).select(mask)):
                for doc in query.stream():
                    found[doc.id] = {"id": doc.id, **serialize_timestamps(doc.to_dict())}
            return list(found.values())
        return [{"id": pid, **serialize_timestamps(p)} for pid, p in self._dev_data["projects"].items()
                if can_access(p, uid)]
    
    @offload
    def update_project(self, project_id: str, uid: str, files: List[Dict],
                       base_updated_at: Optional[str] = None) -> Dict:
        """
        Write files atomically. When base_updated_at is given, the write is rejected if the
        document moved since the client last read it, so a second editor cannot be clobbered.
        Returns {"ok": True, "updated_at": iso} or {"ok": False, "reason": "conflict"|"not_found"}.
        """
        self._ensure_initialized()
        now = datetime.now(timezone.utc)

        if not self.enabled:
            p = self._dev_data["projects"].get(project_id)
            if not p or not can_access(p, uid):
                return {"ok": False, "reason": "not_found"}
            if base_updated_at:
                stored = serialize_timestamps(p).get("updated_at")
                if stored and not same_instant(stored, base_updated_at):
                    return {"ok": False, "reason": "conflict", "updated_at": stored}
            p["files"], p["updated_at"] = files, now
            return {"ok": True, "updated_at": now.isoformat()}

        ref = self.db.collection("projects").document(project_id)

        @firestore.transactional
        def _apply(transaction) -> Dict:
            snap = ref.get(transaction=transaction)
            if not snap.exists or not can_access(snap.to_dict(), uid):
                return {"ok": False, "reason": "not_found"}
            if base_updated_at:
                stored = serialize_timestamps(snap.to_dict()).get("updated_at")
                if stored and not same_instant(stored, base_updated_at):
                    return {"ok": False, "reason": "conflict", "updated_at": stored}
            transaction.update(ref, {"files": files, "updated_at": now})
            return {"ok": True, "updated_at": now.isoformat()}

        return _apply(self.db.transaction())
    
    async def update_project_name(self, project_id: str, uid: str, name: str) -> bool:
        self._ensure_initialized()
        project = await self.get_project(project_id, uid)
        # get_project admits members; renaming is the owner's alone.
        if not project or not is_owner(project, uid):
            return False
            
        if self.enabled:
            await asyncio.to_thread(
                self.db.collection("projects").document(project_id).update,
                {"name": name, "updated_at": datetime.now(timezone.utc)},
            )
        else:
            self._dev_data["projects"][project_id]["name"] = name
            self._dev_data["projects"][project_id]["updated_at"] = datetime.now(timezone.utc)
        return True
    
    @offload
    def set_project_placement(self, project_id: str, uid: str,
                              folder: Optional[str] = None,
                              sort_order: Optional[int] = None) -> bool:
        """Move a project between folders and/or set its position. Ownership checked in-transaction."""
        self._ensure_initialized()
        update: Dict = {}
        if folder is not None:
            update["folder"] = folder
        if sort_order is not None:
            update["sort_order"] = sort_order
        if not update:
            return False

        if not self.enabled:
            p = self._dev_data["projects"].get(project_id)
            if not p or not is_owner(p, uid):
                return False
            p.update(update)
            return True

        ref = self.db.collection("projects").document(project_id)

        @firestore.transactional
        def _apply(transaction) -> bool:
            snap = ref.get(transaction=transaction)
            if not snap.exists or not is_owner(snap.to_dict(), uid):
                return False
            transaction.update(ref, update)
            return True

        return _apply(self.db.transaction())

    async def delete_project(self, project_id: str, uid: str) -> bool:
        self._ensure_initialized()
        project = await self.get_project(project_id, uid)
        # A member losing access must not be able to destroy the document on the way out.
        if not project or not is_owner(project, uid):
            return False
            
        if self.enabled:
            await asyncio.to_thread(self.db.collection("projects").document(project_id).delete)
        else:
            self._dev_data["projects"].pop(project_id, None)
        return True
    
    async def duplicate_project(self, project_id: str, uid: str) -> Optional[Dict]:
        self._ensure_initialized()
        project = await self.get_project(project_id, uid)
        if not project:
            return None
            
        return await self.create_project(
            uid=uid,
            name=f"{project['name']} (Copy)",
            theme=project["theme"],
            files=project["files"],
            main_file=project["main_file"],
            custom_theme=project.get("custom_theme")
        )
    
    # Membership
    #
    # These are the only writers of member_uids. No generic project path touches it:
    # update_project writes files, update_project_name writes name, set_project_placement
    # writes folder and sort_order — so a member cannot widen their own access.

    @offload
    def add_project_member(self, project_id: str, owner_uid: str, member_uid: str) -> str:
        """Returns "ok", "not_owner", "not_found", or "is_owner" (a no-op, not an error)."""
        self._ensure_initialized()

        if not self.enabled:
            p = self._dev_data["projects"].get(project_id)
            if not p:
                return "not_found"
            if not is_owner(p, owner_uid):
                return "not_owner"
            if member_uid == p.get("user_id"):
                return "is_owner"
            members = p.setdefault("member_uids", [])
            if member_uid not in members:
                members.append(member_uid)
            return "ok"

        ref = self.db.collection("projects").document(project_id)

        @firestore.transactional
        def _apply(transaction) -> str:
            snap = ref.get(transaction=transaction)
            if not snap.exists:
                return "not_found"
            data = snap.to_dict()
            if not is_owner(data, owner_uid):
                return "not_owner"
            if member_uid == data.get("user_id"):
                return "is_owner"
            # ArrayUnion rather than read-modify-write: two concurrent shares must not
            # clobber one another.
            transaction.update(ref, {"member_uids": firestore.ArrayUnion([member_uid])})
            return "ok"

        return _apply(self.db.transaction())

    @offload
    def remove_project_member(self, project_id: str, actor_uid: str, member_uid: str) -> str:
        """The owner may remove anyone; a member may remove only themselves."""
        self._ensure_initialized()

        def permitted(data: Dict) -> bool:
            return is_owner(data, actor_uid) or actor_uid == member_uid

        if not self.enabled:
            p = self._dev_data["projects"].get(project_id)
            if not p:
                return "not_found"
            if not permitted(p):
                return "forbidden"
            p["member_uids"] = [m for m in (p.get("member_uids") or []) if m != member_uid]
            return "ok"

        ref = self.db.collection("projects").document(project_id)

        @firestore.transactional
        def _apply(transaction) -> str:
            snap = ref.get(transaction=transaction)
            if not snap.exists:
                return "not_found"
            if not permitted(snap.to_dict()):
                return "forbidden"
            transaction.update(ref, {"member_uids": firestore.ArrayRemove([member_uid])})
            return "ok"

        return _apply(self.db.transaction())

    # Chat operations
    @offload
    def save_chat(self, uid: str, project_id: str, messages: List[Dict]) -> str:
        self._ensure_initialized()
        import uuid
        chat_id = str(uuid.uuid4())
        chat_data = {
            "uid": uid,
            "project_id": project_id,
            "datetime": datetime.now(timezone.utc),
            "messages": messages
        }
        
        if self.enabled:
            self.db.collection("chats").document(chat_id).set(chat_data)
        else:
            self._dev_data["chats"][chat_id] = chat_data
            
        return chat_id
    
    @offload
    def get_chat_history(self, uid: str, project_id: str) -> List[Dict]:
        self._ensure_initialized()
        if self.enabled:
            chats = []
            query = self.db.collection("chats").where(filter=FieldFilter("uid", "==", uid))
            if project_id:
                query = query.where(filter=FieldFilter("project_id", "==", project_id))
            for doc in query.order_by("datetime", direction=firestore.Query.DESCENDING).limit(50).stream():
                data = doc.to_dict()
                data["id"] = doc.id
                chats.append(data)
            return chats
        return [{"id": cid, **c} for cid, c in self._dev_data["chats"].items() 
                if c.get("uid") == uid and (not project_id or c.get("project_id") == project_id)]
    
    # Stats
    @offload
    def get_stats(self) -> Dict:
        self._ensure_initialized()
        if self.enabled:
            users = list(self.db.collection("users")
                         .select(["tokens_used", "last_accessed"]).stream())
            # Server-side aggregation: the previous full scan pulled every project's
            # file bodies across the wire only to call len() on the result.
            total_projects = self.db.collection("projects").count().get()[0][0].value

            total_tokens = 0
            active_today = 0
            today = datetime.now(timezone.utc).date()
            
            for doc in users:
                data = doc.to_dict()
                total_tokens += data.get("tokens_used", {}).get("total", 0)
                last_accessed = data.get("last_accessed")
                if last_accessed and hasattr(last_accessed, 'date') and last_accessed.date() == today:
                    active_today += 1
            
            return {
                "totalUsers": len(users),
                "totalProjects": int(total_projects),
                "totalTokens": total_tokens,
                "activeToday": active_today
            }
        
        total_tokens = sum(u.get("tokens_used", {}).get("total", 0) 
                         for u in self._dev_data["users"].values())
        return {
            "totalUsers": len(self._dev_data["users"]),
            "totalProjects": len(self._dev_data["projects"]),
            "totalTokens": total_tokens,
            "activeToday": len(self._dev_data["users"])
        }
    
    # Feedback
    @offload
    def save_feedback(self, feedback: str, uid: str = None):
        self._ensure_initialized()
        import uuid
        feedback_id = str(uuid.uuid4())
        feedback_data = {
            "feedback": feedback,
            "uid": uid,
            "timestamp": datetime.now(timezone.utc)
        }
        
        if self.enabled:
            self.db.collection("feedback").document(feedback_id).set(feedback_data)
        
        return feedback_id
    
    # Invite codes
    @offload
    def create_invite(self, created_by: str, uses: int = 1) -> Dict:
        self._ensure_initialized()
        import uuid
        import secrets
        code = secrets.token_urlsafe(8)[:12].upper()
        invite_data = {
            "code": code,
            "created_by": created_by,
            "created_at": datetime.now(timezone.utc),
            "max_uses": uses,
            "used_count": 0,
            "used_by": [],
            "active": True
        }
        
        if self.enabled:
            self.db.collection("invites").document(code).set(invite_data)
        else:
            self._dev_data["invites"][code] = invite_data
        
        return invite_data
    
    @offload
    def validate_invite(self, code: str) -> Optional[Dict]:
        self._ensure_initialized()
        code = code.strip().upper()
        if self.enabled:
            doc = self.db.collection("invites").document(code).get()
            if doc.exists:
                data = doc.to_dict()
                if data.get("active") and data.get("used_count", 0) < data.get("max_uses", 1):
                    return data
            return None
        
        invite = self._dev_data["invites"].get(code)
        if invite and invite.get("active") and invite.get("used_count", 0) < invite.get("max_uses", 1):
            return invite
        return None
    
    @offload
    def use_invite(self, code: str, used_by_uid: str) -> bool:
        self._ensure_initialized()
        code = code.strip().upper()
        if self.enabled:
            doc_ref = self.db.collection("invites").document(code)
            doc = doc_ref.get()
            if doc.exists:
                data = doc.to_dict()
                if data.get("active") and data.get("used_count", 0) < data.get("max_uses", 1):
                    doc_ref.update({
                        "used_count": firestore.Increment(1),
                        "used_by": firestore.ArrayUnion([used_by_uid])
                    })
                    return True
            return False
        
        invite = self._dev_data["invites"].get(code)
        if invite and invite.get("active") and invite.get("used_count", 0) < invite.get("max_uses", 1):
            invite["used_count"] += 1
            invite["used_by"].append(used_by_uid)
            return True
        return False
    
    @offload
    def get_all_invites(self) -> List[Dict]:
        self._ensure_initialized()
        if self.enabled:
            invites = []
            for doc in self.db.collection("invites").order_by("created_at", direction=firestore.Query.DESCENDING).stream():
                data = doc.to_dict()
                data["code"] = doc.id
                invites.append(data)
            return invites
        return list(self._dev_data["invites"].values())
    
    @offload
    def deactivate_invite(self, code: str) -> bool:
        self._ensure_initialized()
        code = code.strip().upper()
        if self.enabled:
            doc_ref = self.db.collection("invites").document(code)
            if doc_ref.get().exists:
                doc_ref.update({"active": False})
                return True
            return False
        
        if code in self._dev_data["invites"]:
            self._dev_data["invites"][code]["active"] = False
            return True
        return False

    # Collaboration relay
    #
    # One document per project holds a snapshot plus a short tail of deltas. Yjs updates
    # are commutative and idempotent, so at-least-once delivery is enough and the poll
    # window overlaps rather than demanding exact ordering.
    #
    # The room resets whenever no peer has been seen for PRESENCE_TTL: durable content
    # lives in the project files via the normal save path, so an empty room has nothing
    # worth keeping and the next joiner reseeds from those files. That also stops a stale
    # snapshot outliving solo edits made elsewhere.
    # ponytail: one doc per room, so sustained writes past ~1/s contend. Shard deltas into
    # a subcollection if that shows up in practice.

    @offload
    def sync_collab_room(self, project_id: str, client_id: int, since: float,
                         update: Optional[str], presence: Optional[Dict],
                         leave: bool = False) -> Dict[str, Any]:
        self._ensure_initialized()
        now = datetime.now(timezone.utc).timestamp()
        if not self.enabled:
            rooms = self._dev_data.setdefault("collab", {})
            room = rooms.get(project_id) or {}
            result, room = self._advance_collab_room(room, now, client_id, since, update,
                                                     presence, leave)
            rooms[project_id] = room
            return result

        ref = self.db.collection("collab_rooms").document(project_id)

        @firestore.transactional
        def commit(transaction):
            doc = ref.get(transaction=transaction)
            room = doc.to_dict() if doc.exists else {}
            result, room = self._advance_collab_room(room, now, client_id, since, update,
                                                     presence, leave)
            transaction.set(ref, room)
            return result

        return commit(self.db.transaction())

    def _advance_collab_room(self, room: Dict, now: float, client_id: int, since: float,
                             update: Optional[str], presence: Optional[Dict],
                             leave: bool = False) -> tuple:
        """Pure room transition. Returns (response, next_room) so it is testable alone."""
        # Reset on a room nobody has touched lately, which must count this client's own
        # earlier heartbeat: judging by other peers alone would reset on every tick of a
        # solo session, wiping the state the next joiner needs.
        live = {k: v for k, v in (room.get("presence") or {}).items()
                if now - v.get("ts", 0) < PRESENCE_TTL_SECONDS}
        reset = not live
        peers = {k: v for k, v in live.items() if k != str(client_id)}
        deltas = [] if reset else [d for d in (room.get("deltas") or [])
                                   if now - d.get("ts", 0) < DELTA_TTL_SECONDS]
        snapshot = None if reset else room.get("snapshot")
        snapshot_ts = 0.0 if reset else room.get("snapshot_ts", 0.0)

        if update:
            deltas.append({"ts": now, "data": update})

        # A leaving client drops out now rather than ghosting until its TTL expires.
        if not leave:
            peers[str(client_id)] = {"ts": now, **(presence or {})}
        next_room = {"presence": peers, "deltas": deltas,
                     "snapshot": snapshot, "snapshot_ts": snapshot_ts}

        fresh = reset or since <= 0
        cutoff = since - SYNC_OVERLAP_SECONDS
        return {
            "now": now,
            "seed": reset,
            "snapshot": snapshot if fresh else None,
            "updates": [d["data"] for d in deltas
                        if d["ts"] > (snapshot_ts if fresh else cutoff)
                        and not (d["ts"] == now and update and d["data"] == update)],
            "peers": [{"clientId": int(k), **{f: v for f, v in p.items() if f != "ts"}}
                      for k, p in peers.items() if k != str(client_id)],
            "pending": len(deltas),
        }, next_room

    @offload
    def save_collab_snapshot(self, project_id: str, snapshot: str, up_to: float) -> bool:
        """Fold deltas up to `up_to` into a snapshot. Callers hold the merged doc; we only store it."""
        self._ensure_initialized()
        if not self.enabled:
            room = self._dev_data.setdefault("collab", {}).get(project_id)
            if room is None:
                return False
            room["snapshot"] = snapshot
            room["snapshot_ts"] = up_to
            room["deltas"] = [d for d in room.get("deltas", []) if d.get("ts", 0) > up_to]
            return True

        ref = self.db.collection("collab_rooms").document(project_id)

        @firestore.transactional
        def commit(transaction):
            doc = ref.get(transaction=transaction)
            if not doc.exists:
                return False
            room = doc.to_dict()
            if room.get("snapshot_ts", 0.0) >= up_to:
                return True
            room["snapshot"] = snapshot
            room["snapshot_ts"] = up_to
            room["deltas"] = [d for d in room.get("deltas", []) if d.get("ts", 0) > up_to]
            transaction.set(ref, room)
            return True

        return commit(self.db.transaction())

db_service = FirestoreService()
