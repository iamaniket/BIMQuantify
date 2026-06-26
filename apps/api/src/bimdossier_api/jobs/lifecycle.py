"""Generic job retry + cancel state machine, shared across all async job types.

`retry_job` and `cancel_job` are job-type-agnostic: they operate on the `Job`
row and delegate the type-specific resource transitions (ProjectFile,
Report, …) to a small adapter table keyed by `JobType`. This is the single
place that knows how to reset/fail/clear the resource a job feeds, so the
file-extraction, report, and attachment paths stay in lockstep.

Both functions run inside the caller's `get_tenant_session` transaction —
they only flush, never commit (the tenant rule). On a failed re-dispatch the
resource is rolled forward to `failed` so the row never sticks in `queued`.
"""

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from bimdossier_api.config import Settings
from bimdossier_api.jobs import (
    DispatchJobError,
    JobConcurrencyError,
    cancel_dispatched_job,
    check_job_concurrency,
    dispatch_job,
)
from bimdossier_api.models.job import Job, JobStatus
from bimdossier_api.models.job import JobType as JobType
from bimdossier_api.models.project_file import ExtractionStatus, ProjectFile
from bimdossier_api.models.report import Report, ReportStatus
from bimdossier_api.models.user import User

_CANCELLABLE: frozenset[JobStatus] = frozenset({JobStatus.pending, JobStatus.started})


# ---------------------------------------------------------------------------
# Per-type resource adapters
# ---------------------------------------------------------------------------


async def _load_file(session: AsyncSession, job: Job) -> ProjectFile | None:
    if job.file_id is None:
        return None
    return (
        await session.execute(
            select(ProjectFile).where(ProjectFile.id == job.file_id).with_for_update()
        )
    ).scalar_one_or_none()


async def _reset_file(session: AsyncSession, old_job: Job, new_job: Job) -> None:
    row = await _load_file(session, old_job)
    if row is None:
        return
    row.extraction_status = ExtractionStatus.queued
    row.extraction_error = None
    row.extraction_started_at = None
    row.extraction_finished_at = None


async def _fail_file(session: AsyncSession, job: Job, message: str) -> None:
    row = await _load_file(session, job)
    if row is None:
        return
    row.extraction_status = ExtractionStatus.failed
    row.extraction_error = message


async def _load_report(session: AsyncSession, job: Job) -> Report | None:
    report_id = (job.payload or {}).get("report_id")
    if report_id is None:
        return None
    return (
        await session.execute(
            select(Report).where(Report.id == UUID(str(report_id))).with_for_update()
        )
    ).scalar_one_or_none()


async def _reset_report(session: AsyncSession, old_job: Job, new_job: Job) -> None:
    row = await _load_report(session, old_job)
    if row is None:
        return
    row.status = ReportStatus.queued
    row.error = None
    row.finished_at = None
    row.storage_key = None
    row.byte_size = None
    row.sha256 = None
    # Re-point the report at the fresh rendering job so the portal associates
    # the new run with this report.
    row.job_id = new_job.id


async def _fail_report(session: AsyncSession, job: Job, message: str) -> None:
    row = await _load_report(session, job)
    if row is None:
        return
    row.status = ReportStatus.failed
    row.error = message
    row.finished_at = datetime.now(UTC)


async def _noop_reset(session: AsyncSession, old_job: Job, new_job: Job) -> None:
    return None


async def _noop_fail(session: AsyncSession, job: Job, message: str) -> None:
    return None


@dataclass(frozen=True)
class _ResourceOps:
    # Roll the linked resource back to its "queued" state for a fresh attempt.
    reset: Callable[[AsyncSession, Job, Job], Awaitable[None]]
    # Mark the linked resource failed (used when re-dispatch can't reach the worker).
    fail: Callable[[AsyncSession, Job, str], Awaitable[None]]


# Job types absent from this table are not retryable (verification,
# batch_update, compliance_check run synchronously / have no worker dispatch).
_RESOURCE_OPS: dict[JobType, _ResourceOps] = {
    JobType.ifc_extraction: _ResourceOps(_reset_file, _fail_file),
    JobType.pdf_extraction: _ResourceOps(_reset_file, _fail_file),
    JobType.dxf_extraction: _ResourceOps(_reset_file, _fail_file),
    JobType.compliance_report: _ResourceOps(_reset_report, _fail_report),
    JobType.image_metadata_extraction: _ResourceOps(_noop_reset, _noop_fail),
}


def is_retryable_type(job_type: JobType) -> bool:
    return job_type in _RESOURCE_OPS


# ---------------------------------------------------------------------------
# Public operations
# ---------------------------------------------------------------------------


async def retry_job(
    session: AsyncSession,
    job: Job,
    *,
    settings: Settings,
    organization_id: UUID,
    user: User,
) -> Job:
    """Spawn a fresh Job to re-run a failed, retriable job.

    The old failed Job is left intact as history; the new one carries
    `retry_of` lineage and an incremented `attempt`. Raises 409 if the job is
    not in a retryable terminal state, or 429 if the org is at its job limit.
    """
    if job.status is not JobStatus.failed:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="JOB_NOT_FAILED")
    if not job.retriable:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="JOB_NOT_RETRIABLE")
    ops = _RESOURCE_OPS.get(job.job_type)
    if ops is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="JOB_TYPE_NOT_RETRYABLE"
        )

    try:
        await check_job_concurrency(session, settings)
    except JobConcurrencyError as exc:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="TOO_MANY_ACTIVE_JOBS"
        ) from exc

    new_job = Job(
        project_id=job.project_id,
        file_id=job.file_id,
        job_type=job.job_type,
        status=JobStatus.pending,
        payload={**(job.payload or {}), "retry": True},
        retry_of=job.id,
        attempt=job.attempt + 1,
        created_by_user_id=user.id,
    )
    session.add(new_job)
    await session.flush()

    await ops.reset(session, job, new_job)
    await session.flush()

    try:
        await dispatch_job(new_job, settings, organization_id)
    except DispatchJobError as exc:
        message = f"DISPATCH_FAILED: {exc}"[:500]
        new_job.status = JobStatus.failed
        new_job.error = message
        new_job.retriable = True
        new_job.error_kind = "dispatch"
        new_job.finished_at = datetime.now(UTC)
        await ops.fail(session, new_job, message)
        await session.flush()

    return new_job


async def cancel_job(
    session: AsyncSession,
    job: Job,
    *,
    settings: Settings,
) -> Job:
    """Cancel a still-queued job. Only valid before the worker picks it up.

    Asks the processor to drop the BullMQ job. If it already started running
    (409 from the processor), raises `JOB_ALREADY_RUNNING` and leaves the job
    untouched — the worker's own callback will carry it to a terminal state.
    """
    if job.status not in _CANCELLABLE:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="JOB_NOT_CANCELLABLE"
        )

    result = await cancel_dispatched_job(job.id, settings)
    if result == "already_running":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="JOB_ALREADY_RUNNING"
        )

    job.status = JobStatus.cancelled
    job.finished_at = datetime.now(UTC)
    ops = _RESOURCE_OPS.get(job.job_type)
    if ops is not None:
        # Reuse the failure transition with a CANCELLED marker so the linked
        # resource leaves its non-terminal state (no separate resource enum value).
        await ops.fail(session, job, "CANCELLED")
    await session.flush()
    return job
