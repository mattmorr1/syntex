import asyncio
import html
import logging
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

import httpx

from config import Config

logger = logging.getLogger(__name__)

RESEND_ENDPOINT = "https://api.resend.com/emails"


async def send_email(to: str, subject: str, body_html: str) -> bool:
    """
    Send one email. Prefers the HTTP API when a key is configured, falling back to SMTP.

    Both paths are TLS-encrypted — SMTP is not the insecure option here, and an API key
    is preferred for a different reason: it is scoped to sending and revocable on its own,
    where a mailbox app password carries the whole account with it.
    """
    if Config.RESEND_API_KEY:
        return await _send_via_api(to, subject, body_html)
    if Config.SMTP_USER and Config.SMTP_PASS:
        # smtplib is synchronous; without this the event loop stalls on the SMTP
        # handshake, which is slow enough to matter.
        return await asyncio.to_thread(_send_via_smtp, to, subject, body_html)
    logger.warning("No email transport configured — skipping email to %s", to)
    return False


async def _send_via_api(to: str, subject: str, body_html: str) -> bool:
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.post(
                RESEND_ENDPOINT,
                headers={"Authorization": f"Bearer {Config.RESEND_API_KEY}"},
                json={
                    "from": Config.EMAIL_FROM,
                    "to": [to],
                    "subject": subject,
                    "html": body_html,
                },
            )
        if response.status_code >= 400:
            logger.error("Email API rejected send to %s: %s %s",
                         to, response.status_code, response.text[:200])
            return False
        return True
    except Exception as e:
        logger.error("Email API send failed to %s: %s", to, e)
        return False


def _send_via_smtp(to: str, subject: str, body_html: str) -> bool:
    """Blocking. Call through asyncio.to_thread."""
    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = Config.EMAIL_FROM or Config.SMTP_USER
        msg["To"] = to
        msg.attach(MIMEText(body_html, "html"))

        with smtplib.SMTP(Config.SMTP_HOST, Config.SMTP_PORT, timeout=20) as server:
            server.ehlo()
            server.starttls()
            server.login(Config.SMTP_USER, Config.SMTP_PASS)
            server.sendmail(msg["From"], [to], msg.as_string())
        return True
    except Exception as e:
        logger.error("SMTP send failed to %s: %s", to, e)
        return False


async def send_access_approved(to: str, name: str, setup_link: str):
    # name reaches here from the public access-request form; escaping it keeps submitted
    # markup from being rendered as HTML in mail sent from our own domain.
    safe_name = html.escape(name or "there")
    safe_link = html.escape(setup_link, quote=True)
    subject = "Your Syntex access has been approved"
    body = f"""
    <p>Hi {safe_name},</p>
    <p>Your request to access <strong>Syntex</strong> has been approved.</p>
    <p>Click the link below to set your password and log in:</p>
    <p><a href="{safe_link}">{safe_link}</a></p>
    <p>This link will expire after 24 hours.</p>
    <p>— The Syntex Team</p>
    """
    await send_email(to, subject, body)


async def send_access_rejected(to: str, name: str, reason: str = ""):
    safe_name = html.escape(name or "there")
    subject = "Update on your Syntex access request"
    reason_line = f"<p>Reason: {html.escape(reason)}</p>" if reason else ""
    body = f"""
    <p>Hi {safe_name},</p>
    <p>Thank you for your interest in <strong>Syntex</strong>. Unfortunately, your access request
    was not approved at this time.</p>
    {reason_line}
    <p>If you believe this is an error, please contact us.</p>
    <p>— The Syntex Team</p>
    """
    await send_email(to, subject, body)
