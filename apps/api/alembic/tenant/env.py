"""Alembic env for the TENANT chain.

Runs once per tenant schema. The target schema is supplied via the env var
`BIMSTITCH_TENANT_SCHEMA` (e.g. `org_a1b2c3...`). The schema must already
exist — the provisioning saga creates it before invoking this chain.

Each tenant schema has its own `alembic_version` table so we can track
state independently across orgs (e.g. one org pinned to an older head
during a phased rollout).
"""

from __future__ import annotations

import asyncio
import os
from logging.config import fileConfig
from typing import TYPE_CHECKING

from alembic import context
from sqlalchemy import pool, text
from sqlalchemy.ext.asyncio import async_engine_from_config

from bimstitch_api.config import get_settings
from bimstitch_api.db import Base, is_tenant_table
# Import ALL models so the shared Base.metadata is populated; the
# `_include_object` filter below restricts the chain to tenant-side tables.
from bimstitch_api.models import (  # noqa: F401
    AccessRequest,
    AuditLog,
    Borgingsmoment,
    Borgingsplan,
    ChecklistItem,
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

if TYPE_CHECKING:
    from sqlalchemy.engine import Connection


def _target_schema() -> str:
    schema = os.environ.get("BIMSTITCH_TENANT_SCHEMA")
    if not schema:
        raise RuntimeError(
            "BIMSTITCH_TENANT_SCHEMA env var is required for the tenant migration chain"
        )
    return schema


config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

settings = get_settings()
# Use the admin URL so the chain can create types / set search_path freely.
config.set_main_option(
    "sqlalchemy.url", settings.admin_database_url or settings.database_url
)

target_metadata = Base.metadata


def _include_object(obj, name, type_, reflected, compare_to):
    """Restrict the tenant chain to tenant-side tables (schema is None)."""
    if type_ == "table":
        return is_tenant_table(obj)
    return True


def run_migrations_offline() -> None:
    raise RuntimeError(
        "Offline mode is not supported for the tenant chain — the target schema "
        "must be set on a live connection."
    )


def do_run_migrations(connection: Connection) -> None:
    schema = _target_schema()
    # All DDL emitted by this run resolves unqualified names to the target
    # schema. Master tables referenced via `public.users.id` FKs are still
    # resolvable because `public` is on the search path.
    connection.execute(text(f'SET search_path TO "{schema}", public'))
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        compare_type=True,
        include_object=_include_object,
        # alembic_version lives inside the tenant schema so per-org migration
        # state is tracked independently.
        version_table_schema=schema,
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
