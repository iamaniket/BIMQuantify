"""Backfill the ``storeys`` table for already-extracted IFC models.

Storeys are normally populated by the (rebuilt) processor at extraction time.
Models extracted BEFORE that pipeline existed have an empty ``storeys`` table,
which blocks PDF↔3D alignment ("This model has no storeys yet"). Their spatial
tree, however, already carries every ``IfcBuildingStorey`` — it's sitting in the
metadata artifact in object storage. This one-shot reads that metadata and
upserts storeys: no re-upload, no re-extraction.

Idempotent — reuses ``jobs_internal._upsert_storeys`` (keyed by
``(model_id, ifc_guid)``), so re-running it is a no-op once storeys exist.

Prerequisite: the ``0002`` tenant migration must be applied first
(``uv run python -m bimstitch_api.scripts.migrate_all``) so the table exists.

Run: ``uv run python -m bimstitch_api.scripts.backfill_storeys``
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

from sqlalchemy import select, text

from bimstitch_api.db import get_session_maker
from bimstitch_api.models.organization import Organization, OrganizationStatus
from bimstitch_api.models.project_file import (
    ExtractionStatus,
    FileType,
    ProjectFile,
    ProjectFileRole,
)
from bimstitch_api.routers.jobs_internal import _upsert_storeys
from bimstitch_api.schemas.project_file import StoreyCallbackItem
from bimstitch_api.storage import StorageBackend, get_storage

logger = logging.getLogger(__name__)


def _walk_storeys(node: dict[str, Any] | None, out: list[StoreyCallbackItem]) -> None:
    """Collect every IfcBuildingStorey node from a metadata spatial tree."""
    if not isinstance(node, dict):
        return
    if node.get("type") == "IfcBuildingStorey":
        out.append(
            StoreyCallbackItem(
                express_id=int(node.get("expressID") or 0),
                global_id=node.get("globalId"),
                name=node.get("name"),
                elevation=node.get("elevation"),
            )
        )
    children = node.get("children")
    if isinstance(children, list):
        for child in children:
            _walk_storeys(child, out)


async def _download_json(storage: StorageBackend, key: str) -> dict[str, Any] | None:
    """Fetch + parse a stored JSON artifact (HEAD for size, then a full range read)."""
    head = await storage.head_object(key)
    size = head.get("ContentLength")
    if not isinstance(size, int) or size <= 0:
        return None
    raw = await storage.get_object_range(key, 0, size - 1)
    parsed = json.loads(raw.decode("utf-8"))
    return parsed if isinstance(parsed, dict) else None


async def _backfill_org(schema: str) -> int:
    """Upsert storeys for every succeeded IFC model in one tenant schema.

    Returns the number of storeys upserted. Versions are processed oldest-first
    so the newest extraction wins on the idempotent re-upsert.
    """
    session_maker = get_session_maker()
    storage = get_storage()
    count = 0
    async with session_maker() as session, session.begin():
        await session.execute(text(f'SET LOCAL search_path = "{schema}", public'))
        files = list(
            (
                await session.execute(
                    select(ProjectFile)
                    .where(
                        ProjectFile.role == ProjectFileRole.model_source,
                        ProjectFile.file_type == FileType.ifc,
                        ProjectFile.extraction_status == ExtractionStatus.succeeded,
                        ProjectFile.metadata_storage_key.is_not(None),
                        ProjectFile.model_id.is_not(None),
                    )
                    .order_by(ProjectFile.version_number.asc())
                )
            )
            .scalars()
            .all()
        )
        for file in files:
            key = file.metadata_storage_key
            if key is None:
                continue
            try:
                metadata = await _download_json(storage, key)
            except Exception:
                logger.warning("Could not read metadata %s (file %s)", key, file.id, exc_info=True)
                continue
            if metadata is None:
                continue
            storeys: list[StoreyCallbackItem] = []
            _walk_storeys(metadata.get("spatialTree"), storeys)
            if not storeys:
                continue
            await _upsert_storeys(session, file, storeys)
            count += len(storeys)
    return count


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
            upserted = await _backfill_org(schema)
        except Exception:
            logger.exception("backfill_storeys failed for org %s", org_id)
            continue
        if upserted:
            logger.info("backfill_storeys: upserted %d storeys in %s", upserted, schema)
        total += upserted

    logger.info("backfill_storeys: done — %d storeys upserted across %d orgs", total, len(orgs))


if __name__ == "__main__":
    asyncio.run(main())
