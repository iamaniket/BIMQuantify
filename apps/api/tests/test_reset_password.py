"""Tests for the forgot-password / reset-password flow.

This flow was previously broken in production: the frontend showed
"Password reset failed. The link may have expired" even on successful
resets because `POST /auth/reset-password` returns 200 with body `null`
and the frontend's Zod schema rejected null. The fix lives on the
frontend (postNoContent), but these tests pin the server contract so
the regression can't recur:

  - the endpoint MUST stay 200 (not 204) so the no-content client works
  - reset-password MUST NOT inherit the forgot-password rate limit
  - a forged token MUST yield 400 RESET_PASSWORD_BAD_TOKEN
  - silent paths (unknown email, inactive user) MUST NOT leak existence

Mirrors test_activate.py for the parallel invite-activation flow.
"""

import re

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from bimdossier_api.config import get_settings
from bimdossier_api.email.transport import InMemoryEmailTransport
from tests.conftest import _TEST_PASSWORD, make_test_user

NEW_PASSWORD = "fresh-horse-staple-67"


def _extract_token(body: str) -> str:
    match = re.search(r"Token:\s*(\S+)", body)
    assert match is not None, f"no token in email body: {body!r}"
    return match.group(1)


async def _request_reset_token(
    client: AsyncClient, email: str, transport: InMemoryEmailTransport
) -> str:
    response = await client.post("/auth/forgot-password", json={"email": email})
    assert response.status_code == 202, response.text
    sent = transport.last_for(email)
    assert sent is not None, f"no reset email sent to {email}"
    return _extract_token(sent.body)


async def test_forgot_then_reset_then_login(
    client: AsyncClient,
    session_maker: async_sessionmaker[AsyncSession],
    email_transport: InMemoryEmailTransport,
) -> None:
    """Happy path: forgot → email → reset → log in with new password."""
    email = "reset-success@example.com"
    await make_test_user(session_maker, email=email, is_verified=True)
    token = await _request_reset_token(client, email, email_transport)

    response = await client.post(
        "/auth/reset-password", json={"token": token, "password": NEW_PASSWORD}
    )
    # Pinned at 200 — fastapi-users 15.x returns 200 with body `null`.
    # If a future version flips this to 204 the frontend (postNoContent)
    # still works, but we want the change to be deliberate.
    assert response.status_code == 200, response.text

    # Old password no longer works.
    old_login = await client.post(
        "/auth/jwt/login",
        data={"username": email, "password": _TEST_PASSWORD},
    )
    assert old_login.status_code == 400, old_login.text

    # New password works.
    new_login = await client.post(
        "/auth/jwt/login",
        data={"username": email, "password": NEW_PASSWORD},
    )
    assert new_login.status_code == 200, new_login.text


async def test_reset_password_bad_token(client: AsyncClient) -> None:
    """A forged or malformed token must be rejected with 400."""
    response = await client.post(
        "/auth/reset-password",
        json={"token": "not-a-real-token", "password": NEW_PASSWORD},
    )
    assert response.status_code == 400
    assert response.json()["detail"] == "RESET_PASSWORD_BAD_TOKEN"


async def test_reset_password_stale_token_after_password_change(
    client: AsyncClient,
    session_maker: async_sessionmaker[AsyncSession],
    email_transport: InMemoryEmailTransport,
) -> None:
    """Token includes a password-fingerprint; using it after a successful
    reset must fail. Mirrors fastapi-users' built-in invalidation guard.
    """
    email = "reset-stale@example.com"
    await make_test_user(session_maker, email=email, is_verified=True)
    token = await _request_reset_token(client, email, email_transport)

    # First reset consumes the token's fingerprint.
    first = await client.post(
        "/auth/reset-password", json={"token": token, "password": NEW_PASSWORD}
    )
    assert first.status_code == 200, first.text

    # Replay with the same token after the password changed → 400.
    second = await client.post(
        "/auth/reset-password",
        json={"token": token, "password": "another-password-9999"},
    )
    assert second.status_code == 400
    assert second.json()["detail"] == "RESET_PASSWORD_BAD_TOKEN"


async def test_forgot_password_unknown_email_silent(
    client: AsyncClient,
    email_transport: InMemoryEmailTransport,
) -> None:
    """Unknown email must still 202 with no email sent (no enumeration)."""
    response = await client.post(
        "/auth/forgot-password", json={"email": "nobody@example.com"}
    )
    assert response.status_code == 202, response.text
    assert email_transport.last_for("nobody@example.com") is None


async def test_forgot_password_inactive_user_silent(
    client: AsyncClient,
    session_maker: async_sessionmaker[AsyncSession],
    email_transport: InMemoryEmailTransport,
) -> None:
    """Inactive users must not receive a reset email — but the API still 202s."""
    from sqlalchemy import select

    from bimdossier_api.models.user import User

    email = "reset-inactive@example.com"
    await make_test_user(session_maker, email=email, is_verified=True)
    async with session_maker() as session:
        user = (
            await session.execute(select(User).where(User.email == email))
        ).scalar_one()
        user.is_active = False
        await session.commit()

    response = await client.post("/auth/forgot-password", json={"email": email})
    assert response.status_code == 202, response.text
    assert email_transport.last_for(email) is None


async def test_forgot_password_rate_limit(
    rate_limited_client: AsyncClient,
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """The shadow forgot-password route must enforce FORGOT_RATE_LIMITER."""
    email = "reset-ratelimit@example.com"
    await make_test_user(session_maker, email=email, is_verified=True)

    limit = get_settings().rate_limit_forgot_per_hour
    last_status: int | None = None
    for _ in range(limit + 1):
        response = await rate_limited_client.post(
            "/auth/forgot-password", json={"email": email}
        )
        last_status = response.status_code

    assert last_status == 429


async def test_reset_password_not_rate_limited_by_forgot(
    rate_limited_client: AsyncClient,
) -> None:
    """Regression guard for the secondary fix.

    Before: FORGOT_RATE_LIMITER was attached to the entire
    `get_reset_password_router()`, so 3 bad reset attempts in an hour
    locked the user out with 429s that the frontend rendered as
    "link expired". After the fix, reset-password should never 429
    on the forgot bucket — only 400 RESET_PASSWORD_BAD_TOKEN.
    """
    limit = get_settings().rate_limit_forgot_per_hour
    statuses: list[int] = []
    for _ in range(limit + 2):
        response = await rate_limited_client.post(
            "/auth/reset-password",
            json={"token": "not-a-real-token", "password": NEW_PASSWORD},
        )
        statuses.append(response.status_code)

    assert 429 not in statuses, statuses
    assert all(s == 400 for s in statuses), statuses
