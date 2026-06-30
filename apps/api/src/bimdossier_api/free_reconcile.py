"""Reconciliation backstop for stuck free-tier extractions.

`JobReconcileSweeper` walks per-org tenant schemas and only sees tenant `Job`
rows — free extractions have no `Job` row and live in `public.pooled_project_files`,
so they need their own sweep. If the worker dies between the `running` and
terminal free callback (or the terminal POST is lost), a free file sits in
`queued`/`running` forever and the free viewer spins.

This sweep force-fails any free file stuck in a non-terminal extraction state
whose `updated_at` (the timestamp of its last state change — set when it flips
to `queued`/`running`) is older than the stuck-job timeout. Idempotent: the
query only matches non-terminal rows. Runs as the superuser (RLS-bypassing,
cross-user) — the deliberate pattern for a background job with no request-scoped
user context, mirroring `jobs/reconcile.py`.

The idle reaper keys on the CONTAINER (`pooled_documents.last_viewed_at`, stamped
by the viewer-bundle GET): an untouched container past the TTL is deleted (its
files + snags cascade) along with its object prefix.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING

from sqlalchemy import and_, or_, select
from sqlalchemy import delete as sql_delete

from bimdossier_api.background.periodic import PeriodicSweeper
from bimdossier_api.db import get_session_maker
from bimdossier_api.models.free_document import PooledDocument
from bimdossier_api.models.free_project_file import PooledProjectFile
from bimdossier_api.storage import get_storage

if TYPE_CHECKING:
    from bimdossier_api.storage import StorageBackend

logger = logging.getLogger(__name__)

_STUCK_STATES = ("queued", "running")
_REASON = (
    "Force-failed by the free-tier reconciliation sweep: extraction exceeded the "
    "stuck-job timeout without a terminal callback (the worker likely crashed or "
    "its callback never arrived)."
)


async def sweep_stuck_free_extractions(stuck_timeout_minutes: int) -> int:
    """Force-fail abandoned free extractions. Returns the number flipped."""
    session_maker = get_session_maker()
    now = datetime.now(UTC)
    cutoff = now - timedelta(minutes=stuck_timeout_minutes)

    async with session_maker() as session, session.begin():
        # FOR UPDATE SKIP LOCKED: the live free callback locks the row with
        # `with_for_update` and re-checks terminal state, so skip any row a
        # callback is actively finishing rather than clobber it (same M-con1
        # rationale as jobs/reconcile.py).
        stuck = list(
            (
                await session.execute(
                    select(PooledProjectFile)
                    .where(
                        PooledProjectFile.extraction_status.in_(_STUCK_STATES),
                        PooledProjectFile.updated_at < cutoff,
                    )
                    .with_for_update(skip_locked=True)
                )
            )
            .scalars()
            .all()
        )
        for row in stuck:
            row.extraction_status = "failed"
            row.extraction_error = _REASON

    if stuck:
        logger.info("free_reconcile: force-failed %d stuck free extractions", len(stuck))
    return len(stuck)


class FreeExtractionReconcileSweeper(PeriodicSweeper):
    """Runs ``sweep_stuck_free_extractions`` on an interval. Leader-elected via
    advisory lock (only one instance runs each cycle). ``interval_minutes=0``
    disables it."""

    def __init__(self, interval_minutes: int, stuck_timeout_minutes: int) -> None:
        super().__init__(
            name="free_extraction_reconcile_sweeper",
            interval_seconds=interval_minutes * 60,
            lock_key="sweep:free_reconcile",
        )
        self.stuck_timeout_minutes = stuck_timeout_minutes

    async def run_once(self) -> None:
        await sweep_stuck_free_extractions(self.stuck_timeout_minutes)


async def sweep_idle_free_containers(
    ttl_days: int, storage: StorageBackend | None = None
) -> int:
    """Delete free containers with no viewer activity for ``ttl_days`` + their S3
    objects. Idle = ``last_viewed_at`` older than the cutoff, or never viewed and
    created before it. Storage cleanup is best-effort (logged on failure); the DB
    row delete cascades pooled_project_files + pooled_findings. ``storage`` is injectable
    for tests.

    Returns the number of containers reaped.
    """
    session_maker = get_session_maker()
    store = storage if storage is not None else get_storage()
    now = datetime.now(UTC)
    cutoff = now - timedelta(days=ttl_days)

    async with session_maker() as session:
        rows = (
            await session.execute(
                select(PooledDocument.id, PooledDocument.owner_user_id).where(
                    or_(
                        PooledDocument.last_viewed_at < cutoff,
                        and_(
                            PooledDocument.last_viewed_at.is_(None),
                            PooledDocument.created_at < cutoff,
                        ),
                    )
                )
            )
        ).all()

    reaped = 0
    for document_id, owner_id in rows:
        prefix = f"free/{owner_id}/{document_id}/"
        try:
            await store.delete_prefix(prefix)
        except Exception:
            logger.exception(
                "free_reconcile: idle reap could not delete objects for %s", document_id
            )
        async with session_maker() as session, session.begin():
            await session.execute(
                sql_delete(PooledDocument).where(PooledDocument.id == document_id)
            )
        reaped += 1

    if reaped:
        logger.info("free_reconcile: idle-reaped %d free containers", reaped)
    return reaped


class IdleFreeContainerSweeper(PeriodicSweeper):
    """Deletes idle free containers (+ objects) past the TTL on an interval.
    Leader-elected; ``interval_minutes=0`` disables it."""

    def __init__(self, interval_minutes: int, idle_ttl_days: int) -> None:
        super().__init__(
            name="idle_free_container_sweeper",
            interval_seconds=interval_minutes * 60,
            lock_key="sweep:free_idle",
        )
        self.idle_ttl_days = idle_ttl_days

    async def run_once(self) -> None:
        await sweep_idle_free_containers(self.idle_ttl_days)
