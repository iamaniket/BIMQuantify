from __future__ import annotations

import logging
from dataclasses import dataclass
from email.message import EmailMessage
from typing import Protocol

import aiosmtplib
import httpx

from bimdossier_api.config import get_settings

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class SentEmail:
    to: str
    subject: str
    body: str


class EmailTransport(Protocol):
    async def send(self, to: str, subject: str, body: str) -> None: ...


class SMTPEmailTransport:
    async def send(self, to: str, subject: str, body: str) -> None:
        settings = get_settings()
        message = EmailMessage()
        message["From"] = settings.smtp_from
        message["To"] = to
        message["Subject"] = subject
        message.set_content(body)
        await aiosmtplib.send(
            message,
            hostname=settings.smtp_host,
            port=settings.smtp_port,
            # ENC-SMTP-1: TLS + optional AUTH are configurable. Dev/MailHog leaves
            # both off (plaintext :1025); production enables STARTTLS (:587) or
            # implicit TLS (:465) — enforced by validate_production_config.
            start_tls=settings.smtp_start_tls,
            use_tls=settings.smtp_use_tls,
            username=settings.smtp_username,
            password=settings.smtp_password,
            timeout=settings.smtp_timeout_seconds,
        )


class PostmarkEmailTransport:
    """Send transactional email via Postmark's HTTPS API.

    Why: compliance reminders MUST land in inbox; Postmark handles deliverability
    (SPF/DKIM/DMARC alignment, dedicated transactional IP pools) better than raw SMTP.
    """

    POSTMARK_URL = "https://api.postmarkapp.com/email"

    async def send(self, to: str, subject: str, body: str) -> None:
        settings = get_settings()
        token = settings.postmark_server_token
        if not token:
            raise RuntimeError("PostmarkEmailTransport selected but POSTMARK_SERVER_TOKEN is unset")
        payload = {
            "From": settings.smtp_from,
            "To": to,
            "Subject": subject,
            "TextBody": body,
            "MessageStream": settings.postmark_message_stream,
        }
        headers = {
            "Accept": "application/json",
            "Content-Type": "application/json",
            "X-Postmark-Server-Token": token,
        }
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(self.POSTMARK_URL, json=payload, headers=headers)
            response.raise_for_status()


class InMemoryEmailTransport:
    def __init__(self) -> None:
        self.sent: list[SentEmail] = []

    async def send(self, to: str, subject: str, body: str) -> None:
        self.sent.append(SentEmail(to=to, subject=subject, body=body))

    def last_for(self, email: str) -> SentEmail | None:
        for message in reversed(self.sent):
            if message.to == email:
                return message
        return None

    def reset(self) -> None:
        self.sent.clear()


def _build_default_transport() -> EmailTransport:
    settings = get_settings()
    if settings.email_transport == "postmark":
        return PostmarkEmailTransport()
    return SMTPEmailTransport()


_transport: EmailTransport = _build_default_transport()


def get_email_transport() -> EmailTransport:
    return _transport


def set_email_transport(transport: EmailTransport) -> None:
    global _transport
    _transport = transport


async def send_email_best_effort(*, to: str, subject: str, body: str) -> bool:
    """Send via the active transport, logging and swallowing any failure.

    Transactional emails (activation, password-reset, invites) are awaited
    inside the request that triggered them, but the underlying mutation has
    ALREADY committed by the time the email is sent (FastAPI Users commits the
    user row before `on_after_register` runs; invite endpoints commit the
    membership first). A transport failure — SMTP down, timeout, bad creds —
    must therefore never propagate: it would 500 a request whose state change
    already landed, with nothing to roll back and a confusing error for the
    admin. Every one of these flows has a resend path, so best-effort is safe:
    log loudly, return False, never raise. Returns True on a successful send.
    """
    try:
        await get_email_transport().send(to=to, subject=subject, body=body)
        return True
    except Exception:
        logger.warning(
            "Email send failed (to=%s subject=%r) — swallowed, mutation already committed",
            to,
            subject,
            exc_info=True,
        )
        return False
