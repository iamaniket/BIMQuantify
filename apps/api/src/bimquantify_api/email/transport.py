from __future__ import annotations

from dataclasses import dataclass
from email.message import EmailMessage
from typing import Protocol

import aiosmtplib

from bimquantify_api.config import get_settings


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


_transport: EmailTransport = SMTPEmailTransport()


def get_email_transport() -> EmailTransport:
    return _transport


def set_email_transport(transport: EmailTransport) -> None:
    global _transport
    _transport = transport
