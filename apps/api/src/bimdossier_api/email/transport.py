from __future__ import annotations

from dataclasses import dataclass
from email.message import EmailMessage
from typing import Protocol

import aiosmtplib
import httpx

from bimdossier_api.config import get_settings


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
            start_tls=False,
            use_tls=False,
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
            raise RuntimeError(
                "PostmarkEmailTransport selected but POSTMARK_SERVER_TOKEN is unset"
            )
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
