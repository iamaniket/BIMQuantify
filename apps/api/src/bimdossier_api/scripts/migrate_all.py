"""Run master Alembic, then tenant Alembic against every active org schema.

Usage:
    uv run python -m bimdossier_api.scripts.migrate_all                # upgrade all
    uv run python -m bimdossier_api.scripts.migrate_all --check        # report drift, no writes
    uv run python -m bimdossier_api.scripts.migrate_all --concurrency 16

Idempotent — running against an already-up-to-date DB is a no-op. The
provisioning saga calls the tenant chain in-process for NEW orgs; this script
is the batch path for upgrading EXISTING org schemas after a deploy.

Parallelism uses separate PROCESSES, not threads: Alembic's `command.upgrade`
drives migrations through module-level `op`/`context` proxies and the tenant
chain resolves its target schema from a process-global env var, so two upgrades
in one process would corrupt each other. One process per schema isolates both.

Exit codes: 0 = everything at head / upgraded cleanly; 1 = at least one schema
failed to upgrade (normal mode) or is behind head (`--check`). CI can gate on
the `--check` exit code post-deploy to catch tenant-schema drift, which the
startup check (master chain only) does not surface.
"""

from __future__ import annotations

import argparse
import asyncio
import os
import pathlib
import sys
from concurrent.futures import ProcessPoolExecutor, as_completed
from typing import TYPE_CHECKING

from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import select, text

if TYPE_CHECKING:
    from collections.abc import Callable

from bimdossier_api.config import get_settings
from bimdossier_api.db import get_engine, get_session_maker
from bimdossier_api.models.organization import Organization

API_DIR = pathlib.Path(__file__).resolve().parents[3]
MASTER_INI = str(API_DIR / "alembic.master.ini")
TENANT_INI = str(API_DIR / "alembic.tenant.ini")

_LOCK_KEY = "migrate_all:lock"
_LOCK_TTL_SECONDS = 3600

# Per-schema outcome labels (also used by the summary + tests).
UPGRADED = "upgraded"
FAILED = "failed"

# (schema, outcome, error_or_none)
SchemaResult = tuple[str, str, str | None]


def run_master() -> None:
    cfg = Config(MASTER_INI)
    command.upgrade(cfg, "head")


def run_tenant(schema: str) -> None:
    """Upgrade one tenant schema. Sets the process-global env var the tenant
    Alembic chain reads — safe only because each batch upgrade runs in its own
    process (see module docstring)."""
    cfg = Config(TENANT_INI)
    os.environ["BIMDOSSIER_TENANT_SCHEMA"] = schema
    try:
        command.upgrade(cfg, "head")
    finally:
        os.environ.pop("BIMDOSSIER_TENANT_SCHEMA", None)


def tenant_heads() -> set[str]:
    """Head revision(s) of the tenant chain (linear chain → one element)."""
    return set(ScriptDirectory.from_config(Config(TENANT_INI)).get_heads())


async def _list_active_schemas() -> list[str]:
    async with get_session_maker()() as session:
        stmt = (
            select(Organization.schema_name)
            .where(Organization.deleted_at.is_(None))
            .order_by(Organization.created_at)
        )
        result = await session.execute(stmt)
        return [row[0] for row in result.all()]


async def _read_schema_revisions(schemas: list[str]) -> dict[str, str | None]:
    """Current `alembic_version` per schema. None when the schema has no
    `alembic_version` table yet (never migrated)."""
    revs: dict[str, str | None] = {}
    engine = get_engine()
    async with engine.connect() as conn:
        for schema in schemas:
            exists = await conn.scalar(
                text(
                    "SELECT EXISTS (SELECT 1 FROM information_schema.tables "
                    "WHERE table_schema = :s AND table_name = 'alembic_version')"
                ),
                {"s": schema},
            )
            if not exists:
                revs[schema] = None
                continue
            revs[schema] = await conn.scalar(
                text(f'SELECT version_num FROM "{schema}".alembic_version')
            )
    return revs


async def _gather_state() -> tuple[list[str], dict[str, str | None]]:
    """List active schemas and read their revisions in a SINGLE event loop.

    Both touch the global async engine; doing them in one `asyncio.run` keeps
    the engine bound to one loop (reusing it across loops raises "attached to a
    different loop"). The lock helpers use their own throwaway clients instead.
    """
    try:
        schemas = await _list_active_schemas()
        revs = await _read_schema_revisions(schemas)
        return schemas, revs
    finally:
        await get_engine().dispose()


def classify(
    schemas: list[str], revs: dict[str, str | None], heads: set[str]
) -> tuple[list[str], list[str]]:
    """Split schemas into (at_head, behind) by comparing each schema's current
    revision against the tenant head(s). Order is preserved."""
    at_head = [s for s in schemas if revs.get(s) in heads]
    behind = [s for s in schemas if revs.get(s) not in heads]
    return at_head, behind


def _upgrade_schema_worker(schema: str) -> SchemaResult:
    """Top-level (picklable) worker for ProcessPoolExecutor. Runs in its own
    process so the env var + Alembic proxies are isolated per schema. Never
    raises — failures are returned so one bad schema doesn't sink the batch."""
    try:
        run_tenant(schema)
        return (schema, UPGRADED, None)
    except Exception as exc:  # report, don't crash the batch
        return (schema, FAILED, f"{type(exc).__name__}: {exc}")


def fan_out(
    schemas: list[str],
    concurrency: int,
    worker: Callable[[str], SchemaResult] = _upgrade_schema_worker,
) -> list[SchemaResult]:
    """Upgrade each schema. Serial in-process when concurrency <= 1 (used by
    tests and as a safe fallback); otherwise one process per schema, bounded by
    `concurrency`."""
    if not schemas:
        return []
    if concurrency <= 1 or len(schemas) == 1:
        return [worker(s) for s in schemas]
    results: list[SchemaResult] = []
    with ProcessPoolExecutor(max_workers=concurrency) as pool:
        futures = [pool.submit(worker, s) for s in schemas]
        for fut in as_completed(futures):
            results.append(fut.result())
    return results


def summarize(at_head: list[str], results: list[SchemaResult]) -> int:
    """Print a per-schema summary; return the process exit code (non-zero if any
    upgrade failed)."""
    upgraded = [r for r in results if r[1] == UPGRADED]
    failed = [r for r in results if r[1] == FAILED]
    print("\nTenant migration summary:")
    print(f"  up-to-date: {len(at_head)}")
    print(f"  upgraded:   {len(upgraded)}")
    print(f"  failed:     {len(failed)}")
    for schema, _, err in failed:
        print(f"    {schema}: {err}", file=sys.stderr)
    return 1 if failed else 0


def report_drift(
    heads: set[str],
    at_head: list[str],
    behind: list[str],
    revs: dict[str, str | None],
) -> int:
    """Print tenant-schema drift; return exit code (1 if any schema is behind)."""
    head_label = ", ".join(sorted(heads)) or "(none)"
    print(f"Tenant migration drift (head={head_label}):")
    print(f"  at head: {len(at_head)}")
    print(f"  behind:  {len(behind)}")
    for schema in behind:
        print(f"    {schema} (current={revs.get(schema) or 'none'})")
    return 1 if behind else 0


async def _acquire_lock(url: str) -> bool | None:
    """Try to claim the run lock. True = acquired, False = another run holds it,
    None = Redis unavailable (proceed without a lock). Uses a throwaway client
    so it never shares an event loop with the global engine."""
    try:
        from redis.asyncio import Redis

        async with Redis.from_url(url, decode_responses=True) as client:
            return bool(await client.set(_LOCK_KEY, "1", nx=True, ex=_LOCK_TTL_SECONDS))
    except Exception as exc:
        print(
            f"WARN: Redis lock unavailable ({exc}); proceeding without it.",
            file=sys.stderr,
        )
        return None


async def _release_lock(url: str) -> None:
    try:
        from redis.asyncio import Redis

        async with Redis.from_url(url, decode_responses=True) as client:
            await client.delete(_LOCK_KEY)
    except Exception:
        pass


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Upgrade the master schema and every tenant schema to head."
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="Report tenant-schema drift without writing. Exit 1 if any are behind.",
    )
    parser.add_argument(
        "--concurrency",
        type=int,
        default=8,
        help="Max concurrent schema upgrades (one process each). Default: 8.",
    )
    args = parser.parse_args(argv)

    heads = tenant_heads()

    if args.check:
        schemas, revs = asyncio.run(_gather_state())
        at_head, behind = classify(schemas, revs, heads)
        return report_drift(heads, at_head, behind, revs)

    settings = get_settings()
    lock = asyncio.run(_acquire_lock(settings.redis_url))
    if lock is False:
        print("Another migrate_all run is in progress; exiting.", file=sys.stderr)
        return 1
    holding = lock is True
    try:
        print("Upgrading master schema...")
        run_master()
        print("  done.")

        schemas, revs = asyncio.run(_gather_state())
        if not schemas:
            print("No tenant schemas to upgrade.")
            return 0

        at_head, behind = classify(schemas, revs, heads)
        print(
            f"{len(at_head)} schema(s) at head, {len(behind)} to upgrade "
            f"(concurrency={args.concurrency})."
        )
        results = fan_out(behind, args.concurrency)
        return summarize(at_head, results)
    finally:
        if holding:
            asyncio.run(_release_lock(settings.redis_url))


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        sys.exit(130)
