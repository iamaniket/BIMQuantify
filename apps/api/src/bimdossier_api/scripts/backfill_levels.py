"""Backfill project ``levels`` from already-extracted storeys.

Levels are normally created at IFC extraction time by
``jobs_internal._reconcile_storey_levels``. Models extracted BEFORE that
reconciliation existed have storeys with ``level_id IS NULL`` and no project
levels. This one-shot loads each model's storeys and reconciles them onto shared
project levels (elevation-within-tolerance, name fallback) — no re-extraction.

Idempotent — reuses ``jobs_internal._reconcile_storey_levels`` (find-or-create),
so re-running is a no-op once levels exist.

Prerequisite: the ``0003`` tenant migration must be applied first
(``uv run python -m bimdossier_api.scripts.migrate_all``).

Run: ``uv run python -m bimdossier_api.scripts.backfill_levels``
"""

from __future__ import annotations

import asyncio
import logging
from collections import defaultdict
from typing import TYPE_CHECKING

from sqlalchemy import select, text

from bimdossier_api.db import get_session_maker
from bimdossier_api.models.organization import Organization, OrganizationStatus
from bimdossier_api.models.storeys import Storey
from bimdossier_api.routers.jobs_internal import _reconcile_storey_levels

if TYPE_CHECKING:
    from uuid import UUID

logger = logging.getLogger(__name__)


async def _backfill_org(schema: str) -> int:
    """Reconcile every model's storeys onto project levels in one tenant schema.

    Returns the number of storeys (re)linked to a level.
    """
    session_maker = get_session_maker()
    linked = 0
    async with session_maker() as session, session.begin():
        await session.execute(text(f'SET LOCAL search_path = "{schema}", public'))
        storeys = list(
            (
                await session.execute(select(Storey).where(Storey.deleted_at.is_(None)))
            )
            .scalars()
            .all()
        )
        by_model: dict[UUID, list[Storey]] = defaultdict(list)
        for storey in storeys:
            by_model[storey.document_id].append(storey)
        for document_id, model_storeys in by_model.items():
            await _reconcile_storey_levels(session, document_id, model_storeys)
            linked += sum(1 for s in model_storeys if s.level_id is not None)
    return linked


async def main() -> None:
    logging.basicConfig(level=logging.INFO)
    session_maker = get_session_maker()
    async with session_maker() as session:
        orgs = [
            (row.id, row.schema_name)
            for row in (
                await session.execute(
                    select(Organization.id, Organization.schema_name).where(
                        Organization.status == OrganizationStatus.active,
                        Organization.deleted_at.is_(None),
                    )
                )
            ).all()
        ]

    total = 0
    for org_id, schema in orgs:
        try:
            linked = await _backfill_org(schema)
        except Exception:
            logger.exception("backfill_levels failed for org %s", org_id)
            continue
        if linked:
            logger.info("backfill_levels: linked %d storeys in %s", linked, schema)
        total += linked

    logger.info("backfill_levels: done — %d storeys linked across %d orgs", total, len(orgs))


if __name__ == "__main__":
    asyncio.run(main())
