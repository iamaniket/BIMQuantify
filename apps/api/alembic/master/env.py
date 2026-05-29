"""Alembic env for the MASTER chain.

Targets `public` schema. Manages identity-layer tables only: users,
organizations, organization_members, access_requests.

Tenant tables live in per-org schemas and are managed by the `tenant`
chain, run once per org schema by the provisioning saga.
"""

from __future__ import annotations

import asyncio
from logging.config import fileConfig
from typing import TYPE_CHECKING

from alembic import context
from sqlalchemy import pool
from sqlalchemy.ext.asyncio import async_engine_from_config

from bimstitch_api.config import get_settings
from bimstitch_api.db import Base, is_master_table
# Import ALL models so the shared Base.metadata is fully populated, then
# filter to the master-side subset via `include_object` below.
from bimstitch_api.models import (  # noqa: F401
    AccessRequest,
    AuditLog,
    Borgingsmoment,
    Borgingsplan,
    ChecklistItem,
    ChecklistItemResult,
    Contractor,
    Deadline,
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

if TYPE_CHECKING:
    from sqlalchemy.engine import Connection

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

settings = get_settings()
# Master runs with the elevated user (can CREATE ROLE for bim_app).
config.set_main_option(
    "sqlalchemy.url", settings.admin_database_url or settings.database_url
)

target_metadata = Base.metadata


def _include_object(obj, name, type_, reflected, compare_to):
    """Restrict the master chain to master-side tables (schema=='public')."""
    if type_ == "table":
        return is_master_table(obj)
    return True


def run_migrations_offline() -> None:
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
        include_schemas=True,
        include_object=_include_object,
    )

    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        compare_type=True,
        include_schemas=True,
        include_object=_include_object,
    )
    with context.begin_transaction():
        context.run_migrations()


async def run_migrations_online() -> None:
    connectable = async_engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)

    await connectable.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    asyncio.run(run_migrations_online())
