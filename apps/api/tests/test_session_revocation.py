"""Per-user token epoch — "sign out everywhere" + password-change invalidation.

These tests isolate the `users.tokens_valid_after` epoch from the per-JTI Redis
blocklist: the strong cases log in TWICE and act on pair A, then assert pair B —
which was never presented to logout-all and so was never blocklisted — is
rejected. The only thing that can reject B is the epoch.
"""

import asyncio
import re

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from bimdossier_api.email.transport import InMemoryEmailTransport
from tests.conftest import _TEST_PASSWORD, make_test_user


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _extract_token(body: str) -> str:
    match = re.search(r"Token:\s*(\S+)", body)
    assert match is not None, f"no token in email body: {body!r}"
    return match.group(1)


async def _login(client: AsyncClient, email: str) -> dict[str, str]:
    response = await client.post(
        "/auth/jwt/login",
        data={"username": email, "password": _TEST_PASSWORD},
    )
    assert response.status_code == 200, response.text
    return response.json()


async def test_logout_all_invalidates_all_sessions(
    client: AsyncClient,
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """logout-all on one device kills tokens minted for OTHER devices too —
    proving the epoch, not just the blocklist of the presented token."""
    email = "epoch-all@example.com"
    await make_test_user(session_maker, email=email)
    a = await _login(client, email)
    b = await _login(client, email)  # a second, independent session

    # Sanity: both sessions are live.
    assert (await client.get("/users/me", headers=_auth(b["access_token"]))).status_code == 200

    out = await client.post("/auth/logout-all", headers=_auth(a["access_token"]), json={})
    assert out.status_code == 204, out.text

    # Session B's access token was never presented to logout-all, so it is not
    # on the blocklist — only the epoch can reject it.
    me_b = await client.get("/users/me", headers=_auth(b["access_token"]))
    assert me_b.status_code == 401

    # And B's refresh token is rejected too.
    refresh_b = await client.post("/auth/jwt/refresh", json={"refresh_token": b["refresh_token"]})
    assert refresh_b.status_code == 401
    assert refresh_b.json()["detail"] == "REFRESH_TOKEN_REVOKED"


async def test_logout_all_allows_fresh_login(
    client: AsyncClient,
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """The epoch is not a permanent lockout — a fresh login after it works."""
    email = "epoch-relogin@example.com"
    await make_test_user(session_maker, email=email)
    tokens = await _login(client, email)

    out = await client.post("/auth/logout-all", headers=_auth(tokens["access_token"]), json={})
    assert out.status_code == 204

    # `iat` is whole seconds; cross the epoch's second boundary so the new
    # token's floored iat is strictly after the cutoff.
    await asyncio.sleep(1.1)

    fresh = await _login(client, email)
    me = await client.get("/users/me", headers=_auth(fresh["access_token"]))
    assert me.status_code == 200, me.text


async def test_password_change_invalidates_other_sessions(
    client: AsyncClient,
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """Changing the password via /users/me kills sessions on other devices."""
    email = "epoch-pwchange@example.com"
    await make_test_user(session_maker, email=email)
    a = await _login(client, email)
    b = await _login(client, email)

    patched = await client.patch(
        "/users/me",
        headers=_auth(a["access_token"]),
        json={"password": "brand-new-passw0rd"},
    )
    assert patched.status_code == 200, patched.text

    # Session B (never used for the change) is rejected — pure epoch signal.
    me_b = await client.get("/users/me", headers=_auth(b["access_token"]))
    assert me_b.status_code == 401


async def test_password_reset_invalidates_existing_sessions(
    client: AsyncClient,
    session_maker: async_sessionmaker[AsyncSession],
    email_transport: InMemoryEmailTransport,
) -> None:
    """A forgot→reset flow invalidates the pre-reset access token."""
    email = "epoch-pwreset@example.com"
    await make_test_user(session_maker, email=email)
    tokens = await _login(client, email)
    auth = _auth(tokens["access_token"])

    forgot = await client.post("/auth/forgot-password", json={"email": email})
    assert forgot.status_code == 202, forgot.text
    sent = email_transport.last_for(email)
    assert sent is not None, "no reset email sent"
    reset_token = _extract_token(sent.body)

    reset = await client.post(
        "/auth/reset-password",
        json={"token": reset_token, "password": "reset-passw0rd-xyz"},
    )
    assert reset.status_code == 200, reset.text

    # The pre-reset token was never blocklisted, so its rejection is the epoch.
    me = await client.get("/users/me", headers=auth)
    assert me.status_code == 401
