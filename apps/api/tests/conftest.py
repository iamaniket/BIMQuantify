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
    from bimstitch_api.db import Base
    from bimstitch_api.models import Organization, User  # noqa: F401

    eng = create_async_engine(_TEST_DB_URL, future=True)

    async with eng.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)

    yield eng

    async with eng.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
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
        await session.execute(text("DELETE FROM users"))
        await session.execute(text("DELETE FROM organizations"))
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
