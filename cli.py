#!/usr/bin/env python3
import os
import sys
import argparse
import secrets
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from datetime import datetime

def get_firestore_client():
    import firebase_admin
    from firebase_admin import credentials, firestore
    
    if not firebase_admin._apps:
        key_path = os.getenv("FIREBASE_KEY_PATH", "firebase-key.json")
        if os.path.exists(key_path):
            cred = credentials.Certificate(key_path)
            firebase_admin.initialize_app(cred)
        else:
            print(f"Error: Firebase key not found at {key_path}")
            sys.exit(1)
    
    return firestore.client()

def create_invite(uses: int = 1, email_to: str = None):
    db = get_firestore_client()
    
    code = secrets.token_urlsafe(8)[:12].upper()
    invite_data = {
        "code": code,
        "created_by": "cli",
        "created_at": datetime.utcnow(),
        "max_uses": uses,
        "used_count": 0,
        "used_by": [],
        "active": True
    }
    
    db.collection("invites").document(code).set(invite_data)
    print(f"Created invite: {code} (uses: {uses})")
    
    if email_to:
        send_invite_email(email_to, code)
    
    return code

def list_invites():
    db = get_firestore_client()
    
    invites = db.collection("invites").order_by("created_at", direction="DESCENDING").stream()
    
    print(f"{'Code':<14} {'Uses':<10} {'Status':<10} {'Created'}")
    print("-" * 50)
    
    for doc in invites:
        data = doc.to_dict()
        status = "Active" if data.get("active") and data.get("used_count", 0) < data.get("max_uses", 1) else "Inactive"
        uses = f"{data.get('used_count', 0)}/{data.get('max_uses', 1)}"
        created = data.get("created_at", datetime.utcnow()).strftime("%Y-%m-%d")
        print(f"{doc.id:<14} {uses:<10} {status:<10} {created}")

def deactivate_invite(code: str):
    db = get_firestore_client()
    code = code.strip().upper()
    
    doc_ref = db.collection("invites").document(code)
    if doc_ref.get().exists:
        doc_ref.update({"active": False})
        print(f"Deactivated: {code}")
    else:
        print(f"Not found: {code}")

def send_invite_email(to_email: str, code: str):
    smtp_host = os.getenv("SMTP_HOST", "smtp.gmail.com")
    smtp_port = int(os.getenv("SMTP_PORT", "587"))
    smtp_user = os.getenv("SMTP_USER")
    smtp_pass = os.getenv("SMTP_PASS")
    from_email = os.getenv("SMTP_FROM", smtp_user)
    app_url = os.getenv("APP_URL", "https://your-app.com")
    
    if not smtp_user or not smtp_pass:
        print("Warning: SMTP not configured. Set SMTP_USER and SMTP_PASS.")
        print(f"Invite code for {to_email}: {code}")
        return False
    
    msg = MIMEMultipart("alternative")
    msg["Subject"] = "You're invited!"
    msg["From"] = from_email
    msg["To"] = to_email
    
    text = f"""You've been invited!

Your invite code: {code}

Register at: {app_url}/register

This code can only be used once.
"""
    
    html = f"""
<!DOCTYPE html>
<html>
<head>
    <style>
        body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #1a1a1a; color: #fff; padding: 40px; }}
        .container {{ max-width: 500px; margin: 0 auto; background: #2d2d2d; border-radius: 12px; padding: 40px; }}
        .code {{ font-family: monospace; font-size: 28px; letter-spacing: 4px; background: #3d3d3d; padding: 16px 24px; border-radius: 8px; text-align: center; margin: 24px 0; }}
        .btn {{ display: inline-block; background: #7c3aed; color: #fff; padding: 12px 24px; border-radius: 8px; text-decoration: none; margin-top: 16px; }}
        .footer {{ margin-top: 32px; font-size: 12px; color: #888; }}
    </style>
</head>
<body>
    <div class="container">
        <h1>You're invited!</h1>
        <p>Use this code to create your account:</p>
        <div class="code">{code}</div>
        <a href="{app_url}/register" class="btn">Create Account</a>
        <p class="footer">This code can only be used once.</p>
    </div>
</body>
</html>
"""
    
    msg.attach(MIMEText(text, "plain"))
    msg.attach(MIMEText(html, "html"))
    
    try:
        with smtplib.SMTP(smtp_host, smtp_port) as server:
            server.starttls()
            server.login(smtp_user, smtp_pass)
            server.sendmail(from_email, to_email, msg.as_string())
        print(f"Sent invite to {to_email}")
        return True
    except Exception as e:
        print(f"Failed to send email: {e}")
        print(f"Invite code for {to_email}: {code}")
        return False

def main():
    parser = argparse.ArgumentParser(description="Invite code management CLI")
    subparsers = parser.add_subparsers(dest="command", help="Commands")
    
    # create
    create_parser = subparsers.add_parser("create", help="Create invite code")
    create_parser.add_argument("-n", "--uses", type=int, default=1, help="Number of uses (default: 1)")
    create_parser.add_argument("-e", "--email", type=str, help="Email to send invite to")
    
    # list
    subparsers.add_parser("list", help="List all invites")
    
    # deactivate
    deactivate_parser = subparsers.add_parser("deactivate", help="Deactivate invite")
    deactivate_parser.add_argument("code", help="Invite code to deactivate")
    
    # send
    send_parser = subparsers.add_parser("send", help="Send existing code via email")
    send_parser.add_argument("code", help="Invite code")
    send_parser.add_argument("email", help="Email address")
    
    args = parser.parse_args()
    
    if args.command == "create":
        create_invite(args.uses, args.email)
    elif args.command == "list":
        list_invites()
    elif args.command == "deactivate":
        deactivate_invite(args.code)
    elif args.command == "send":
        send_invite_email(args.email, args.code.upper())
    else:
        parser.print_help()

if __name__ == "__main__":
    main()
