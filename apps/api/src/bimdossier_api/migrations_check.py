"""Startup check: warn if the database is behind the latest Alembic head.

Called during the FastAPI lifespan. Never blocks startup — just logs a clear
warning so developers notice they forgot to run migrations.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import TYPE_CHECKING

from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy import select, text

from bimdossier_api.db import get_engine, get_session_maker
from bimdossier_api.models.organization import Organization

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncEngine

logger = logging.getLogger(__name__)

# Resolve ini paths relative to the api package root (apps/api/)
_API_ROOT = Path(__file__).resolve().parents[2]

_CHAINS: list[tuple[str, str]] = [
    # Only the master chain is checked here — tenant migrations are run per-org
    # schema by the provisioning saga and tracked in each org's own
    # alembic_version table, so a public-schema check would always show
    # them as "pending". The separate per-tenant chain is surfaced by
    # ``check_tenant_schema_drift`` below.
    ("master", str(_API_ROOT / "alembic.master.ini")),
]

_TENANT_INI = str(_API_ROOT / "alembic.tenant.ini")


async def check_pending_migrations(engine: AsyncEngine) -> None:
    """Compare each Alembic chain's head against the DB and log a warning
    if any migrations are pending. Errors are caught so the app still starts.
    """
    for chain_name, ini_path in _CHAINS:
        try:
            await _check_chain(engine, chain_name, ini_path)
        except Exception as exc:
            # Extract a short reason from the exception chain
            root: BaseException = exc
            while root.__cause__:
                root = root.__cause__
            reason = f"{type(root).__name__}: {root}"
            logger.warning(
                "Could not verify %s migrations — %s. "
                "This is normal if the database is still starting up or doesn't exist yet.",
                chain_name,
                reason,
            )


async def _check_chain(engine: AsyncEngine, chain_name: str, ini_path: str) -> None:
    cfg = Config(ini_path)
    script = ScriptDirectory.from_config(cfg)
    heads = set(script.get_heads())

    if not heads:
        return

    # The version table name may differ per chain; read it from the script env
    version_table = cfg.get_main_option("version_table") or "alembic_version"

    async with engine.connect() as conn:
        current_revs = await conn.run_sync(_get_current_revisions, version_table)

    pending = heads - current_revs
    if pending:
        logger.warning(
            "DATABASE BEHIND — %s chain has pending migrations: %s. "
            "Run:  cd apps/api && uv run alembic -c %s upgrade head",
            chain_name,
            ", ".join(sorted(pending)),
            Path(ini_path).name,
        )
    else:
        logger.info("%s migrations are up to date.", chain_name)


def _get_current_revisions(connection: object, version_table: str) -> set[str]:
    """Synchronous callback for ``run_sync`` — reads current Alembic revisions."""
    from sqlalchemy.engine import Connection

    assert isinstance(connection, Connection)
    # Check if the version table exists at all
    result = connection.execute(
        text(
            "SELECT EXISTS ("
            "  SELECT 1 FROM information_schema.tables "
            "  WHERE table_schema = 'public' AND table_name = :tbl"
            ")"
        ),
        {"tbl": version_table},
    )
    if not result.scalar():
        return set()

    ctx = MigrationContext.configure(connection, opts={"version_table": version_table})
    return set(ctx.get_current_heads())


# --- Tenant-schema drift -----------------------------------------------------
# Read-only helpers shared with ``scripts/migrate_all.py`` (which re-exports
# them). They list active org schemas, read each schema's ``alembic_version``
# stamp, and classify it against the tenant chain head — the building blocks for
# both the batch upgrade CLI and the startup drift probe below.


def tenant_heads() -> set[str]:
    """Head revision(s) of the tenant chain (linear chain → one element)."""
    return set(ScriptDirectory.from_config(Config(_TENANT_INI)).get_heads())


async def list_active_schemas() -> list[str]:
    """Schema names of every active (non-soft-deleted) org, oldest first."""
    async with get_session_maker()() as session:
        stmt = (
            select(Organization.schema_name)
            .where(Organization.deleted_at.is_(None))
            .order_by(Organization.created_at)
        )
        result = await session.execute(stmt)
        return [row[0] for row in result.all()]


async def read_schema_revisions(
    schemas: list[str], engine: AsyncEngine | None = None
) -> dict[str, str | None]:
    """Current ``alembic_version`` per schema. ``None`` when the schema has no
    ``alembic_version`` table yet (never migrated). Uses the app engine unless an
    explicit one is passed (tests)."""
    revs: dict[str, str | None] = {}
    engine = engine or get_engine()
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


def classify(
    schemas: list[str], revs: dict[str, str | None], heads: set[str]
) -> tuple[list[str], list[str]]:
    """Split schemas into (at_head, behind) by comparing each schema's current
    revision against the tenant head(s). Order is preserved."""
    at_head = [s for s in schemas if revs.get(s) in heads]
    behind = [s for s in schemas if revs.get(s) not in heads]
    return at_head, behind


async def check_tenant_schema_drift(engine: AsyncEngine) -> list[str]:
    """Probe every active org schema; log a loud WARNING if any is behind the
    tenant head. Returns the behind list (for tests).

    Read-only and best-effort: it only SELECTs, never disposes the app engine
    (the critical difference from ``migrate_all._gather_state``), and never
    blocks boot. The master startup check (``check_pending_migrations``) covers
    only the public chain; this surfaces the separate per-tenant chain so a
    deploy that ran the master upgrade but forgot ``migrate_all`` doesn't
    silently 500 existing orgs on the new code path.
    """
    heads = tenant_heads()
    if not heads:
        return []
    schemas = await list_active_schemas()
    if not schemas:
        return []
    revs = await read_schema_revisions(schemas, engine)
    _at_head, behind = classify(schemas, revs, heads)
    if behind:
        logger.warning(
            "TENANT SCHEMAS BEHIND — %d of %d active org schema(s) are not at the "
            "tenant head (%s): %s. These orgs will hit UndefinedColumn / enum 500s "
            "on the new code path. Run:  cd apps/api && "
            "uv run python -m bimdossier_api.scripts.migrate_all",
            len(behind),
            len(schemas),
            ", ".join(sorted(heads)),
            ", ".join(f"{s}={revs.get(s) or 'none'}" for s in behind),
        )
    else:
        logger.info("All %d tenant schema(s) at head.", len(schemas))
    return behind
