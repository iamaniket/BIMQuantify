"""Background sweep that force-fails abandoned jobs and reports.

The worker callbacks (`running` -> `succeeded`/`failed`) are the happy path
for moving a `Job`/`Report` row to a terminal state. They miss one class of
failure entirely: the worker process dies (OOM, crash, redeploy) *between*
the `running` callback and the terminal one, or the terminal callback POST
never lands. The row is then stuck in `pending`/`started`/`running` (or a
report in `queued`/`running`) forever, and the UI shows a spinner that never
resolves.

This sweep is the reconciliation backstop. On an interval it walks every
active org schema and force-fails any active row whose `created_at` is older
than the stuck-job timeout. The timeout is anchored on `created_at` (the one
timestamp that is always set) and defaults well above the worst-case
legitimate runtime — `JOB_TIMEOUT_MS` (10 min) times BullMQ's retry count —
so a job that is merely slow or mid-retry is never reaped.

Idempotent by construction: the queries only match non-terminal rows, so a
row already flipped to `failed` is invisible to the next sweep.

Mirrors `DeadlineReminderSweeper` / `InvitationExpirySweeper`: an asyncio task
on a configurable interval inside the API process lifespan. Runs as the
superuser role with `SET LOCAL search_path` per org (no `bim_app` role, no
tenant GUCs) — the same cross-tenant pattern the deadline sweep uses, since
there is no request-scoped tenant context for a background job.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import select, text

from bimstitch_api.db import get_session_maker
from bimstitch_api.models.job import Job, JobStatus
from bimstitch_api.models.organization import Organization, OrganizationStatus
from bimstitch_api.models.project_file import ExtractionStatus, ProjectFile
from bimstitch_api.models.report import Report, ReportStatus

logger = logging.getLogger(__name__)

# Non-terminal states. A row sitting in one of these past the cutoff is
# treated as abandoned (the worker crashed or its callback never arrived).
_STUCK_JOB_STATES: frozenset[JobStatus] = frozenset(
    {JobStatus.pending, JobStatus.started, JobStatus.running}
)
_STUCK_REPORT_STATES: frozenset[ReportStatus] = frozenset(
    {ReportStatus.queued, ReportStatus.running}
)
_STUCK_EXTRACTION_STATES: frozenset[ExtractionStatus] = frozenset(
    {ExtractionStatus.queued, ExtractionStatus.running}
)

_JOB_REASON = (
    "Force-failed by the reconciliation sweep: the job exceeded the stuck-job "
    "timeout without reaching a terminal state (the worker likely crashed or "
    "its callback never arrived)."
)
_FILE_REASON = (
    "Extraction never completed and was force-failed by the reconciliation "
    "sweep after its job was reaped."
)
_REPORT_REASON = (
    "Report generation never completed and was force-failed by the "
    "reconciliation sweep."
)


async def _sweep_org(schema: str, stuck_timeout_minutes: int) -> int:
    """Force-fail abandoned jobs and reports in one tenant schema.

    Returns the number of job + report rows flipped to `failed` (the linked
    file cascade is a side effect and is not counted).
    """
    session_maker = get_session_maker()
    now = datetime.now(UTC)
    cutoff = now - timedelta(minutes=stuck_timeout_minutes)
    failed = 0

    async with session_maker() as session, session.begin():
        await session.execute(text(f'SET LOCAL search_path = "{schema}", public'))

        # --- Jobs ---
        stuck_jobs = list(
            (
                await session.execute(
                    select(Job).where(
                        Job.status.in_(_STUCK_JOB_STATES),
                        Job.created_at < cutoff,
                    )
                )
            )
            .scalars()
            .all()
        )

        file_ids: set[UUID] = set()
        for job in stuck_jobs:
            job.status = JobStatus.failed
            job.error = _JOB_REASON
            job.finished_at = now
            if job.file_id is not None:
                file_ids.add(job.file_id)
        failed += len(stuck_jobs)

        # --- Cascade: an extraction file whose job was just reaped ---
        if file_ids:
            stuck_files = (
                (
                    await session.execute(
                        select(ProjectFile).where(
                            ProjectFile.id.in_(file_ids),
                            ProjectFile.extraction_status.in_(_STUCK_EXTRACTION_STATES),
                        )
                    )
                )
                .scalars()
                .all()
            )
            for file in stuck_files:
                file.extraction_status = ExtractionStatus.failed
                file.extraction_error = _FILE_REASON
                file.extraction_finished_at = now

        # --- Reports (swept independently of the job sweep above) ---
        stuck_reports = list(
            (
                await session.execute(
                    select(Report).where(
                        Report.status.in_(_STUCK_REPORT_STATES),
                        Report.created_at < cutoff,
                    )
                )
            )
            .scalars()
            .all()
        )
        for report in stuck_reports:
            report.status = ReportStatus.failed
            report.error = _REPORT_REASON
            report.finished_at = now
        failed += len(stuck_reports)

    return failed


async def sweep_all_orgs(stuck_timeout_minutes: int) -> int:
    """One-shot reconciliation across all active orgs. Returns rows failed."""
    session_maker = get_session_maker()

    async with session_maker() as session:
        result = await session.execute(
            select(Organization.id, Organization.schema_name).where(
                Organization.status == OrganizationStatus.active,
                Organization.deleted_at.is_(None),
            )
        )
        orgs = list(result.all())

    total = 0
    for org_id, schema in orgs:
        try:
            total += await _sweep_org(schema, stuck_timeout_minutes)
        except Exception:
            logger.exception("Job reconciliation failed for org %s", org_id)

    if total:
        logger.info(
            "job_reconcile: force-failed %d stuck rows across %d orgs", total, len(orgs)
        )
    return total


class JobReconcileSweeper:
    """Runs ``sweep_all_orgs`` on an interval inside the API process.

    Mirrors ``DeadlineReminderSweeper``: ``start()`` schedules the task,
    ``stop()`` cancels and awaits it. Set ``interval_minutes=0`` to disable.
    """

    def __init__(self, interval_minutes: int, stuck_timeout_minutes: int) -> None:
        self.interval_seconds = interval_minutes * 60
        self.stuck_timeout_minutes = stuck_timeout_minutes
        self._task: asyncio.Task[None] | None = None

    async def _loop(self) -> None:
        while True:
            try:
                await asyncio.sleep(self.interval_seconds)
                await sweep_all_orgs(self.stuck_timeout_minutes)
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("job_reconcile loop iteration failed")

    def start(self) -> None:
        if self.interval_seconds <= 0:
            logger.info("job_reconcile sweeper disabled (interval=0)")
            return
        if self._task is not None:
            return
        self._task = asyncio.create_task(self._loop(), name="job_reconcile_sweeper")

    async def stop(self) -> None:
        if self._task is None:
            return
        self._task.cancel()
        try:
            await self._task
        except asyncio.CancelledError:
            pass
        self._task = None
