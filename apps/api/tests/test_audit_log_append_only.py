"""H8 — `audit_log` is append-only.

Two layers, exercised here against both the `public` schema (where the test
harness keeps audit_log) and a real per-tenant `org_<hex>` schema (provisioned
by the `org_user` fixture, proving the `grant_schema_to_app_role` /
`migrate_all` path):

  1. `bim_app` (the role serving all request traffic) has NO UPDATE/DELETE on
     audit_log — a tenant-session mutation is denied with SQLSTATE 42501.
  2. A `BEFORE UPDATE OR DELETE` trigger raises for ANY role, including the
     superuser — the role-independent backstop against surgical tampering.

INSERT (append) still works for bim_app, and superuser TRUNCATE still works so
the seed reset and the per-test teardown survive (there is deliberately no
BEFORE TRUNCATE trigger).
"""

from uuid import UUID, uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from bimdossier_api.tenancy import schema_name_for


async def _insert_row(session_maker: async_sessionmaker[AsyncSession], schema: str) -> str:
    """Append one audit row (allowed) and return its id."""
    rid = str(uuid4())
    async with session_maker() as s:
        await s.execute(
            text(
                f'INSERT INTO "{schema}".audit_log (id, action, resource_type) '
                "VALUES (:id, 'test.event', 'user')"
            ),
            {"id": rid},
        )
        await s.commit()
    return rid


async def _run_expecting_error(
    session_maker: async_sessionmaker[AsyncSession], sql: str, params: dict, *, role: str | None
) -> str:
    """Run `sql` (optionally under `SET LOCAL ROLE role`) expecting it to raise;
    return the lower-cased error text."""
    with pytest.raises(Exception) as exc_info:  # message asserted by caller
        async with session_maker() as s:
            if role is not None:
                await s.execute(text(f"SET LOCAL ROLE {role}"))
            await s.execute(text(sql), params)
            await s.commit()
    return str(exc_info.value).lower()


async def _assert_append_only(session_maker: async_sessionmaker[AsyncSession], schema: str) -> None:
    rid = await _insert_row(session_maker, schema)
    tbl = f'"{schema}".audit_log'

    # Superuser UPDATE / DELETE → the deny trigger raises.
    msg = await _run_expecting_error(
        session_maker, f"UPDATE {tbl} SET action = 'tamper' WHERE id = :id", {"id": rid}, role=None
    )
    assert "append-only" in msg, msg
    msg = await _run_expecting_error(
        session_maker, f"DELETE FROM {tbl} WHERE id = :id", {"id": rid}, role=None
    )
    assert "append-only" in msg, msg

    # bim_app UPDATE / DELETE → privilege revoke fires first (permission denied).
    msg = await _run_expecting_error(
        session_maker,
        f"UPDATE {tbl} SET action = 'tamper' WHERE id = :id",
        {"id": rid},
        role="bim_app",
    )
    assert "permission denied" in msg, msg
    msg = await _run_expecting_error(
        session_maker, f"DELETE FROM {tbl} WHERE id = :id", {"id": rid}, role="bim_app"
    )
    assert "permission denied" in msg, msg

    # The row is untouched (every mutation above was rejected).
    async with session_maker() as s:
        action = await s.scalar(text(f"SELECT action FROM {tbl} WHERE id = :id"), {"id": rid})
    assert action == "test.event"

    # bim_app INSERT (append) still works.
    rid2 = str(uuid4())
    async with session_maker() as s:
        await s.execute(text("SET LOCAL ROLE bim_app"))
        await s.execute(
            text(
                f"INSERT INTO {tbl} (id, action, resource_type) VALUES (:id, 'append.ok', 'user')"
            ),
            {"id": rid2},
        )
        await s.commit()
    async with session_maker() as s:
        count = await s.scalar(text(f"SELECT count(*) FROM {tbl} WHERE id = :id"), {"id": rid2})
    assert count == 1


async def test_audit_log_append_only_public(
    client: AsyncClient,
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """Enforcement holds in `public` (where the harness keeps audit_log)."""
    await _assert_append_only(session_maker, "public")

    # Superuser TRUNCATE must still succeed — the seed reset and `_clean_tables`
    # teardown depend on it (there is no BEFORE TRUNCATE trigger).
    async with session_maker() as s:
        await s.execute(text("TRUNCATE TABLE public.audit_log"))
        await s.commit()


async def test_audit_log_append_only_tenant_schema(
    org_user: dict[str, str],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """Enforcement holds in a real per-tenant `org_<hex>` schema, proving the
    provisioning / migrate_all path installs it."""
    schema = schema_name_for(UUID(org_user["organization_id"]))
    await _assert_append_only(session_maker, schema)
