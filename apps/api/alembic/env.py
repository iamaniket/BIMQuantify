from __future__ import annotations

import asyncio
from logging.config import fileConfig
from typing import TYPE_CHECKING

from alembic import context
from sqlalchemy import pool
from sqlalchemy.ext.asyncio import async_engine_from_config

from bimstitch_api.config import get_settings
from bimstitch_api.db import MasterBase, TenantBase
from bimstitch_api.models import (  # noqa: F401 — ensure all models register
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

# NOTE — this alembic env.py points at the legacy single-chain layout that
# is being replaced by separate master/ and tenant/ chains in a follow-up.
# As a stopgap during the in-flight refactor it composes both metadatas so
# the existing migrations directory still has something to autogenerate
# against; do NOT generate new revisions from this file. The replacement
# chains will live under apps/api/alembic/master/ and apps/api/alembic/tenant/.
from sqlalchemy import MetaData as _MetaData

target_metadata = _MetaData()
for src in (MasterBase.metadata, TenantBase.metadata):
    for table in src.tables.values():
        table.to_metadata(target_metadata)

if TYPE_CHECKING:
    from sqlalchemy.engine import Connection

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

settings = get_settings()
config.set_main_option("sqlalchemy.url", settings.database_url)

def run_migrations_offline() -> None:
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
    )

    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    context.configure(connection=connection, target_metadata=target_metadata, compare_type=True)
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
