"""Tests for the startup tenant-schema drift probe (B6).

The probe (``check_tenant_schema_drift``) is the runtime safety net for a deploy
that ran the master ``alembic upgrade head`` but forgot the separate
``migrate_all`` fan-out: pre-existing org schemas left behind the tenant head
would otherwise 500 with raw ``UndefinedColumn`` / enum errors, with no warning.

The behavioural tests monkeypatch the three read-only helpers so the warn / info
/ no-op branches are deterministic and DB-state independent. One integration
test exercises the real ``read_schema_revisions`` SQL against a live schema.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from bimdossier_api import migrations_check
from bimdossier_api.migrations_check import (
    check_tenant_schema_drift,
    read_schema_revisions,
)

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncEngine

_LOGGER = "bimdossier_api.migrations_check"


async def test_check_tenant_schema_drift_warns_on_behind(monkeypatch, caplog) -> None:
    async def fake_list() -> list[str]:
        return ["org_aaa", "org_bbb", "org_ccc"]

    async def fake_read(schemas: list[str], engine: AsyncEngine | None = None):
        # org_aaa at head; org_bbb on an older rev; org_ccc never migrated.
        return {
            "org_aaa": "0001_tenant",
            "org_bbb": "0000_older",
            "org_ccc": None,
        }

    monkeypatch.setattr(migrations_check, "tenant_heads", lambda: {"0001_tenant"})
    monkeypatch.setattr(migrations_check, "list_active_schemas", fake_list)
    monkeypatch.setattr(migrations_check, "read_schema_revisions", fake_read)

    with caplog.at_level(logging.WARNING, logger=_LOGGER):
        behind = await check_tenant_schema_drift(None)  # type: ignore[arg-type]

    # Order preserved; only the laggards are returned.
    assert behind == ["org_bbb", "org_ccc"]
    text = caplog.text
    assert "TENANT SCHEMAS BEHIND" in text
    assert "org_bbb" in text and "org_ccc" in text
    assert "org_aaa" not in text  # at-head schema is not flagged
    assert "migrate_all" in text  # remediation command is named


async def test_check_tenant_schema_drift_silent_when_all_at_head(monkeypatch, caplog) -> None:
    async def fake_list() -> list[str]:
        return ["org_aaa", "org_bbb"]

    async def fake_read(schemas: list[str], engine: AsyncEngine | None = None):
        return {"org_aaa": "0001_tenant", "org_bbb": "0001_tenant"}

    monkeypatch.setattr(migrations_check, "tenant_heads", lambda: {"0001_tenant"})
    monkeypatch.setattr(migrations_check, "list_active_schemas", fake_list)
    monkeypatch.setattr(migrations_check, "read_schema_revisions", fake_read)

    with caplog.at_level(logging.INFO, logger=_LOGGER):
        behind = await check_tenant_schema_drift(None)  # type: ignore[arg-type]

    assert behind == []
    assert [r for r in caplog.records if r.levelno >= logging.WARNING] == []
    assert "at head" in caplog.text


async def test_check_tenant_schema_drift_noop_without_schemas(monkeypatch, caplog) -> None:
    async def fake_list() -> list[str]:
        return []

    async def boom(schemas: list[str], engine: AsyncEngine | None = None):
        raise AssertionError("read_schema_revisions must not be called when there are no schemas")

    monkeypatch.setattr(migrations_check, "tenant_heads", lambda: {"0001_tenant"})
    monkeypatch.setattr(migrations_check, "list_active_schemas", fake_list)
    monkeypatch.setattr(migrations_check, "read_schema_revisions", boom)

    with caplog.at_level(logging.WARNING, logger=_LOGGER):
        behind = await check_tenant_schema_drift(None)  # type: ignore[arg-type]

    assert behind == []
    assert [r for r in caplog.records if r.levelno >= logging.WARNING] == []


async def test_read_schema_revisions_reads_stamp_and_handles_missing(
    engine: AsyncEngine,
) -> None:
    """The moved SQL helper reads a real ``alembic_version`` stamp and reports
    ``None`` for a schema that has no such table (never migrated)."""
    schema = "org_drifttest01"
    async with engine.begin() as conn:
        await conn.exec_driver_sql(f'CREATE SCHEMA IF NOT EXISTS "{schema}"')
        await conn.exec_driver_sql(
            f'CREATE TABLE "{schema}".alembic_version (version_num VARCHAR(32) NOT NULL)'
        )
        await conn.exec_driver_sql(
            f'INSERT INTO "{schema}".alembic_version (version_num) '
            "VALUES ('0001_tenant')"
        )
    try:
        revs = await read_schema_revisions([schema, "org_missing_zzz"], engine=engine)
    finally:
        async with engine.begin() as conn:
            await conn.exec_driver_sql(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE')

    assert revs[schema] == "0001_tenant"
    assert revs["org_missing_zzz"] is None
