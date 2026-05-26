"""Startup check: warn if the database is behind the latest Alembic head.

Called during the FastAPI lifespan. Never blocks startup — just logs a clear
warning so developers notice they forgot to run migrations.
"""

from __future__ import annotations

import logging
from pathlib import Path

from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

logger = logging.getLogger(__name__)

# Resolve ini paths relative to the api package root (apps/api/)
_API_ROOT = Path(__file__).resolve().parents[2]

_CHAINS: list[tuple[str, str]] = [
    # Only the master chain is checked — tenant migrations are run per-org
    # schema by the provisioning saga and tracked in each org's own
    # alembic_version table, so a public-schema check would always show
    # them as "pending".
    ("master", str(_API_ROOT / "alembic.master.ini")),
]


async def check_pending_migrations(engine: AsyncEngine) -> None:
    """Compare each Alembic chain's head against the DB and log a warning
    if any migrations are pending. Errors are caught so the app still starts.
    """
    for chain_name, ini_path in _CHAINS:
        try:
            await _check_chain(engine, chain_name, ini_path)
        except Exception:
            logger.warning(
                "Could not verify %s migrations (DB might not exist yet)",
                chain_name,
                exc_info=True,
            )


async def _check_chain(
    engine: AsyncEngine, chain_name: str, ini_path: str
) -> None:
    cfg = Config(ini_path)
    script = ScriptDirectory.from_config(cfg)
    heads = set(script.get_heads())

    if not heads:
        return

    # The version table name may differ per chain; read it from the script env
    version_table = cfg.get_main_option("version_table") or "alembic_version"

    async with engine.connect() as conn:
        current_revs = await conn.run_sync(
            _get_current_revisions, version_table
        )

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


def _get_current_revisions(
    connection: object, version_table: str
) -> set[str]:
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
