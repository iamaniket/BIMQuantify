from collections.abc import AsyncGenerator

from fastapi import Depends
from fastapi_users.db import SQLAlchemyUserDatabase
from sqlalchemy import MetaData
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase

from bimstitch_api.config import get_settings


class MasterBase(DeclarativeBase):
    """Declarative base for identity/master tables that always live in the
    `public` schema.

    Members: User, Organization, OrganizationMember, AccessRequest, AuditLog.
    """

    metadata = MetaData(schema="public")


class TenantBase(DeclarativeBase):
    """Declarative base for tenant-scoped tables.

    These tables exist in every per-org schema (`org_<uuid_hex>`). The base
    intentionally has NO `schema` on its metadata: at runtime the tables are
    resolved through Postgres `search_path` set by `get_tenant_session`.

    Members: Project, ProjectMember, Model, ProjectFile, Job, Report,
    Contractor, Notification, NotificationRead, Risk, Borgingsplan,
    Borgingsmoment, ChecklistItem.
    """

    metadata = MetaData()


_engine: AsyncEngine | None = None
_session_maker: async_sessionmaker[AsyncSession] | None = None
_admin_engine: AsyncEngine | None = None


def get_engine() -> AsyncEngine:
    """The default app engine. Connects as the deploy user (which may be a
    superuser in dev). Per-request code drops to the `bim_app` role inside
    `get_tenant_session`."""
    global _engine, _session_maker
    if _engine is None:
        settings = get_settings()
        _engine = create_async_engine(settings.database_url, future=True)
        _session_maker = async_sessionmaker(_engine, expire_on_commit=False)
    return _engine


def get_session_maker() -> async_sessionmaker[AsyncSession]:
    if _session_maker is None:
        get_engine()
    assert _session_maker is not None
    return _session_maker


def get_admin_engine() -> AsyncEngine:
    """Elevated engine used only for `CREATE SCHEMA` / `DROP SCHEMA` and
    per-tenant Alembic runs. Falls back to the regular `database_url` when
    `admin_database_url` is unset (dev convenience — `bim` is already a
    superuser there)."""
    global _admin_engine
    if _admin_engine is None:
        settings = get_settings()
        url = settings.admin_database_url or settings.database_url
        # `isolation_level='AUTOCOMMIT'` is required because CREATE SCHEMA /
        # DROP SCHEMA must not run inside a transaction block when also
        # invoking `command.upgrade(...)` against the new schema in the same
        # connection.
        _admin_engine = create_async_engine(url, future=True, isolation_level="AUTOCOMMIT")
    return _admin_engine


async def get_async_session() -> AsyncGenerator[AsyncSession, None]:
    """Master session — `public` schema only. Used by:
    - FastAPI Users built-in routers (which talk to `users` directly).
    - Super-admin endpoints under `/admin/*`.
    - The processor callback at `/internal/jobs/callback` (which sets its own
      search_path based on the callback's `organization_id`).

    For tenant-scoped requests use `get_tenant_session` from `tenancy.py`
    instead — it sets `search_path` and the RLS GUCs.
    """
    async with get_session_maker()() as session:
        yield session


async def get_user_db(
    session: AsyncSession = Depends(get_async_session),
) -> AsyncGenerator[SQLAlchemyUserDatabase, None]:
    from bimstitch_api.models.user import User

    yield SQLAlchemyUserDatabase(session, User)
