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
    from bimstitch_api.models import (  # noqa: F401
        Model,
        Organization,
        Project,
        ProjectFile,
        ProjectMember,
        User,
    )

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
        await conn.exec_driver_sql("DROP TYPE IF EXISTS projectfilestatus")
        await conn.exec_driver_sql("DROP TYPE IF EXISTS extractionstatus")
        await conn.exec_driver_sql("DROP TYPE IF EXISTS ifcschema")
        await conn.exec_driver_sql("DROP TYPE IF EXISTS modelstatus")
        await conn.exec_driver_sql("DROP TYPE IF EXISTS modeldiscipline")
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
        await conn.exec_driver_sql("DROP TYPE IF EXISTS projectfilestatus")
        await conn.exec_driver_sql("DROP TYPE IF EXISTS extractionstatus")
        await conn.exec_driver_sql("DROP TYPE IF EXISTS ifcschema")
        await conn.exec_driver_sql("DROP TYPE IF EXISTS modelstatus")
        await conn.exec_driver_sql("DROP TYPE IF EXISTS modeldiscipline")
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
                "TRUNCATE TABLE project_files, models, project_members, projects, "
                "users, organizations RESTART IDENTITY CASCADE"
            )
        )
        await session.commit()


@pytest.fixture(autouse=True)
async def _flush_redis(redis_client: Redis) -> AsyncGenerator[None, None]:
    yield
    await redis_client.flushdb()


@pytest.fixture(autouse=True)
def _stub_extraction_dispatcher() -> Generator[list[dict[str, str]], None, None]:
    """Default: no-op extractor dispatcher that records calls.

    Tests that need to assert extractor dispatch was called can pull this
    fixture in by name (`extraction_calls`) — it's the same list. Tests that
    want to simulate dispatch failure use `extraction_dispatch_failure`.
    """
    from uuid import UUID

    from bimstitch_api.config import Settings
    from bimstitch_api.extraction import (
        reset_extraction_dispatcher,
        set_extraction_dispatcher,
    )

    calls: list[dict[str, str]] = []

    async def _record(
        file_id: UUID, project_id: UUID, storage_key: str, settings: Settings
    ) -> None:
        calls.append(
            {
                "file_id": str(file_id),
                "project_id": str(project_id),
                "storage_key": storage_key,
            }
        )

    set_extraction_dispatcher(_record)
    try:
        yield calls
    finally:
        reset_extraction_dispatcher()


@pytest.fixture
def extraction_calls(
    _stub_extraction_dispatcher: list[dict[str, str]],
) -> list[dict[str, str]]:
    """Alias so test signatures read naturally."""
    return _stub_extraction_dispatcher


@pytest.fixture
async def session(
    session_maker: async_sessionmaker[AsyncSession],
) -> AsyncGenerator[AsyncSession, None]:
    async with session_maker() as s:
        yield s


# ---------------------------------------------------------------------------
# Shared project-files fixtures (used by both test_project_files and
# test_project_files_extraction).
# ---------------------------------------------------------------------------


VALID_IFC_HEADER = (
    b"ISO-10303-21;\nHEADER;\n"
    b"FILE_DESCRIPTION(('ViewDefinition'),'2;1');\n"
    b"FILE_NAME('m.ifc','2026-01-01T00:00:00','','','','','');\n"
    b"FILE_SCHEMA(('IFC4'));\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n"
)


class FakeStorage:
    """In-memory stand-in for S3Storage. Records calls and stores bytes."""

    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}
        self.deleted: list[str] = []
        self.presign_ttl_value: int = 900
        self.last_put_url: str | None = None

    @property
    def presign_ttl(self) -> int:
        return self.presign_ttl_value

    async def presigned_put_url(self, key: str, content_type: str, content_length: int) -> str:
        self.last_put_url = f"http://fake-storage/{key}?put"
        return self.last_put_url

    async def presigned_get_url(self, key: str, filename: str) -> str:
        return f"http://fake-storage/{key}?download={filename}"

    async def put_object(self, key: str, content_type: str, data: bytes) -> None:
        self.objects[key] = data

    async def head_object(self, key: str) -> dict[str, object]:
        from bimstitch_api.storage.minio import ObjectNotFoundError

        if key not in self.objects:
            raise ObjectNotFoundError(key)
        return {"ContentLength": len(self.objects[key])}

    async def get_object_range(self, key: str, start: int, end: int) -> bytes:
        return self.objects[key][start : end + 1]

    async def delete_object(self, key: str) -> None:
        if key in self.objects:
            del self.objects[key]
        self.deleted.append(key)

    async def ensure_bucket(self) -> None:
        return


@pytest.fixture
async def fake_storage_client(
    engine: AsyncEngine,
    session_maker: async_sessionmaker[AsyncSession],
    redis_client: Redis,
) -> AsyncGenerator[tuple[AsyncClient, FakeStorage], None]:
    """Like the `client` fixture but with `get_storage` overridden to FakeStorage.

    Returns the (client, fake_storage) tuple so tests can assert on storage calls."""
    from bimstitch_api import db as db_module
    from bimstitch_api.auth.refresh import REFRESH_RATE_LIMITER
    from bimstitch_api.auth.routes import (
        FORGOT_RATE_LIMITER,
        LOGIN_RATE_LIMITER,
        REGISTER_RATE_LIMITER,
    )
    from bimstitch_api.cache import client as cache_module
    from bimstitch_api.main import create_app
    from bimstitch_api.storage import get_storage

    db_module._engine = engine
    db_module._session_maker = session_maker
    cache_module._redis = redis_client

    app = create_app()
    fake = FakeStorage()
    app.dependency_overrides[get_storage] = lambda: fake
    for limiter in (
        LOGIN_RATE_LIMITER,
        REGISTER_RATE_LIMITER,
        FORGOT_RATE_LIMITER,
        REFRESH_RATE_LIMITER,
    ):
        app.dependency_overrides[limiter] = lambda: None

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac, fake


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _create_project(client: AsyncClient, token: str, name: str = "P1") -> dict:
    resp = await client.post("/projects", json={"name": name}, headers=_auth(token))
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _create_model(
    client: AsyncClient,
    token: str,
    project_id: str,
    name: str = "M1",
    discipline: str = "architectural",
    status: str | None = None,
) -> dict:
    body: dict[str, object] = {"name": name, "discipline": discipline}
    if status is not None:
        body["status"] = status
    resp = await client.post(f"/projects/{project_id}/models", json=body, headers=_auth(token))
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _add_member(
    client: AsyncClient,
    owner_token: str,
    project_id: str,
    user_id: str,
    role: str,
) -> None:
    resp = await client.post(
        f"/projects/{project_id}/members",
        json={"user_id": user_id, "role": role},
        headers=_auth(owner_token),
    )
    assert resp.status_code == 201, resp.text


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
