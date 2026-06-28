"""M-en2: transactional email sends are best-effort.

Activation / password-reset / invite emails are awaited inside the request that
triggered them, but the underlying mutation (the user row, the membership) has
ALREADY committed by the time the email is sent. A transport failure — SMTP
down, timeout, bad creds — must be logged and swallowed, never surfaced as a
500 on a request whose state change already landed (every one of these flows
has a resend path). These tests install a transport that always raises and
assert both the shared helper and the reset endpoint stay graceful.
"""

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from bimdossier_api.email.transport import (
    get_email_transport,
    send_email_best_effort,
    set_email_transport,
)
from tests.conftest import make_test_user


class _BoomTransport:
    """Transport whose send() always raises, simulating a dead SMTP server."""

    def __init__(self) -> None:
        self.attempts = 0

    async def send(self, to: str, subject: str, body: str) -> None:
        self.attempts += 1
        raise RuntimeError("smtp unreachable")


@pytest.fixture
def failing_email_transport():
    previous = get_email_transport()
    transport = _BoomTransport()
    set_email_transport(transport)
    try:
        yield transport
    finally:
        set_email_transport(previous)


async def test_send_email_best_effort_swallows_transport_error(
    failing_email_transport: _BoomTransport,
) -> None:
    """The shared helper returns False (not raises) when the transport blows up."""
    result = await send_email_best_effort(to="someone@example.com", subject="hi", body="body")
    assert result is False
    assert failing_email_transport.attempts == 1


async def test_forgot_password_survives_transport_failure(
    client: AsyncClient,
    session_maker: async_sessionmaker[AsyncSession],
    failing_email_transport: _BoomTransport,
) -> None:
    """A dead mail server must not turn forgot-password into a 500.

    on_after_forgot_password runs after the request is already committed; the
    send is best-effort, so the endpoint still returns its usual 202.
    """
    email = "best-effort-reset@example.com"
    await make_test_user(session_maker, email=email, is_verified=True)

    response = await client.post("/auth/forgot-password", json={"email": email})

    assert response.status_code == 202, response.text
    # The send was attempted (and failed) — we didn't silently skip it.
    assert failing_email_transport.attempts == 1
