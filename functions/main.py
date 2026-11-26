"""beforeCreate gate: Firebase Auth refuses any client-side sign-up whose email is not allowlisted.

Admin SDK creates (access-request approval, cli.py) do not trigger blocking functions, by design.
"""
from datetime import datetime, timezone

from firebase_admin import firestore, initialize_app
from firebase_functions import https_fn, identity_fn
from firebase_functions.params import StringParam

initialize_app()
ADMIN_EMAIL = StringParam("ADMIN_EMAIL")


@identity_fn.before_user_created(region="us-central1", timeout_sec=10)
def gate_signup(event: identity_fn.AuthBlockingEvent) -> identity_fn.BeforeCreateResponse | None:
    email = (event.data.email or "").strip().lower()
    if email and email == ADMIN_EMAIL.value.strip().lower():
        return None
    snap = firestore.client().collection("allowed_emails").document(email).get() if email and "/" not in email else None
    entry = snap.to_dict() if snap is not None and snap.exists else None
    if entry and (entry.get("expires_at") is None or entry["expires_at"] > datetime.now(timezone.utc)):
        return None
    print(f"gate_signup denied email={email!r} provider={event.additional_user_info.provider_id if event.additional_user_info else None}")
    raise https_fn.HttpsError(code=https_fn.FunctionsErrorCode.PERMISSION_DENIED,
                              message="INVITE_REQUIRED: this app is invite-only. Redeem an invite for this email first.")
