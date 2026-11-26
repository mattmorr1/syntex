"""Invite-only gate checks; Firebase and Firestore are stubbed. Run: DEBUG=true python -m pytest test_auth.py"""
import asyncio
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import FastAPI
from fastapi.security import HTTPAuthorizationCredentials
from fastapi.testclient import TestClient

from api.routers import auth as auth_router
from api.services.firestore import db_service

ADMIN = auth_router.ADMIN_EMAIL


class FakeStore:
    def __init__(self):
        self.users, self.allowed, self.touched, self.deleted_allow = {}, {}, [], []

    async def get_user(self, uid):
        return self.users.get(uid)

    async def update_last_accessed(self, uid):
        self.touched.append(uid)

    async def get_allowed_email(self, email):
        e = self.allowed.get(email)
        return e if e and (e["expires_at"] is None or e["expires_at"] > datetime.now(timezone.utc)) else None

    async def create_user(self, uid, email, username, role="user"):
        self.users[uid] = {"uid": uid, "email": email, "username": username, "role": role, "tokens_used": {}}
        return self.users[uid]

    async def delete_allowed_email(self, email):
        self.deleted_allow.append(email)
        self.allowed.pop(email, None)


@pytest.fixture
def env(monkeypatch):
    store = FakeStore()
    for name in ("get_user", "update_last_accessed", "get_allowed_email", "create_user", "delete_allowed_email"):
        monkeypatch.setattr(db_service, name, getattr(store, name))
    monkeypatch.setattr(db_service, "enabled", True)
    monkeypatch.setattr(db_service, "_ensure_initialized", lambda: None)
    tokens, deleted = {}, []

    def verify(tok):
        if tok not in tokens:
            raise ValueError("not a firebase token")
        return tokens[tok]
    monkeypatch.setattr(auth_router.auth, "verify_id_token", verify)
    monkeypatch.setattr(auth_router.auth, "delete_user", deleted.append)
    auth_router._last_access.clear()
    return store, tokens, deleted


def current_user(token):
    return asyncio.run(auth_router.get_current_user(HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)))


def client():
    app = FastAPI()
    app.state.limiter = auth_router.limiter
    app.include_router(auth_router.router)
    return TestClient(app)


def test_valid_firebase_token_without_profile_is_rejected(env):
    _, tokens, _ = env
    tokens["t"] = {"uid": "stranger", "email": "anyone@gmail.com"}
    with pytest.raises(auth_router.HTTPException) as e:
        current_user("t")
    assert e.value.status_code == 403 and e.value.detail["code"] == "not_provisioned"


def test_admin_jwt_without_profile_is_rejected(env):
    jwt_tok = auth_router.create_jwt_token("ghost", "ghost@x.com", "admin")
    with pytest.raises(auth_router.HTTPException) as e:
        current_user(jwt_tok)
    assert e.value.status_code == 403


def test_provisioned_user_passes_and_last_access_is_throttled(env):
    store, tokens, _ = env
    tokens["t"] = {"uid": "u1", "email": "a@b.com"}
    store.users["u1"] = {"uid": "u1", "email": "a@b.com", "role": "user"}
    for _ in range(3):
        assert current_user("t")["uid"] == "u1"
    assert store.touched == ["u1"]


def test_provision_refuses_uninvited_and_deletes_orphan(env):
    store, tokens, deleted = env
    tokens["t"] = {"uid": "g1", "email": "Random@Gmail.com", "email_verified": True}
    r = client().post("/auth/provision", json={}, headers={"Authorization": "Bearer t"})
    assert r.status_code == 403 and r.json()["detail"]["code"] == "not_invited"
    assert deleted == ["g1"] and "g1" not in store.users


def test_provision_with_redeemed_invite_creates_profile_once(env):
    store, tokens, deleted = env
    store.allowed["new@uni.edu"] = {"role": "user", "expires_at": datetime.now(timezone.utc) + timedelta(hours=1)}
    tokens["t"] = {"uid": "n1", "email": "new@uni.edu", "name": "New Person"}
    c = client()
    r = c.post("/auth/provision", json={"username": "newbie"}, headers={"Authorization": "Bearer t"})
    assert r.status_code == 200 and r.json()["user"]["username"] == "newbie"
    assert store.deleted_allow == ["new@uni.edu"] and not deleted
    assert c.post("/auth/provision", json={}, headers={"Authorization": "Bearer t"}).status_code == 200, "idempotent for existing profile"


def test_expired_allowlist_entry_is_refused(env):
    store, tokens, _ = env
    store.allowed["late@uni.edu"] = {"role": "user", "expires_at": datetime.now(timezone.utc) - timedelta(minutes=1)}
    tokens["t"] = {"uid": "l1", "email": "late@uni.edu"}
    assert client().post("/auth/provision", json={}, headers={"Authorization": "Bearer t"}).status_code == 403


def test_admin_role_requires_verified_email(env):
    store, tokens, _ = env
    tokens["unverified"] = {"uid": "a1", "email": ADMIN, "email_verified": False}
    tokens["verified"] = {"uid": "a2", "email": ADMIN, "email_verified": True}
    c = client()
    r = c.post("/auth/provision", json={}, headers={"Authorization": "Bearer unverified"})
    assert r.status_code == 403 and r.json()["detail"]["code"] == "email_unverified"
    r = c.post("/auth/provision", json={}, headers={"Authorization": "Bearer verified"})
    assert r.status_code == 200 and r.json()["user"]["role"] == "admin"


def test_allowlisted_admin_role_also_requires_verification(env):
    store, tokens, _ = env
    store.allowed["prof@uni.edu"] = {"role": "admin", "expires_at": None}
    tokens["t"] = {"uid": "p1", "email": "prof@uni.edu", "email_verified": False}
    assert client().post("/auth/provision", json={}, headers={"Authorization": "Bearer t"}).status_code == 403


def test_register_endpoint_is_closed_in_firebase_mode(env):
    r = client().post("/auth/register", json={"email": "x@y.com", "password": "pw123456", "username": "x", "invite_code": "ABC"})
    assert r.status_code == 410


def test_dev_redeem_invite_is_single_use():
    invite = asyncio.run(db_service.create_invite("test", 1))
    assert asyncio.run(db_service.redeem_invite(invite["code"].lower(), "One@Uni.edu"))
    assert not asyncio.run(db_service.redeem_invite(invite["code"], "two@uni.edu"))
    entry = asyncio.run(db_service.get_allowed_email("one@uni.edu"))
    assert entry and entry["invite_code"] == invite["code"]
    assert asyncio.run(db_service.get_allowed_email("two@uni.edu")) is None


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-q"]))
