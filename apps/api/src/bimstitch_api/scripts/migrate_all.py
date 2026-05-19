"""Run master Alembic, then tenant Alembic against every active org schema.

Usage:
    uv run python -m bimstitch_api.scripts.migrate_all

Idempotent — running against an already-up-to-date DB is a no-op. The
provisioning saga calls the tenant chain in-process via Alembic's Python
API (no subprocess), so this script is for batch upgrades after deploy
rather than per-tenant provisioning.
"""

from __future__ import annotations

import asyncio
import os
import pathlib
import sys

from alembic import command
from alembic.config import Config
from sqlalchemy import select

from bimstitch_api.db import get_session_maker
from bimstitch_api.models.organization import Organization

API_DIR = pathlib.Path(__file__).resolve().parents[3]
MASTER_INI = str(API_DIR / "alembic.master.ini")
TENANT_INI = str(API_DIR / "alembic.tenant.ini")


def run_master() -> None:
    cfg = Config(MASTER_INI)
    command.upgrade(cfg, "head")


def run_tenant(schema: str) -> None:
    cfg = Config(TENANT_INI)
    # Alembic env reads this from the process env.
    os.environ["BIMSTITCH_TENANT_SCHEMA"] = schema
    try:
        command.upgrade(cfg, "head")
    finally:
        os.environ.pop("BIMSTITCH_TENANT_SCHEMA", None)


async def _list_active_schemas() -> list[str]:
    async with get_session_maker()() as session:
        stmt = (
            select(Organization.schema_name)
            .where(Organization.deleted_at.is_(None))
            .order_by(Organization.created_at)
        )
        result = await session.execute(stmt)
        return [row[0] for row in result.all()]


async def main() -> None:
    print("Upgrading master schema...")
    run_master()
    print("  done.")

    schemas = await _list_active_schemas()
    if not schemas:
        print("No tenant schemas to upgrade.")
        return

    for schema in schemas:
        print(f"Upgrading tenant schema: {schema}")
        run_tenant(schema)
        print(f"  done: {schema}")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        sys.exit(130)
