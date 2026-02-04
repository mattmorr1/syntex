import os
from datetime import datetime, timedelta
from typing import Optional, Dict, Any, List
import firebase_admin
from firebase_admin import credentials, firestore, auth
from config import Config

class FirestoreService:
    _instance = None
    
    def __new__(cls):
        if cls._instance is None:
            instance = super().__new__(cls)
            instance.db = None
            instance.enabled = False
            instance._dev_data = {"users": {}, "projects": {}, "chats": {}, "invites": {}}
            instance._initialize()
            cls._instance = instance
        return cls._instance
    
    def _initialize(self):
        try:
            key_path = Config.FIREBASE_KEY_PATH
            print(f"Looking for Firebase key at: {key_path}", flush=True)
            if os.path.exists(key_path):
                if not firebase_admin._apps:
                    cred = credentials.Certificate(key_path)
                    firebase_admin.initialize_app(cred)
                self.db = firestore.client()
                self.enabled = True
                print("Firebase initialized successfully", flush=True)
            else:
                print(f"Warning: Firebase key not found at {key_path}", flush=True)
                print("Running in development mode", flush=True)
        except Exception as e:
            print(f"Firebase init failed: {e}", flush=True)
    
    def __init__(self):
        pass  # All init done in __new__
    
    # User operations
    async def create_user(self, uid: str, email: str, username: str, role: str = "user") -> Dict:
        user_data = {
            "uid": uid,
            "email": email,
            "username": username,
            "role": role,
            "created_at": datetime.utcnow(),
            "last_accessed": datetime.utcnow(),
            "tokens_used": {"total": 0, "flash": 0, "pro": 0}
        }
        
        if self.enabled:
            self.db.collection("users").document(uid).set(user_data)
        else:
            self._dev_data["users"][uid] = user_data
            
        return user_data
    
    async def get_user(self, uid: str) -> Optional[Dict]:
        if self.enabled:
            doc = self.db.collection("users").document(uid).get()
            if doc.exists:
                data = doc.to_dict()
                data["uid"] = uid
                return data
            return None
        return self._dev_data["users"].get(uid)
    
    async def get_user_by_email(self, email: str) -> Optional[Dict]:
        if self.enabled:
            users = self.db.collection("users").where("email", "==", email).limit(1).stream()
            for user in users:
                data = user.to_dict()
                data["uid"] = user.id
                return data
            return None
        for uid, user in self._dev_data["users"].items():
            if user["email"] == email:
                return user
        return None
    
    async def update_user_tokens(self, uid: str, flash_tokens: int = 0, pro_tokens: int = 0):
        if self.enabled:
            user_ref = self.db.collection("users").document(uid)
            user_ref.update({
                "tokens_used.flash": firestore.Increment(flash_tokens),
                "tokens_used.pro": firestore.Increment(pro_tokens),
                "tokens_used.total": firestore.Increment(flash_tokens + pro_tokens),
                "last_accessed": datetime.utcnow()
            })
        else:
            if uid in self._dev_data["users"]:
                user = self._dev_data["users"][uid]
                user["tokens_used"]["flash"] += flash_tokens
                user["tokens_used"]["pro"] += pro_tokens
                user["tokens_used"]["total"] += flash_tokens + pro_tokens
    
    async def update_last_accessed(self, uid: str):
        if self.enabled:
            self.db.collection("users").document(uid).update({
                "last_accessed": datetime.utcnow()
            })
        elif uid in self._dev_data["users"]:
            self._dev_data["users"][uid]["last_accessed"] = datetime.utcnow()
    
    async def update_user_settings(self, uid: str, settings: Dict) -> bool:
        """Update user settings like custom API key."""
        if self.enabled:
            self.db.collection("users").document(uid).update({
                "settings": settings,
                "last_accessed": datetime.utcnow()
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
    
    async def get_all_users(self) -> List[Dict]:
        if self.enabled:
            users = []
            for doc in self.db.collection("users").stream():
                data = doc.to_dict()
                data["uid"] = doc.id
                users.append(data)
            return users
        return list(self._dev_data["users"].values())
    
    async def delete_user(self, uid: str):
        if self.enabled:
            self.db.collection("users").document(uid).delete()
            try:
                auth.delete_user(uid)
            except:
                pass
        else:
            self._dev_data["users"].pop(uid, None)
    
    async def reset_user_tokens(self, uid: str):
        if self.enabled:
            self.db.collection("users").document(uid).update({
                "tokens_used": {"total": 0, "flash": 0, "pro": 0}
            })
        elif uid in self._dev_data["users"]:
            self._dev_data["users"][uid]["tokens_used"] = {"total": 0, "flash": 0, "pro": 0}
    
    # Project operations
    async def create_project(self, uid: str, name: str, theme: str, files: List[Dict], 
                            main_file: str, custom_theme: str = None) -> Dict:
        import uuid
        project_id = str(uuid.uuid4())
        project_data = {
            "user_id": uid,
            "name": name,
            "theme": theme,
            "custom_theme": custom_theme,
            "files": files,
            "main_file": main_file,
            "created_at": datetime.utcnow(),
            "updated_at": datetime.utcnow()
        }
        
        if self.enabled:
            self.db.collection("projects").document(project_id).set(project_data)
        else:
            self._dev_data["projects"][project_id] = project_data
            
        return {"id": project_id, **project_data}
    
    async def get_project(self, project_id: str, uid: str) -> Optional[Dict]:
        if self.enabled:
            doc = self.db.collection("projects").document(project_id).get()
            if doc.exists:
                data = doc.to_dict()
                if data.get("user_id") == uid:
                    return {"id": project_id, **data}
            return None
        project = self._dev_data["projects"].get(project_id)
        if project and project.get("user_id") == uid:
            return {"id": project_id, **project}
        return None
    
    async def get_user_projects(self, uid: str) -> List[Dict]:
        if self.enabled:
            projects = []
            for doc in self.db.collection("projects").where("user_id", "==", uid).stream():
                data = doc.to_dict()
                projects.append({"id": doc.id, **data})
            return projects
        return [{"id": pid, **p} for pid, p in self._dev_data["projects"].items() 
                if p.get("user_id") == uid]
    
    async def update_project(self, project_id: str, uid: str, files: List[Dict]) -> bool:
        project = await self.get_project(project_id, uid)
        if not project:
            return False
            
        if self.enabled:
            self.db.collection("projects").document(project_id).update({
                "files": files,
                "updated_at": datetime.utcnow()
            })
        else:
            self._dev_data["projects"][project_id]["files"] = files
            self._dev_data["projects"][project_id]["updated_at"] = datetime.utcnow()
        return True
    
    async def update_project_name(self, project_id: str, uid: str, name: str) -> bool:
        project = await self.get_project(project_id, uid)
        if not project:
            return False
            
        if self.enabled:
            self.db.collection("projects").document(project_id).update({
                "name": name,
                "updated_at": datetime.utcnow()
            })
        else:
            self._dev_data["projects"][project_id]["name"] = name
            self._dev_data["projects"][project_id]["updated_at"] = datetime.utcnow()
        return True
    
    async def delete_project(self, project_id: str, uid: str) -> bool:
        project = await self.get_project(project_id, uid)
        if not project:
            return False
            
        if self.enabled:
            self.db.collection("projects").document(project_id).delete()
        else:
            self._dev_data["projects"].pop(project_id, None)
        return True
    
    async def duplicate_project(self, project_id: str, uid: str) -> Optional[Dict]:
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
    
    # Chat operations
    async def save_chat(self, uid: str, project_id: str, messages: List[Dict]) -> str:
        import uuid
        chat_id = str(uuid.uuid4())
        chat_data = {
            "uid": uid,
            "project_id": project_id,
            "datetime": datetime.utcnow(),
            "messages": messages
        }
        
        if self.enabled:
            self.db.collection("chats").document(chat_id).set(chat_data)
        else:
            self._dev_data["chats"][chat_id] = chat_data
            
        return chat_id
    
    async def get_chat_history(self, uid: str, project_id: str) -> List[Dict]:
        if self.enabled:
            chats = []
            query = self.db.collection("chats").where("uid", "==", uid)
            if project_id:
                query = query.where("project_id", "==", project_id)
            for doc in query.order_by("datetime", direction=firestore.Query.DESCENDING).limit(50).stream():
                data = doc.to_dict()
                data["id"] = doc.id
                chats.append(data)
            return chats
        return [{"id": cid, **c} for cid, c in self._dev_data["chats"].items() 
                if c.get("uid") == uid and (not project_id or c.get("project_id") == project_id)]
    
    # Stats
    async def get_stats(self) -> Dict:
        if self.enabled:
            users = list(self.db.collection("users").stream())
            projects = list(self.db.collection("projects").stream())
            
            total_tokens = 0
            active_today = 0
            today = datetime.utcnow().date()
            
            for doc in users:
                data = doc.to_dict()
                total_tokens += data.get("tokens_used", {}).get("total", 0)
                last_accessed = data.get("last_accessed")
                if last_accessed and hasattr(last_accessed, 'date') and last_accessed.date() == today:
                    active_today += 1
            
            return {
                "totalUsers": len(users),
                "totalProjects": len(projects),
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
    async def save_feedback(self, feedback: str, uid: str = None):
        import uuid
        feedback_id = str(uuid.uuid4())
        feedback_data = {
            "feedback": feedback,
            "uid": uid,
            "timestamp": datetime.utcnow()
        }
        
        if self.enabled:
            self.db.collection("feedback").document(feedback_id).set(feedback_data)
        
        return feedback_id
    
    # Invite codes
    async def create_invite(self, created_by: str, uses: int = 1) -> Dict:
        import uuid
        import secrets
        code = secrets.token_urlsafe(8)[:12].upper()
        invite_data = {
            "code": code,
            "created_by": created_by,
            "created_at": datetime.utcnow(),
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
    
    async def validate_invite(self, code: str) -> Optional[Dict]:
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
    
    async def use_invite(self, code: str, used_by_uid: str) -> bool:
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
    
    async def get_all_invites(self) -> List[Dict]:
        if self.enabled:
            invites = []
            for doc in self.db.collection("invites").order_by("created_at", direction=firestore.Query.DESCENDING).stream():
                data = doc.to_dict()
                data["code"] = doc.id
                invites.append(data)
            return invites
        return list(self._dev_data["invites"].values())
    
    async def deactivate_invite(self, code: str) -> bool:
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

db_service = FirestoreService()
