from __future__ import annotations

import os
from typing import TYPE_CHECKING

import pytest
from httpx import ASGITransport, AsyncClient
from redis.asyncio import Redis, from_url
from sqlalchemy import text
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

if TYPE_CHECKING:
    from collections.abc import AsyncGenerator, Generator

# ---------------------------------------------------------------------------
# Environment: point the app at the test database BEFORE importing it.
# ---------------------------------------------------------------------------
_TEST_DB_URL = os.environ.get(
    "TEST_DATABASE_URL",
    "postgresql+asyncpg://bim:bim@localhost:5434/bimstitch_test",
)
os.environ["DATABASE_URL"] = _TEST_DB_URL
os.environ.setdefault("JWT_SECRET", "test-secret")
os.environ.setdefault("SMTP_HOST", "localhost")
os.environ.setdefault("SMTP_PORT", "1025")

_TEST_REDIS_URL = os.environ.get("TEST_REDIS_URL", "redis://localhost:6380/1")
os.environ["REDIS_URL"] = _TEST_REDIS_URL


@pytest.fixture(scope="session")
async def engine() -> AsyncGenerator[AsyncEngine, None]:
    # Imported here so env vars above take effect first.
    from bimstitch_api._rls_sql import (
        create_app_role_statements,
        disable_rls_statements,
        enable_rls_statements,
    )
    from bimstitch_api.db import Base
    from bimstitch_api.models import Organization, Project, ProjectMember, User  # noqa: F401

    eng = create_async_engine(_TEST_DB_URL, future=True)

    async with eng.begin() as conn:
        # Drop policies/enum left behind from a prior aborted run, then recreate
        # the schema from metadata. `create_all` is DDL-only — RLS policies are
        # applied separately below to mirror what the migration does.
        for stmt in disable_rls_statements():
            await conn.exec_driver_sql(
                f"DO $$ BEGIN {stmt} EXCEPTION WHEN others THEN NULL; END $$;"
            )
        await conn.run_sync(Base.metadata.drop_all)
        await conn.exec_driver_sql("DROP TYPE IF EXISTS projectrole")
        await conn.run_sync(Base.metadata.create_all)
        for stmt in create_app_role_statements():
            await conn.exec_driver_sql(stmt)
        for stmt in enable_rls_statements():
            await conn.exec_driver_sql(stmt)

    yield eng

    async with eng.begin() as conn:
        for stmt in disable_rls_statements():
            await conn.exec_driver_sql(
                f"DO $$ BEGIN {stmt} EXCEPTION WHEN others THEN NULL; END $$;"
            )
        await conn.run_sync(Base.metadata.drop_all)
        await conn.exec_driver_sql("DROP TYPE IF EXISTS projectrole")
    await eng.dispose()


@pytest.fixture(scope="session")
def session_maker(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, expire_on_commit=False)


@pytest.fixture(scope="session")
async def redis_client() -> AsyncGenerator[Redis, None]:
    client = from_url(_TEST_REDIS_URL, decode_responses=True)
    await client.ping()
    yield client
    await client.aclose()


@pytest.fixture(autouse=True)
async def _clean_tables(
    session_maker: async_sessionmaker[AsyncSession],
) -> AsyncGenerator[None, None]:
    yield
    async with session_maker() as session:
        # TRUNCATE ... CASCADE handles FK ordering atomically. RLS policies do
        # not block TRUNCATE for the table owner with FORCE — TRUNCATE is DDL.
        await session.execute(
            text(
                "TRUNCATE TABLE project_members, projects, users, organizations "
                "RESTART IDENTITY CASCADE"
            )
        )
        await session.commit()


@pytest.fixture(autouse=True)
async def _flush_redis(redis_client: Redis) -> AsyncGenerator[None, None]:
    yield
    await redis_client.flushdb()


@pytest.fixture
async def session(
    session_maker: async_sessionmaker[AsyncSession],
) -> AsyncGenerator[AsyncSession, None]:
    async with session_maker() as s:
        yield s


@pytest.fixture
def email_transport() -> Generator[object, None, None]:
    from bimstitch_api.email.transport import (
        InMemoryEmailTransport,
        get_email_transport,
        set_email_transport,
    )

    previous = get_email_transport()
    transport = InMemoryEmailTransport()
    set_email_transport(transport)
    try:
        yield transport
    finally:
        set_email_transport(previous)


@pytest.fixture
async def client(
    engine: AsyncEngine,
    session_maker: async_sessionmaker[AsyncSession],
    redis_client: Redis,
) -> AsyncGenerator[AsyncClient, None]:
    from bimstitch_api import db as db_module
    from bimstitch_api.auth.refresh import REFRESH_RATE_LIMITER
    from bimstitch_api.auth.routes import (
        FORGOT_RATE_LIMITER,
        LOGIN_RATE_LIMITER,
        REGISTER_RATE_LIMITER,
    )
    from bimstitch_api.cache import client as cache_module
    from bimstitch_api.main import create_app

    db_module._engine = engine
    db_module._session_maker = session_maker
    cache_module._redis = redis_client

    app = create_app()
    # Disable rate limiting by default; tests covering rate limiting use `rate_limited_client`.
    for limiter in (
        LOGIN_RATE_LIMITER,
        REGISTER_RATE_LIMITER,
        FORGOT_RATE_LIMITER,
        REFRESH_RATE_LIMITER,
    ):
        app.dependency_overrides[limiter] = lambda: None

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


@pytest.fixture
async def rate_limited_client(
    engine: AsyncEngine,
    session_maker: async_sessionmaker[AsyncSession],
    redis_client: Redis,
) -> AsyncGenerator[AsyncClient, None]:
    """Same as `client` but with rate limiting active. Use for rate-limit tests."""
    from fastapi_limiter import FastAPILimiter

    from bimstitch_api import db as db_module
    from bimstitch_api.cache import client as cache_module
    from bimstitch_api.main import create_app

    db_module._engine = engine
    db_module._session_maker = session_maker
    cache_module._redis = redis_client

    await FastAPILimiter.init(redis_client)
    try:
        app = create_app()
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            yield ac
    finally:
        await FastAPILimiter.close()


# ---------------------------------------------------------------------------
# Tenant / project fixtures
# ---------------------------------------------------------------------------


async def _register_login(
    client: AsyncClient,
    email_transport: object,
    email: str,
    organization_name: str,
) -> dict[str, str]:
    import re

    register_resp = await client.post(
        "/auth/register",
        json={
            "email": email,
            "password": "correct-horse-battery",
            "full_name": email.split("@")[0],
            "organization_name": organization_name,
        },
    )
    assert register_resp.status_code in (200, 201), (
        f"register failed: {register_resp.status_code} {register_resp.text}"
    )
    sent = email_transport.last_for(email)  # type: ignore[attr-defined]
    assert sent is not None, (
        f"no verification email sent for {email}; "
        f"register={register_resp.status_code} {register_resp.text}"
    )
    match = re.search(r"Token:\s*(\S+)", sent.body)
    assert match is not None
    await client.post("/auth/verify", json={"token": match.group(1)})
    response = await client.post(
        "/auth/jwt/login",
        data={"username": email, "password": "correct-horse-battery"},
    )
    return response.json()


@pytest.fixture
async def org_user(
    client: AsyncClient,
    email_transport: object,
) -> dict[str, str]:
    """Verified user belonging to AlphaCo. Returns dict with access_token,
    refresh_token, email, and the user's id (resolved via /users/me)."""
    tokens = await _register_login(client, email_transport, "alice@example.com", "AlphaCo")
    me = await client.get(
        "/users/me", headers={"Authorization": f"Bearer {tokens['access_token']}"}
    )
    body = me.json()
    return {
        "access_token": tokens["access_token"],
        "refresh_token": tokens["refresh_token"],
        "email": body["email"],
        "id": body["id"],
        "organization_id": body["organization_id"],
    }


@pytest.fixture
async def other_org_user(
    client: AsyncClient,
    email_transport: object,
) -> dict[str, str]:
    """Verified user belonging to BetaCo (different org from `org_user`)."""
    tokens = await _register_login(client, email_transport, "bob@example.org", "BetaCo")
    me = await client.get(
        "/users/me", headers={"Authorization": f"Bearer {tokens['access_token']}"}
    )
    body = me.json()
    return {
        "access_token": tokens["access_token"],
        "refresh_token": tokens["refresh_token"],
        "email": body["email"],
        "id": body["id"],
        "organization_id": body["organization_id"],
    }


@pytest.fixture
async def same_org_user(
    client: AsyncClient,
    email_transport: object,
    org_user: dict[str, str],
) -> dict[str, str]:
    """A second verified user in the same org (AlphaCo) as `org_user`."""
    tokens = await _register_login(client, email_transport, "carol@example.com", "AlphaCo")
    me = await client.get(
        "/users/me", headers={"Authorization": f"Bearer {tokens['access_token']}"}
    )
    body = me.json()
    return {
        "access_token": tokens["access_token"],
        "refresh_token": tokens["refresh_token"],
        "email": body["email"],
        "id": body["id"],
        "organization_id": body["organization_id"],
    }
