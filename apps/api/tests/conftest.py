from __future__ import annotations

import os
from typing import TYPE_CHECKING

import pytest
from httpx import ASGITransport, AsyncClient
from redis.asyncio import Redis, from_url
from sqlalchemy import bindparam, text
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

# Pin the processor shared secret to the value hardcoded in the internal-callback
# tests (test_jobs.py, test_project_files.py, test_project_files_extraction.py,
# test_reports_endpoint.py all send `Bearer dev-shared-secret-change-me`).
# Without this, a developer `.env` that sets PROCESSOR_SHARED_SECRET to anything
# else causes all internal callback tests to 401. Env vars win over `.env` in
# pydantic-settings, so this is enough to make the suite reproducible.
os.environ["PROCESSOR_SHARED_SECRET"] = "dev-shared-secret-change-me"


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
        AccessRequest,
        AuditLog,
        Borgingsmoment,
        Borgingsplan,
        ChecklistItem,
        ChecklistItemResult,
        Contractor,
        Job,
        Model,
        Notification,
        NotificationRead,
        Organization,
        OrganizationMember,
        Project,
        ProjectFile,
        ProjectMember,
        Report,
        Risk,
        User,
    )

    # NullPool ensures every checkout opens a fresh asyncpg connection, so
    # the prepared-statement cache that asyncpg keeps per connection cannot
    # outlive a DROP SCHEMA between tests. Sharing a pooled connection
    # across tests would otherwise hit `InvalidCachedStatementError` once
    # a previous test's schema/enums are gone.
    from sqlalchemy.pool import NullPool

    eng = create_async_engine(_TEST_DB_URL, future=True, poolclass=NullPool)

    async with eng.begin() as conn:
        # Drop any per-tenant schemas left behind by a previous aborted test
        # run BEFORE dropping public tables — their FKs reference public.users
        # / public.organizations, so dropping the master tables first would
        # fail with a dependent-objects error.
        rows = await conn.exec_driver_sql(
            "SELECT schema_name FROM information_schema.schemata "
            "WHERE schema_name LIKE 'org_%'"
        )
        for (schema,) in rows.fetchall():
            await conn.exec_driver_sql(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE')
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
        await conn.exec_driver_sql("DROP TYPE IF EXISTS filetype")
        await conn.exec_driver_sql("DROP TYPE IF EXISTS modelstatus")
        await conn.exec_driver_sql("DROP TYPE IF EXISTS modeldiscipline")
        await conn.exec_driver_sql("DROP TYPE IF EXISTS projectstatus")
        await conn.exec_driver_sql("DROP TYPE IF EXISTS projectphase")
        await conn.exec_driver_sql("DROP TYPE IF EXISTS projectlifecyclestate")
        await conn.exec_driver_sql("DROP TYPE IF EXISTS jobtype")
        await conn.exec_driver_sql("DROP TYPE IF EXISTS jobstatus")
        await conn.exec_driver_sql("DROP TYPE IF EXISTS reporttype")
        await conn.exec_driver_sql("DROP TYPE IF EXISTS reportstatus")
        await conn.exec_driver_sql("DROP TYPE IF EXISTS accessrequeststatus")
        await conn.exec_driver_sql("DROP TYPE IF EXISTS riskcategory")
        await conn.exec_driver_sql("DROP TYPE IF EXISTS risklevel")
        await conn.exec_driver_sql("DROP TYPE IF EXISTS evidencetype")
        await conn.exec_driver_sql("DROP TYPE IF EXISTS checklistitemtype")
        await conn.exec_driver_sql("DROP TYPE IF EXISTS borgingsmomentstatus")
        await conn.exec_driver_sql("DROP TYPE IF EXISTS borgingsmomentphase")
        await conn.exec_driver_sql("DROP TYPE IF EXISTS borgingsplanstatus")
        await conn.exec_driver_sql("DROP TYPE IF EXISTS organizationmemberstatus")
        await conn.exec_driver_sql("DROP TYPE IF EXISTS organizationstatus")
        await conn.exec_driver_sql("DROP TYPE IF EXISTS notificationeventtype")
        await conn.exec_driver_sql("DROP TYPE IF EXISTS inspectionverdict")
        await conn.run_sync(Base.metadata.create_all)
        # Partial unique index for "one active borgingsplan per project" — not
        # expressible in __table_args__, so mirror the migration here.
        await conn.exec_driver_sql(
            "CREATE UNIQUE INDEX ux_borgingsplans_one_active "
            "ON borgingsplans(project_id) "
            "WHERE status IN ('draft', 'published')"
        )
        for stmt in create_app_role_statements():
            await conn.exec_driver_sql(stmt)
        # The production saga runs tenant migrations against per-org schemas
        # and grants bim_app DML on those tables. Tests instead put EVERY
        # table (master + tenant) in the `public` schema, so we widen the
        # bim_app grants to cover the tenant tables too. Without this, any
        # tenant-session query (which runs as bim_app) hits permission denied.
        await conn.exec_driver_sql(
            "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO bim_app"
        )
        await conn.exec_driver_sql(
            "GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO bim_app"
        )
        for stmt in enable_rls_statements():
            await conn.exec_driver_sql(stmt)

    yield eng

    async with eng.begin() as conn:
        rows = await conn.exec_driver_sql(
            "SELECT schema_name FROM information_schema.schemata "
            "WHERE schema_name LIKE 'org_%'"
        )
        for (schema,) in rows.fetchall():
            await conn.exec_driver_sql(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE')
        for stmt in disable_rls_statements():
            await conn.exec_driver_sql(
                f"DO $$ BEGIN {stmt} EXCEPTION WHEN others THEN NULL; END $$;"
            )
        await conn.run_sync(Base.metadata.drop_all)
        await conn.exec_driver_sql("DROP TYPE IF EXISTS projectrole")
        await conn.exec_driver_sql("DROP TYPE IF EXISTS projectfilestatus")
        await conn.exec_driver_sql("DROP TYPE IF EXISTS extractionstatus")
        await conn.exec_driver_sql("DROP TYPE IF EXISTS ifcschema")
        await conn.exec_driver_sql("DROP TYPE IF EXISTS filetype")
        await conn.exec_driver_sql("DROP TYPE IF EXISTS modelstatus")
        await conn.exec_driver_sql("DROP TYPE IF EXISTS modeldiscipline")
        await conn.exec_driver_sql("DROP TYPE IF EXISTS projectstatus")
        await conn.exec_driver_sql("DROP TYPE IF EXISTS projectphase")
        await conn.exec_driver_sql("DROP TYPE IF EXISTS projectlifecyclestate")
        await conn.exec_driver_sql("DROP TYPE IF EXISTS jobtype")
        await conn.exec_driver_sql("DROP TYPE IF EXISTS jobstatus")
        await conn.exec_driver_sql("DROP TYPE IF EXISTS reporttype")
        await conn.exec_driver_sql("DROP TYPE IF EXISTS reportstatus")
        await conn.exec_driver_sql("DROP TYPE IF EXISTS accessrequeststatus")
        await conn.exec_driver_sql("DROP TYPE IF EXISTS riskcategory")
        await conn.exec_driver_sql("DROP TYPE IF EXISTS risklevel")
        await conn.exec_driver_sql("DROP TYPE IF EXISTS evidencetype")
        await conn.exec_driver_sql("DROP TYPE IF EXISTS checklistitemtype")
        await conn.exec_driver_sql("DROP TYPE IF EXISTS borgingsmomentstatus")
        await conn.exec_driver_sql("DROP TYPE IF EXISTS borgingsmomentphase")
        await conn.exec_driver_sql("DROP TYPE IF EXISTS borgingsplanstatus")
        await conn.exec_driver_sql("DROP TYPE IF EXISTS organizationmemberstatus")
        await conn.exec_driver_sql("DROP TYPE IF EXISTS organizationstatus")
        await conn.exec_driver_sql("DROP TYPE IF EXISTS notificationeventtype")
        await conn.exec_driver_sql("DROP TYPE IF EXISTS inspectionverdict")
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
    request: pytest.FixtureRequest,
    session_maker: async_sessionmaker[AsyncSession],
) -> AsyncGenerator[None, None]:
    """Truncate all tables after each DB test.

    Skips when the test has no DB fixtures (no ``client``, ``org_user``,
    ``session``, ``fake_storage_client``, ``rate_limited_client``).  Pure
    logic tests (permissions, approx, ifc_header, …) never touch the DB so
    the TRUNCATE is wasted work — and the 0.35s per-test overhead adds up
    to minutes across hundreds of parametrized cases.

    Also retries once on deadlock (``40P01``) to handle the rare case where
    a lingering connection from the test body hasn't been fully released
    when teardown starts.
    """
    yield

    # Skip cleanup for tests that never touched the DB.
    _db_fixture_names = {
        "client", "org_user", "other_org_user", "same_org_user",
        "same_org_non_admin_user", "same_org_admin_user", "superuser_in_org",
        "session", "fake_storage_client", "rate_limited_client",
    }
    if not _db_fixture_names.intersection(request.fixturenames):
        return

    import asyncio

    for attempt in range(2):
        try:
            async with session_maker() as session:
                # Drop per-tenant schemas created during the test before
                # truncating the master tables.
                rows = (
                    await session.execute(
                        text(
                            "SELECT schema_name FROM information_schema.schemata "
                            "WHERE schema_name LIKE 'org_%'"
                        )
                    )
                ).all()
                for (schema,) in rows:
                    await session.execute(
                        text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE')
                    )

                await session.execute(
                    text(
                        "TRUNCATE TABLE checklist_item_results, checklist_items, "
                        "borgingsmomenten, borgingsplans, "
                        "risks, access_requests, reports, jobs, project_files, models, "
                        "project_members, projects, contractors, notification_reads, "
                        "notifications, audit_log, organization_members, users, "
                        "organizations RESTART IDENTITY CASCADE"
                    )
                )
                await session.commit()
            return  # success
        except Exception as exc:
            # Retry once on deadlock (Postgres SQLSTATE 40P01).
            if attempt == 0 and "deadlock" in str(exc).lower():
                await asyncio.sleep(0.5)
                continue
            raise


@pytest.fixture(autouse=True)
async def _flush_redis(
    request: pytest.FixtureRequest,
    redis_client: Redis,
) -> AsyncGenerator[None, None]:
    yield
    # Skip for pure-logic tests that never touch Redis.
    _db_fixture_names = {
        "client", "org_user", "other_org_user", "same_org_user",
        "same_org_non_admin_user", "same_org_admin_user", "superuser_in_org",
        "session", "fake_storage_client", "rate_limited_client",
    }
    if not _db_fixture_names.intersection(request.fixturenames):
        return
    await redis_client.flushdb()


@pytest.fixture(autouse=True)
def _stub_job_dispatcher() -> Generator[list[dict[str, object]], None, None]:
    """Default: no-op job dispatcher that records calls.

    Tests that need to assert dispatch was called can pull this fixture in by
    name (`job_dispatch_calls`) — it's the same list. The recorded shape
    mirrors the new generic Job dispatcher: each entry is
    `{"job_id": ..., "job_type": ..., "payload": ...}`. For callers that
    still use the old `extraction_calls` field-flattened shape, a few
    convenience keys (file_id, project_id, storage_key) are also copied up.
    """
    from bimstitch_api.config import Settings
    from bimstitch_api.jobs import reset_job_dispatcher, set_job_dispatcher
    from bimstitch_api.models.job import Job

    calls: list[dict[str, object]] = []

    async def _record(job: Job, _settings: Settings, organization_id) -> None:
        payload = dict(job.payload or {})
        entry: dict[str, object] = {
            "job_id": str(job.id),
            "job_type": job.job_type.value,
            "organization_id": str(organization_id),
            "payload": payload,
        }
        # Convenience flat keys for tests that read e.g. calls[0]["file_id"].
        for k in ("file_id", "project_id", "storage_key"):
            if k in payload:
                entry[k] = payload[k]
        calls.append(entry)

    set_job_dispatcher(_record)
    try:
        yield calls
    finally:
        reset_job_dispatcher()


@pytest.fixture
def job_dispatch_calls(
    _stub_job_dispatcher: list[dict[str, object]],
) -> list[dict[str, object]]:
    """Alias so test signatures read naturally."""
    return _stub_job_dispatcher


# Back-compat alias — many older tests reference `extraction_calls`. Prefer
# `job_dispatch_calls` in new code.
@pytest.fixture
def extraction_calls(
    _stub_job_dispatcher: list[dict[str, object]],
) -> list[dict[str, object]]:
    return _stub_job_dispatcher


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
    from bimstitch_api.routers.access_requests import ACCESS_REQUEST_RATE_LIMITER
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
        ACCESS_REQUEST_RATE_LIMITER,
    ):
        app.dependency_overrides[limiter] = lambda: None

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac, fake


def _new_hash() -> str:
    """Generate a unique 64-char lowercase hex SHA-256 string for tests
    that don't care about the actual hash value but need something that
    passes the InitiateUploadRequest validator."""
    import secrets

    return secrets.token_hex(32)


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
    from bimstitch_api.routers.access_requests import ACCESS_REQUEST_RATE_LIMITER

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
        ACCESS_REQUEST_RATE_LIMITER,
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


_TEST_PASSWORD = "correct-horse-battery"


async def make_test_user(
    session_maker: async_sessionmaker[AsyncSession],
    *,
    email: str,
    password: str = _TEST_PASSWORD,
    full_name: str | None = None,
    is_verified: bool = True,
    is_superuser: bool = False,
) -> str:
    """Insert a user directly into the master DB without going through the
    saga or the (removed) `/auth/register` route. Returns the user id (str).
    Tests that need to log in as a verified user can pair this with a
    `POST /auth/jwt/login` using the same password.
    """
    from fastapi_users.password import PasswordHelper

    from bimstitch_api.models.user import User

    async with session_maker() as session:
        user = User(
            email=email,
            hashed_password=PasswordHelper().hash(password),
            full_name=full_name or email.split("@")[0],
            is_active=True,
            is_verified=is_verified,
            is_superuser=is_superuser,
        )
        session.add(user)
        await session.commit()
        return str(user.id)


_TENANT_DDL_PLACEHOLDER = "__TENANT_SCHEMA__"
_cached_tenant_ddl: list[str] | None = None


def _capture_tenant_ddl() -> list[str]:
    """Compile the tenant-tables DDL once with a placeholder schema, then
    let callers string-replace into a real schema name. Schema creation
    via `Base.metadata.create_all` is slow because SQLAlchemy walks the
    metadata, sorts dependencies, and compiles DDL for ~24 tables. Doing
    that per test would push the suite well over an hour; caching the
    compiled text drops it to milliseconds per schema.
    """
    global _cached_tenant_ddl
    if _cached_tenant_ddl is not None:
        return _cached_tenant_ddl

    from sqlalchemy import create_mock_engine
    from sqlalchemy.dialects import postgresql

    from bimstitch_api.db import Base, is_tenant_table

    tenant_tables = [t for t in Base.metadata.tables.values() if is_tenant_table(t)]
    # Temporarily stamp every tenant table with the placeholder schema so
    # SQLAlchemy emits schema-qualified DDL. `create_mock_engine` does not
    # honour `schema_translate_map`, so we mutate the metadata directly,
    # compile, then restore.
    original_schemas = {t: t.schema for t in tenant_tables}
    for t in tenant_tables:
        t.schema = _TENANT_DDL_PLACEHOLDER

    statements: list[str] = []

    def _dump(sql, *_args, **_kw):  # noqa: ANN001
        compiled = sql.compile(dialect=postgresql.dialect())
        statements.append(str(compiled).strip())

    try:
        mock_engine = create_mock_engine("postgresql://", _dump)
        Base.metadata.create_all(mock_engine, tables=tenant_tables)
    finally:
        for t, original in original_schemas.items():
            t.schema = original

    # Skip `CREATE TYPE` statements: the enums already live in public from
    # the master `create_all` run, and the per-test schema falls through to
    # public via search_path. Trying to re-create them per schema raises
    # DuplicateObjectError. Keeping them in public is also the only thing
    # that prevents the cross-schema enum-cast bug.
    _cached_tenant_ddl = [
        s for s in statements if not s.upper().startswith("CREATE TYPE")
    ]
    return _cached_tenant_ddl


async def _provision_tenant_schema(
    engine: AsyncEngine, schema: str
) -> None:
    """Materialise a real per-tenant Postgres schema for a test org.

    Replays the cached tenant DDL (compiled once at session start with a
    placeholder schema) into the target schema. FKs between tenant tables
    emit as `REFERENCES "<schema>"."<other>"`; FKs at master tables (users,
    organizations) keep their explicit `public.` qualifier so the identity
    layer stays shared. Without real per-tenant schemas, cross-org
    isolation tests can't be proven — both orgs would share `public`.
    """
    ddl = _capture_tenant_ddl()
    # Drive each DDL statement separately — asyncpg's extended protocol
    # rejects multi-statement strings ("cannot insert multiple commands
    # into a prepared statement"). All statements run inside a single
    # transaction so the round-trip per statement is minimal.
    async with engine.begin() as conn:
        await conn.exec_driver_sql(f'CREATE SCHEMA IF NOT EXISTS "{schema}"')
        for stmt in ddl:
            await conn.exec_driver_sql(stmt.replace(_TENANT_DDL_PLACEHOLDER, schema))
        # Drop master-only enums that schema_translate_map duplicated into
        # this schema — without this, a tenant-session query against
        # `public.organization_members WHERE status = $1` casts the
        # parameter to the org-schema duplicate enum and Postgres rejects
        # the cross-type compare.
        for master_enum in (
            "accessrequeststatus",
            "organizationmemberstatus",
            "organizationstatus",
        ):
            await conn.exec_driver_sql(
                f'DROP TYPE IF EXISTS "{schema}".{master_enum} CASCADE'
            )
        # Partial unique index the metadata can't express via __table_args__.
        await conn.exec_driver_sql(
            f'CREATE UNIQUE INDEX IF NOT EXISTS ux_borgingsplans_one_active '
            f'ON "{schema}".borgingsplans(project_id) '
            f"WHERE status IN ('draft', 'published')"
        )
        # Grants for bim_app on everything in the new schema.
        await conn.exec_driver_sql(
            f'GRANT USAGE, CREATE ON SCHEMA "{schema}" TO bim_app'
        )
        await conn.exec_driver_sql(
            f'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES '
            f'IN SCHEMA "{schema}" TO bim_app'
        )
        await conn.exec_driver_sql(
            f'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA "{schema}" TO bim_app'
        )


async def _provision_user_in_org(
    client: AsyncClient,
    session_maker: async_sessionmaker[AsyncSession],
    engine: AsyncEngine,
    *,
    email: str,
    organization_id: object | None = None,
    organization_name: str | None = None,
    is_org_admin: bool = True,
    is_superuser: bool = False,
) -> dict[str, str]:
    """Create a verified user + active membership directly in the DB, then
    log them in to get tokens.

    The public `/auth/register` route was removed in favour of the admin
    invite flow. Tests still need quickly-provisioned users with an active
    org context, so this helper bypasses the full saga: insert the user,
    insert (or reuse) the org with a real per-tenant schema (created by
    `_provision_tenant_schema`), attach an active OrganizationMember row,
    then hit `/auth/jwt/login`.
    """
    from datetime import datetime, timezone
    from uuid import uuid4

    from fastapi_users.password import PasswordHelper
    from sqlalchemy import select

    from bimstitch_api.models.organization import Organization, OrganizationStatus
    from bimstitch_api.models.organization_member import (
        OrganizationMember,
        OrganizationMemberStatus,
    )
    from bimstitch_api.models.user import User
    from bimstitch_api.tenancy import schema_name_for

    schema_to_create: str | None = None
    async with session_maker() as session:
        # Resolve / create the org row.
        org: Organization | None = None
        if organization_id is not None:
            org = await session.get(Organization, organization_id)
        elif organization_name is not None:
            org = (
                await session.execute(
                    select(Organization).where(Organization.name == organization_name)
                )
            ).scalar_one_or_none()
        if org is None:
            new_org_id = organization_id or uuid4()
            schema_to_create = schema_name_for(new_org_id)
            org = Organization(
                id=new_org_id,
                name=organization_name or f"Org-{str(new_org_id)[:8]}",
                schema_name=schema_to_create,
                status=OrganizationStatus.active,
                provisioned_at=datetime.now(timezone.utc),
            )
            session.add(org)
            await session.flush()

        user = User(
            email=email,
            hashed_password=PasswordHelper().hash(_TEST_PASSWORD),
            full_name=email.split("@")[0],
            is_active=True,
            is_verified=True,
            is_superuser=is_superuser,
            active_organization_id=org.id,
        )
        session.add(user)
        await session.flush()

        session.add(
            OrganizationMember(
                user_id=user.id,
                organization_id=org.id,
                is_org_admin=is_org_admin,
                status=OrganizationMemberStatus.active,
                accepted_at=datetime.now(timezone.utc),
            )
        )
        await session.commit()

        user_id = str(user.id)
        org_id = str(org.id)

    # Provision the tenant schema OUTSIDE the master txn so the CREATE SCHEMA
    # statement commits cleanly.
    if schema_to_create is not None:
        await _provision_tenant_schema(engine, schema_to_create)

    response = await client.post(
        "/auth/jwt/login",
        data={"username": email, "password": _TEST_PASSWORD},
    )
    assert response.status_code == 200, (
        f"login failed for {email}: {response.status_code} {response.text}"
    )
    tokens = response.json()
    return {
        "access_token": tokens["access_token"],
        "refresh_token": tokens["refresh_token"],
        "email": email,
        "id": user_id,
        "organization_id": org_id,
    }


@pytest.fixture
async def org_user(
    client: AsyncClient,
    session_maker: async_sessionmaker[AsyncSession],
    engine: AsyncEngine,
) -> dict[str, str]:
    """Verified user belonging to AlphaCo, with an active org membership."""
    return await _provision_user_in_org(
        client,
        session_maker,
        engine,
        email="alice@example.com",
        organization_name="AlphaCo",
    )


@pytest.fixture
async def other_org_user(
    client: AsyncClient,
    session_maker: async_sessionmaker[AsyncSession],
    engine: AsyncEngine,
) -> dict[str, str]:
    """Verified user belonging to BetaCo (different org from `org_user`)."""
    return await _provision_user_in_org(
        client,
        session_maker,
        engine,
        email="bob@example.org",
        organization_name="BetaCo",
    )


@pytest.fixture
async def same_org_user(
    client: AsyncClient,
    session_maker: async_sessionmaker[AsyncSession],
    engine: AsyncEngine,
    org_user: dict[str, str],
) -> dict[str, str]:
    """A second verified user in the same org (AlphaCo) as `org_user`."""
    return await _provision_user_in_org(
        client,
        session_maker,
        engine,
        email="carol@example.com",
        organization_id=org_user["organization_id"],
    )


@pytest.fixture
async def same_org_non_admin_user(
    client: AsyncClient,
    session_maker: async_sessionmaker[AsyncSession],
    engine: AsyncEngine,
    org_user: dict[str, str],
) -> dict[str, str]:
    """A non-admin verified user in the same org as `org_user`. Used by tests
    that exercise the "regular member can't manage project access" path —
    `same_org_user` itself is provisioned as an org admin (the default for the
    helper) so it would silently pass any org-admin gate."""
    return await _provision_user_in_org(
        client,
        session_maker,
        engine,
        email="dave@example.com",
        organization_id=org_user["organization_id"],
        is_org_admin=False,
    )


@pytest.fixture
async def same_org_admin_user(
    client: AsyncClient,
    session_maker: async_sessionmaker[AsyncSession],
    engine: AsyncEngine,
    org_user: dict[str, str],
) -> dict[str, str]:
    """A second org-admin in the same org. Used by tests that exercise the
    "org admin can manage projects they don't own" path."""
    return await _provision_user_in_org(
        client,
        session_maker,
        engine,
        email="erin@example.com",
        organization_id=org_user["organization_id"],
        is_org_admin=True,
    )


@pytest.fixture
async def superuser_in_org(
    client: AsyncClient,
    session_maker: async_sessionmaker[AsyncSession],
    engine: AsyncEngine,
    org_user: dict[str, str],
) -> dict[str, str]:
    """A platform superuser who is also a member of AlphaCo (same org as
    ``org_user``).  Used by tests that verify superuser project-level access
    within their own org — without impersonation."""
    return await _provision_user_in_org(
        client,
        session_maker,
        engine,
        email="super@example.com",
        organization_id=org_user["organization_id"],
        is_org_admin=True,
        is_superuser=True,
    )
