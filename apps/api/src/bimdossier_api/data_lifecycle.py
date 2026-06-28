"""Background reapers for orphaned tenant data (finding L11).

Two lifespan-managed sweepers, both following the established
``PeriodicSweeper`` + per-org-schema + ``map_bounded`` pattern (see
``jobs/reconcile.py`` and ``deadlines/reminder_engine.py``):

* ``PendingUploadSweeper`` — a ``project_files`` row is created ``pending`` by
  ``.../files/initiate`` and only flips to ``ready`` once the client calls
  ``.../complete``. An initiate that is never completed (closed tab, dead
  network, abandoned mobile capture) leaves the row ``pending`` forever, with a
  possibly-half-uploaded S3 object behind it. This sweep soft-deletes pending
  rows older than ``PENDING_UPLOAD_TIMEOUT_MINUTES`` and best-effort deletes
  their object.

* ``CaptureLinkExpirySweeper`` — capture links carry an ``expires_at`` and can be
  revoked, but the rows are never reaped. This sweep hard-deletes links that are
  expired or revoked **and never used** (``use_count == 0``). Used/exhausted
  links are left in place: their ``project_files.capture_link_id`` is the upload
  provenance (FK is ``ON DELETE SET NULL``), and dropping the link would silently
  erase it. The remainder is cleaned at org purge.

Both are idempotent and leader-elected (advisory lock per sweep), so running
multiple API instances is safe. Disable either with ``interval_minutes=0``.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING

from sqlalchemy import or_, select, text

from bimdossier_api.background.concurrency import map_bounded
from bimdossier_api.background.periodic import PeriodicSweeper
from bimdossier_api.config import get_settings
from bimdossier_api.db import get_session_maker
from bimdossier_api.models.capture_link import CaptureLink
from bimdossier_api.models.organization import Organization, OrganizationStatus
from bimdossier_api.models.project_file import (
    ProjectFile,
    ProjectFileRole,
    ProjectFileStatus,
)
from bimdossier_api.storage import get_attachments_bucket, get_storage

if TYPE_CHECKING:
    from uuid import UUID

logger = logging.getLogger(__name__)


async def _active_org_schemas() -> list[tuple[UUID, str]]:
    """(org_id, schema) for every active, non-deleted org."""
    session_maker = get_session_maker()
    async with session_maker() as session:
        result = await session.execute(
            select(Organization.id, Organization.schema_name).where(
                Organization.status == OrganizationStatus.active,
                Organization.deleted_at.is_(None),
            )
        )
        return [(row.id, row.schema_name) for row in result.all()]


# ---------------------------------------------------------------------------
# Abandoned pending uploads
# ---------------------------------------------------------------------------


async def _sweep_pending_uploads_org(schema: str, cutoff_minutes: int) -> int:
    """Soft-delete abandoned pending uploads in one tenant schema. Returns count."""
    session_maker = get_session_maker()
    storage = get_storage()
    attachments_bucket = get_attachments_bucket()
    cutoff = datetime.now(UTC) - timedelta(minutes=cutoff_minutes)
    reaped = 0

    async with session_maker() as session, session.begin():
        await session.execute(text(f'SET LOCAL search_path = "{schema}", public'))
        stale = list(
            (
                await session.execute(
                    select(ProjectFile).where(
                        ProjectFile.status == ProjectFileStatus.pending,
                        ProjectFile.deleted_at.is_(None),
                        ProjectFile.created_at < cutoff,
                    )
                )
            )
            .scalars()
            .all()
        )

        for pf in stale:
            # Best-effort object cleanup. A pending upload may have no object at
            # all (the client never PUT it), so a miss is expected and harmless —
            # DeleteObject is idempotent. Attachments live in their own bucket;
            # model-source files live in the default (IFC) bucket.
            if pf.storage_key:
                bucket = (
                    attachments_bucket
                    if pf.role == ProjectFileRole.attachment
                    else None
                )
                try:
                    await storage.delete_object(pf.storage_key, bucket=bucket)
                except Exception:
                    logger.warning(
                        "pending_upload_sweep: failed to delete object %s (file %s)",
                        pf.storage_key,
                        pf.id,
                        exc_info=True,
                    )
            pf.soft_delete()
            reaped += 1

    return reaped


async def sweep_pending_uploads_all_orgs(cutoff_minutes: int) -> int:
    """One-shot pending-upload sweep across all active orgs. Returns total reaped."""
    orgs = await _active_org_schemas()

    async def _one(org: tuple[UUID, str]) -> int:
        org_id, schema = org
        try:
            return await _sweep_pending_uploads_org(schema, cutoff_minutes)
        except Exception:
            logger.exception("Pending-upload sweep failed for org %s", org_id)
            return 0

    counts = await map_bounded(orgs, _one, limit=get_settings().sweep_org_concurrency)
    total = sum(counts)
    if total:
        logger.info("pending_upload_sweep: reaped %d abandoned pending uploads", total)
    return total


class PendingUploadSweeper(PeriodicSweeper):
    """Reaps ``pending`` ``project_files`` older than ``timeout_minutes``."""

    def __init__(self, interval_minutes: int, timeout_minutes: int) -> None:
        super().__init__(
            name="pending_upload_sweeper",
            interval_seconds=interval_minutes * 60,
            lock_key="sweep:pending_upload",
        )
        self.timeout_minutes = timeout_minutes

    async def run_once(self) -> None:
        await sweep_pending_uploads_all_orgs(self.timeout_minutes)


# ---------------------------------------------------------------------------
# Expired / revoked capture links (unused only)
# ---------------------------------------------------------------------------


async def _sweep_capture_links_org(schema: str) -> int:
    """Hard-delete expired/revoked, never-used capture links in one schema."""
    session_maker = get_session_maker()
    now = datetime.now(UTC)
    reaped = 0

    async with session_maker() as session, session.begin():
        await session.execute(text(f'SET LOCAL search_path = "{schema}", public'))
        stale = list(
            (
                await session.execute(
                    select(CaptureLink).where(
                        # Never used → no project_files reference its provenance.
                        CaptureLink.use_count == 0,
                        or_(
                            CaptureLink.expires_at <= now,
                            CaptureLink.revoked_at.is_not(None),
                        ),
                    )
                )
            )
            .scalars()
            .all()
        )
        for link in stale:
            await session.delete(link)
            reaped += 1

    return reaped


async def sweep_capture_links_all_orgs() -> int:
    """One-shot capture-link sweep across all active orgs. Returns total reaped."""
    orgs = await _active_org_schemas()

    async def _one(org: tuple[UUID, str]) -> int:
        org_id, schema = org
        try:
            return await _sweep_capture_links_org(schema)
        except Exception:
            logger.exception("Capture-link sweep failed for org %s", org_id)
            return 0

    counts = await map_bounded(orgs, _one, limit=get_settings().sweep_org_concurrency)
    total = sum(counts)
    if total:
        logger.info("capture_link_sweep: reaped %d expired/revoked unused links", total)
    return total


class CaptureLinkExpirySweeper(PeriodicSweeper):
    """Reaps expired/revoked capture links that were never used."""

    def __init__(self, interval_minutes: int) -> None:
        super().__init__(
            name="capture_link_expiry_sweeper",
            interval_seconds=interval_minutes * 60,
            lock_key="sweep:capture_link_expiry",
        )

    async def run_once(self) -> None:
        await sweep_capture_links_all_orgs()
