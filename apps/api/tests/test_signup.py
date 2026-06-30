"""Tests for POST /auth/signup — public, org-less, free-tier signup.

The app is invite-only by default: there is no /auth/register, and org /
founding-partner onboarding goes through admin invites. The free wedge needs
ONE public door — a real, email-verified, ORG-LESS account — gated behind the
FREE_TIER_ENABLED kill-switch (the route is not even mounted when off).

Contract:
  * disabled (default) → 404, the route does not exist
  * enabled → always 202 (enumeration-safe), creates an org-less unverified
    user, sends the activation email, and is NOT an org member
  * the existing /auth/activate flow then verifies + sets the password, and the
    activated user logs in with NO `org` claim and an empty membership list
"""

import re
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import pytest
from httpx import ASGITransport, AsyncClient
from redis.asyncio import Redis
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

from bimdossier_api.auth.tokens import decode_token_full
from bimdossier_api.email.transport import InMemoryEmailTransport
from bimdossier_api.models.organization_member import OrganizationMember
from bimdossier_api.models.user import User
from tests.conftest import make_test_user

NEW_PASSWORD = "fresh-horse-staple-67"


def _extract_token(body: str) -> str:
    match = re.search(r"Token:\s*(\S+)", body)
    assert match is not None, f"no token in email body: {body!r}"
    return match.group(1)


async def _count_users(
    session_maker: async_sessionmaker[AsyncSession], email: str
) -> int:
    async with session_maker() as session:
        return (
            await session.scalar(
                select(func.count())
                .select_from(User)
                .where(func.lower(User.email) == email.lower())
            )
        ) or 0


async def _count_memberships(
    session_maker: async_sessionmaker[AsyncSession], user_id: object
) -> int:
    async with session_maker() as session:
        return (
            await session.scalar(
                select(func.count())
                .select_from(OrganizationMember)
                .where(OrganizationMember.user_id == user_id)
            )
        ) or 0


async def test_signup_disabled_returns_404(client: AsyncClient) -> None:
    """With FREE_TIER_ENABLED off (the default `client`), the route is not
    mounted at all — the kill-switch physically closes the surface."""
    resp = await client.post("/auth/signup", json={"email": "nope@example.com"})
    assert resp.status_code == 404, resp.text


async def test_signup_creates_orgless_user_and_sends_activation(
    free_tier_client: AsyncClient,
    session_maker: async_sessionmaker[AsyncSession],
    email_transport: InMemoryEmailTransport,
) -> None:
    """Happy path: 202 → org-less unverified user + activation email; then
    /auth/activate verifies + sets password; login carries NO `org` claim."""
    email = "signup-fresh@example.com"
    resp = await free_tier_client.post(
        "/auth/signup", json={"email": email, "locale": "en"}
    )
    assert resp.status_code == 202, resp.text

    async with session_maker() as session:
        user = (
            await session.execute(select(User).where(User.email == email))
        ).scalar_one()
        assert user.is_verified is False
        assert user.is_superuser is False
        assert user.is_active is True
        assert user.locale == "en"
        # No name/company submitted on this call → stored as NULL.
        assert user.full_name is None
        assert user.company is None
        user_id = user.id

    # Org-less: signup must NOT create any OrganizationMember row.
    assert await _count_memberships(session_maker, user_id) == 0

    # Activation email went out; activate with the token.
    sent = email_transport.last_for(email)
    assert sent is not None, "no activation email sent"
    token = _extract_token(sent.body)
    activate = await free_tier_client.post(
        "/auth/activate", json={"token": token, "password": NEW_PASSWORD}
    )
    assert activate.status_code == 204, activate.text

    # Login succeeds and mints a token with NO `org` claim (org-less account).
    login = await free_tier_client.post(
        "/auth/jwt/login", data={"username": email, "password": NEW_PASSWORD}
    )
    assert login.status_code == 200, login.text
    decoded = decode_token_full(login.json()["access_token"], "access")
    assert decoded.active_organization_id is None


async def test_signup_persists_optional_name_and_company(
    free_tier_client: AsyncClient,
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """The free-signup form's optional name + company are trimmed and stored on
    the org-less user so an operator can spot founding-partner candidates among
    self-serve signups."""
    email = "signup-lead@example.com"
    resp = await free_tier_client.post(
        "/auth/signup",
        json={
            "email": email,
            "full_name": "  Tess Tester  ",
            "company": "  Bouwbedrijf Tester BV  ",
        },
    )
    assert resp.status_code == 202, resp.text

    async with session_maker() as session:
        user = (
            await session.execute(select(User).where(User.email == email))
        ).scalar_one()
        assert user.full_name == "Tess Tester"
        assert user.company == "Bouwbedrijf Tester BV"


async def test_orgless_user_me_has_no_memberships(
    client: AsyncClient,
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """The shared shell must tolerate a member-less `me`: an org-less user logs
    in and /auth/me returns an empty membership list + null active org. (Uses a
    pre-verified user so there's no activate→login token-epoch race.)"""
    email = "orgless-me@example.com"
    await make_test_user(session_maker, email=email, is_verified=True)
    login = await client.post(
        "/auth/jwt/login", data={"username": email, "password": "correct-horse-battery"}
    )
    assert login.status_code == 200, login.text
    access = login.json()["access_token"]

    me = await client.get("/auth/me", headers={"Authorization": f"Bearer {access}"})
    assert me.status_code == 200, me.text
    body = me.json()
    assert body["active_organization_id"] is None
    assert body["memberships"] == []
    # Entitlement axis: an org-less account is on the FREE plan (orthogonal to the
    # isolation surface — see entitlements.resolve_plan).
    assert body["plan"] == "free"


async def test_signup_existing_email_is_enumeration_safe(
    free_tier_client: AsyncClient,
    session_maker: async_sessionmaker[AsyncSession],
    email_transport: InMemoryEmailTransport,
) -> None:
    """An address that already exists gets the SAME 202 with no new user, no
    membership, and no signal that the account exists."""
    email = "signup-existing@example.com"
    existing_id = await make_test_user(session_maker, email=email, is_verified=True)

    resp = await free_tier_client.post("/auth/signup", json={"email": email})
    assert resp.status_code == 202, resp.text

    # No duplicate user row, no membership conjured for the existing account.
    assert await _count_users(session_maker, email) == 1
    assert await _count_memberships(session_maker, existing_id) == 0


@asynccontextmanager
async def _rate_limited_free_client(
    engine: AsyncEngine,
    session_maker: async_sessionmaker[AsyncSession],
    redis_client: Redis,
    monkeypatch: pytest.MonkeyPatch,
) -> AsyncIterator[AsyncClient]:
    """Flag-on app with real (un-overridden) rate limiting, mirroring the
    `rate_limited_client` fixture plus FREE_TIER_ENABLED."""
    from fastapi_limiter import FastAPILimiter

    from bimdossier_api import db as db_module
    from bimdossier_api.cache import client as cache_module
    from bimdossier_api.config import get_settings
    from bimdossier_api.main import create_app

    db_module._engine = engine
    db_module._session_maker = session_maker
    cache_module._redis = redis_client

    monkeypatch.setenv("FREE_TIER_ENABLED", "true")
    get_settings.cache_clear()
    # Clean slate so leftover signup counters from a prior run don't trip 429
    # early (this test's own client overrides nothing — the limiter is live).
    await redis_client.flushdb()
    await FastAPILimiter.init(redis_client)
    try:
        app = create_app()
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            yield ac
    finally:
        await FastAPILimiter.close()
        monkeypatch.delenv("FREE_TIER_ENABLED", raising=False)
        get_settings.cache_clear()


async def test_signup_rate_limited_per_ip(
    engine: AsyncEngine,
    session_maker: async_sessionmaker[AsyncSession],
    redis_client: Redis,
    email_transport: InMemoryEmailTransport,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The per-IP limiter trips after RATE_LIMIT_SIGNUP_PER_HOUR (default 5);
    every call is still 202 until then (enumeration-safe), then 429."""
    async with _rate_limited_free_client(
        engine, session_maker, redis_client, monkeypatch
    ) as client:
        limit = 5  # RATE_LIMIT_SIGNUP_PER_HOUR default
        for i in range(limit):
            resp = await client.post(
                "/auth/signup", json={"email": f"ratelimit-{i}@example.com"}
            )
            assert resp.status_code == 202, f"call {i}: {resp.text}"
        blocked = await client.post(
            "/auth/signup", json={"email": "ratelimit-blocked@example.com"}
        )
        assert blocked.status_code == 429, blocked.text
