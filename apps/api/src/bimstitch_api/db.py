from collections.abc import AsyncGenerator

from fastapi import Depends
from fastapi_users.db import SQLAlchemyUserDatabase
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.schema import Table

from bimstitch_api.config import get_settings

MASTER_SCHEMA = "public"


class Base(DeclarativeBase):
    """Single declarative base shared between master and tenant tables.

    Two reasons for sharing rather than splitting into two bases:
    - Cross-registry `relationship()` resolution doesn't work: a tenant
      table cannot easily refer to a master table (like User) by string
      or class when the two live in separate `MetaData` registries.
    - Alembic can still keep separate chains for master vs tenant by
      filtering on `Table.schema` in each env's `include_object` callback;
      see `alembic/master/env.py` and `alembic/tenant/env.py`.

    Convention:
    - Master tables (identity layer) set `__table_args__ = {"schema":
      "public"}` (or `(*existing, {"schema": "public"})` when other
      args are present).
    - Tenant tables leave `__table_args__` schema-less. At runtime
      `get_tenant_session` sets `search_path = "org_<hex>", public` so
      unqualified tenant tables resolve to the active org's schema.
    """


def is_master_table(table: Table) -> bool:
    """Master tables live in the `public` schema. Tenant tables have no schema
    set on their Table object — they get materialised into per-org schemas at
    runtime. Used by both Alembic envs to filter the metadata they manage.
    """
    return table.schema == MASTER_SCHEMA


def is_tenant_table(table: Table) -> bool:
    return table.schema is None


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
    superuser there).
    """
    global _admin_engine
    if _admin_engine is None:
        settings = get_settings()
        url = settings.admin_database_url or settings.database_url
        # AUTOCOMMIT so `CREATE SCHEMA` / `DROP SCHEMA` don't deadlock with
        # the synchronous Alembic command that follows in the saga.
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


# Back-compat exports: keep MasterBase/TenantBase as aliases so any code that
# already imported them keeps working. New code can use `Base` directly.
MasterBase = Base
TenantBase = Base
