from __future__ import annotations

import os
from typing import TYPE_CHECKING

import pytest
from httpx import ASGITransport, AsyncClient
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
    "postgresql+asyncpg://bim:bim@localhost:5434/bimquantify_test",
)
os.environ["DATABASE_URL"] = _TEST_DB_URL
os.environ.setdefault("JWT_SECRET", "test-secret")
os.environ.setdefault("SMTP_HOST", "localhost")
os.environ.setdefault("SMTP_PORT", "1025")


@pytest.fixture(scope="session")
async def engine() -> AsyncGenerator[AsyncEngine, None]:
    # Imported here so env vars above take effect first.
    from bimquantify_api.db import Base
    from bimquantify_api.models import Organization, User  # noqa: F401

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


@pytest.fixture(autouse=True)
async def _clean_tables(
    session_maker: async_sessionmaker[AsyncSession],
) -> AsyncGenerator[None, None]:
    yield
    async with session_maker() as session:
        await session.execute(text("DELETE FROM users"))
        await session.execute(text("DELETE FROM organizations"))
        await session.commit()


@pytest.fixture
async def session(
    session_maker: async_sessionmaker[AsyncSession],
) -> AsyncGenerator[AsyncSession, None]:
    async with session_maker() as s:
        yield s


@pytest.fixture
def email_transport() -> Generator[object, None, None]:
    from bimquantify_api.email.transport import (
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
) -> AsyncGenerator[AsyncClient, None]:
    from bimquantify_api import db as db_module
    from bimquantify_api.main import create_app

    # Ensure the app uses the same engine / session maker as the tests.
    db_module._engine = engine
    db_module._session_maker = session_maker

    app = create_app()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
