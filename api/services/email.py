import smtplib
import logging
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

from config import Config

logger = logging.getLogger(__name__)


async def send_email(to: str, subject: str, body_html: str) -> bool:
    """Send an email via SMTP. Returns True on success, False on failure."""
    if not Config.SMTP_USER or not Config.SMTP_PASS:
        logger.warning("SMTP not configured — skipping email to %s", to)
        return False

    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = Config.SMTP_FROM or Config.SMTP_USER
        msg["To"] = to
        msg.attach(MIMEText(body_html, "html"))

        with smtplib.SMTP(Config.SMTP_HOST, Config.SMTP_PORT) as server:
            server.ehlo()
            server.starttls()
            server.login(Config.SMTP_USER, Config.SMTP_PASS)
            server.sendmail(msg["From"], [to], msg.as_string())
        return True
    except Exception as e:
        logger.error("Email send failed to %s: %s", to, e)
        return False


async def send_access_approved(to: str, name: str, setup_link: str):
    subject = "Your Syntex access has been approved"
    body = f"""
    <p>Hi {name},</p>
    <p>Your request to access <strong>Syntex</strong> has been approved.</p>
    <p>Click the link below to set your password and log in:</p>
    <p><a href="{setup_link}">{setup_link}</a></p>
    <p>This link will expire after 24 hours.</p>
    <p>— The Syntex Team</p>
    """
    await send_email(to, subject, body)


async def send_access_rejected(to: str, name: str, reason: str = ""):
    subject = "Update on your Syntex access request"
    reason_line = f"<p>Reason: {reason}</p>" if reason else ""
    body = f"""
    <p>Hi {name},</p>
    <p>Thank you for your interest in <strong>Syntex</strong>. Unfortunately, your access request
    was not approved at this time.</p>
    {reason_line}
    <p>If you believe this is an error, please contact us.</p>
    <p>— The Syntex Team</p>
    """
    await send_email(to, subject, body)
