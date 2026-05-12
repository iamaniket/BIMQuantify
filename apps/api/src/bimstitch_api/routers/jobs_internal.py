"""Internal endpoint the import-export worker calls back into when a job finishes.

Auth: shared bearer token via `require_worker_secret`. No user auth.

This router does NOT use `get_tenant_session` because the worker has no
tenant context. The connecting Postgres role is a superuser, which bypasses
RLS, so the system session can update any project_files row.

Status machine:
    queued    → running, succeeded, failed
    running   → succeeded, failed
    succeeded → (terminal — callback is no-op + 200)
    failed    → (terminal — callback is no-op + 200)
"""

import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from bimstitch_api.db import get_async_session
from bimstitch_api.jobs import require_worker_secret
from bimstitch_api.models.job import _JOB_TERMINAL, Job, JobStatus
from bimstitch_api.models.notification import NotificationEventType
from bimstitch_api.models.project_file import ExtractionStatus, ProjectFile, ProjectFileStatus
from bimstitch_api.models.report import _REPORT_TERMINAL, Report, ReportStatus
from bimstitch_api.notifications.service import create_notification, publish_notification
from bimstitch_api.schemas.project_file import ExtractionCallbackRequest, ProjectFileRead
from bimstitch_api.schemas.report import ReportCallbackRequest, ReportResponse
from bimstitch_api.storage import StorageBackend, get_storage

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/internal/jobs",
    tags=["internal-jobs"],
    dependencies=[Depends(require_worker_secret)],
)


_TERMINAL = {ExtractionStatus.succeeded, ExtractionStatus.failed}
_VALID_INCOMING = {
    ExtractionStatus.running,
    ExtractionStatus.succeeded,
    ExtractionStatus.failed,
}


@router.post("/callback", response_model=ProjectFileRead)
async def extraction_callback(
    payload: ExtractionCallbackRequest,
    session: AsyncSession = Depends(get_async_session),
    storage: StorageBackend = Depends(get_storage),
) -> ProjectFile:
    if payload.status not in _VALID_INCOMING:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="INVALID_CALLBACK_STATUS",
        )

    async with session.begin():
        row = await _load_file(session, payload.file_id)

        if row.extraction_status in _TERMINAL:
            # Idempotent no-op. Don't overwrite what we already recorded.
            return row

        if payload.status is ExtractionStatus.running:
            row.extraction_status = ExtractionStatus.running
            if payload.started_at is not None:
                row.extraction_started_at = payload.started_at
            if payload.extractor_version is not None:
                row.extractor_version = payload.extractor_version
        elif payload.status is ExtractionStatus.succeeded:
            # Hash mismatch is a contract violation: the client claimed hash X
            # at /initiate, but the bytes the extractor pulled hash to Y.
            # Reject without persisting any extraction artifacts and delete
            # the storage object — this is the only thing protecting the dedup
            # invariant from a malicious client.
            if (
                payload.content_sha256 is not None
                and row.content_sha256 is not None
                and payload.content_sha256 != row.content_sha256
            ):
                row.status = ProjectFileStatus.rejected
                row.rejection_reason = "CONTENT_HASH_MISMATCH"
                row.extraction_status = ExtractionStatus.failed
                row.extraction_error = (
                    f"hash mismatch: client claimed {row.content_sha256[:16]}…, "
                    f"extractor computed {payload.content_sha256[:16]}…"
                )
                if payload.started_at is not None:
                    row.extraction_started_at = payload.started_at
                if payload.finished_at is not None:
                    row.extraction_finished_at = payload.finished_at
                if payload.extractor_version is not None:
                    row.extractor_version = payload.extractor_version
                try:
                    await storage.delete_object(row.storage_key)
                except Exception:
                    logger.warning(
                        "Failed to delete object %s after hash mismatch; row marked rejected",
                        row.storage_key,
                        exc_info=True,
                    )
            else:
                row.extraction_status = ExtractionStatus.succeeded
                row.fragments_storage_key = payload.fragments_key
                row.metadata_storage_key = payload.metadata_key
                row.properties_storage_key = payload.properties_key
                row.extraction_error = None
                if payload.ifc_project_guid is not None:
                    row.ifc_project_guid = payload.ifc_project_guid
                if payload.started_at is not None:
                    row.extraction_started_at = payload.started_at
                if payload.finished_at is not None:
                    row.extraction_finished_at = payload.finished_at
                if payload.extractor_version is not None:
                    row.extractor_version = payload.extractor_version
        else:  # failed
            row.extraction_status = ExtractionStatus.failed
            row.extraction_error = payload.error
            if payload.started_at is not None:
                row.extraction_started_at = payload.started_at
            if payload.finished_at is not None:
                row.extraction_finished_at = payload.finished_at
            if payload.extractor_version is not None:
                row.extractor_version = payload.extractor_version

        # Also update the Job record if a job_id was provided.
        job: Job | None = None
        if payload.job_id is not None:
            job = await _load_job_optional(session, payload.job_id)
            if job is not None and job.status not in _JOB_TERMINAL:
                _apply_job_update(job, payload)

    # Transaction committed — now create and publish notification.
    await _emit_notification(session, row, job, payload)

    await session.refresh(row)
    return row


def _apply_job_update(job: Job, payload: ExtractionCallbackRequest) -> None:
    if payload.status is ExtractionStatus.running:
        job.status = JobStatus.running
        if payload.started_at is not None:
            job.started_at = payload.started_at
    elif payload.status is ExtractionStatus.succeeded:
        job.status = JobStatus.succeeded
        job.finished_at = payload.finished_at
        job.result = {
            k: v
            for k, v in {
                "fragments_key": payload.fragments_key,
                "metadata_key": payload.metadata_key,
                "properties_key": payload.properties_key,
                "page_count": payload.page_count,
            }.items()
            if v is not None
        }
    else:  # failed
        job.status = JobStatus.failed
        job.error = payload.error
        job.finished_at = payload.finished_at


_EVENT_MAP: dict[ExtractionStatus, NotificationEventType] = {
    ExtractionStatus.running: NotificationEventType.job_started,
    ExtractionStatus.succeeded: NotificationEventType.job_succeeded,
    ExtractionStatus.failed: NotificationEventType.job_failed,
}

_TITLE_MAP: dict[ExtractionStatus, str] = {
    ExtractionStatus.running: "Extraction started",
    ExtractionStatus.succeeded: "Extraction completed",
    ExtractionStatus.failed: "Extraction failed",
}


async def _emit_notification(
    session: AsyncSession,
    file: ProjectFile,
    job: Job | None,
    payload: ExtractionCallbackRequest,
) -> None:
    event_type = _EVENT_MAP.get(payload.status)
    if event_type is None:
        return

    title = _TITLE_MAP[payload.status]
    filename = file.original_filename
    if payload.status is ExtractionStatus.running:
        body = f"{filename} extraction is in progress"
    elif payload.status is ExtractionStatus.succeeded:
        body = f"{filename} is ready to view"
    else:
        snippet = (payload.error or "unknown error")[:200]
        body = f"{filename} extraction failed: {snippet}"

    # Resolve the org id and create the notification inside one transaction.
    # `_resolve_org_id` issues a SELECT which auto-begins, so we use that
    # auto-begun transaction as the unit of work instead of an explicit
    # `session.begin()` (which would conflict with the auto-begin).
    org_id = job.organization_id if job is not None else await _resolve_org_id(session, file)
    if org_id is None:
        return
    notification = await create_notification(
        session,
        organization_id=org_id,
        event_type=event_type,
        title=title,
        body=body,
        project_id=job.project_id if job else None,
        file_id=file.id,
        job_id=job.id if job else None,
    )
    await session.commit()

    await publish_notification(notification)


async def _resolve_org_id(session: AsyncSession, file: ProjectFile) -> UUID | None:
    from bimstitch_api.models.model import Model
    from bimstitch_api.models.project import Project

    row = (
        await session.execute(
            select(Project.organization_id)
            .join(Model, Model.project_id == Project.id)
            .where(Model.id == file.model_id)
        )
    ).scalar_one_or_none()
    return row


async def _load_file(session: AsyncSession, file_id: UUID) -> ProjectFile:
    row = (
        await session.execute(select(ProjectFile).where(ProjectFile.id == file_id))
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="FILE_NOT_FOUND")
    return row


async def _load_job_optional(session: AsyncSession, job_id: UUID) -> Job | None:
    return (await session.execute(select(Job).where(Job.id == job_id))).scalar_one_or_none()


# ---------------------------------------------------------------------------
# Report callback (compliance_report and future PDF report job types)
# ---------------------------------------------------------------------------


@router.post("/reports/callback", response_model=ReportResponse)
async def report_callback(
    payload: ReportCallbackRequest,
    session: AsyncSession = Depends(get_async_session),
) -> Report:
    """Worker → API callback for `compliance_report` (and later borgingsplan /
    verklaring / dossier) jobs.

    Same auth + RLS-bypass as the extraction callback (the worker has no
    tenant context). Idempotent on terminal statuses.
    """
    async with session.begin():
        report = (
            await session.execute(select(Report).where(Report.id == payload.report_id))
        ).scalar_one_or_none()
        if report is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="REPORT_NOT_FOUND"
            )

        if report.status in _REPORT_TERMINAL:
            return report  # idempotent no-op

        if payload.status == "running":
            report.status = ReportStatus.running
        elif payload.status == "ready":
            if not payload.storage_key:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="MISSING_STORAGE_KEY",
                )
            report.status = ReportStatus.ready
            report.storage_key = payload.storage_key
            report.byte_size = payload.byte_size
            report.sha256 = payload.sha256
            report.error = None
            report.finished_at = payload.finished_at
        else:  # failed
            report.status = ReportStatus.failed
            report.error = payload.error
            report.finished_at = payload.finished_at

        # Mirror the status onto the Job row.
        job = await _load_job_optional(session, payload.job_id)
        if job is not None and job.status not in _JOB_TERMINAL:
            if payload.status == "running":
                job.status = JobStatus.running
                job.started_at = payload.started_at
            elif payload.status == "ready":
                job.status = JobStatus.succeeded
                job.finished_at = payload.finished_at
                job.result = {
                    "storage_key": payload.storage_key,
                    "byte_size": payload.byte_size,
                    "sha256": payload.sha256,
                }
            else:
                job.status = JobStatus.failed
                job.error = payload.error
                job.finished_at = payload.finished_at

    # Outside the txn — emit the notification.
    event_type = {
        "running": NotificationEventType.job_started,
        "ready": NotificationEventType.job_succeeded,
        "failed": NotificationEventType.job_failed,
    }.get(payload.status)
    if event_type is not None:
        title_map = {
            "running": "Rapport wordt gegenereerd",
            "ready": "Rapport gereed",
            "failed": "Genereren van rapport mislukt",
        }
        body_map = {
            "running": f"{report.title} wordt gegenereerd…",
            "ready": f"{report.title} is gereed om te bekijken",
            "failed": f"{report.title}: {(payload.error or 'onbekende fout')[:200]}",
        }
        notification = await create_notification(
            session,
            organization_id=report.organization_id,
            event_type=event_type,
            title=title_map[payload.status],
            body=body_map[payload.status],
            project_id=report.project_id,
            file_id=None,
            job_id=payload.job_id,
        )
        await session.commit()
        await publish_notification(notification)

    await session.refresh(report)
    return report


__all__ = ["router"]
