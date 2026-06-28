"""M-auth1 — the bare /auth/verify route is unmounted, and the resend-activation
endpoint (/auth/request-verify-token) is rate-limited.

FastAPI Users' bundled verify router (get_verify_router) shipped BOTH routes with
no rate limit:
  * /auth/verify let anyone holding an invite token flip is_verified WITHOUT
    setting a password. After that, the legit invitee's /auth/activate sees an
    already-verified user, short-circuits to a no-op, and they can never set a
    password — an onboarding-griefing / account-lockout vector.
  * /auth/request-verify-token emails an activation link on every call — an
    unthrottled email-bomb vector.

The fix drops /auth/verify entirely (activation goes through /auth/activate, which
sets the password atomically with the verify flip) and re-mounts
/auth/request-verify-token behind a per-IP limiter.
"""

import re

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from bimdossier_api.auth.routes import VERIFY_REQUEST_RATE_LIMITER
from bimdossier_api.email.transport import InMemoryEmailTransport
from tests.conftest import make_test_user


def _extract_token(body: str) -> str:
    match = re.search(r"Token:\s*(\S+)", body)
    assert match is not None, f"no token in email body: {body!r}"
    return match.group(1)


async def test_bare_verify_route_is_not_mounted(client: AsyncClient) -> None:
    """The griefing vector is closed: there is no /auth/verify to POST a stolen
    invite token to. The path is unmatched (404), not a 400 bad-token."""
    response = await client.post("/auth/verify", json={"token": "anything"})
    assert response.status_code == 404, response.text


async def test_request_verify_token_sends_activation_email(
    client: AsyncClient,
    session_maker: async_sessionmaker[AsyncSession],
    email_transport: InMemoryEmailTransport,
) -> None:
    """Resend-activation still works: an unverified user receives an activation
    email carrying a verify-audience token (the one /auth/activate consumes)."""
    email = "resend-activation@example.com"
    await make_test_user(session_maker, email=email, is_verified=False)

    resp = await client.post("/auth/request-verify-token", json={"email": email})
    assert resp.status_code == 202, resp.text

    sent = email_transport.last_for(email)
    assert sent is not None, "no activation email sent"
    assert _extract_token(sent.body)  # a usable token is present in the body


async def test_request_verify_token_is_enumeration_safe(
    client: AsyncClient,
    email_transport: InMemoryEmailTransport,
) -> None:
    """An unknown address returns 202 with no email — no signal distinguishing a
    real account from a missing one (matches the upstream behaviour we replaced)."""
    resp = await client.post(
        "/auth/request-verify-token", json={"email": "nobody-here@example.com"}
    )
    assert resp.status_code == 202, resp.text
    assert email_transport.last_for("nobody-here@example.com") is None


async def test_request_verify_token_is_rate_limited(
    rate_limited_client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The email-bomb vector is throttled per IP. Squeeze the budget to one call;
    the second trips 429 (target a non-existent address so no email is sent)."""
    monkeypatch.setattr(VERIFY_REQUEST_RATE_LIMITER, "times", 1)
    client = rate_limited_client

    first = await client.post("/auth/request-verify-token", json={"email": "rl-verify@example.com"})
    second = await client.post(
        "/auth/request-verify-token", json={"email": "rl-verify@example.com"}
    )

    assert first.status_code == 202, first.text
    assert second.status_code == 429
