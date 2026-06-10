"""Internal endpoint the processor worker calls back into when a job finishes.

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
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from bimstitch_api import audit
from bimstitch_api.db import get_async_session
from bimstitch_api.email.transport import get_email_transport
from bimstitch_api.i18n import coerce_locale, t
from bimstitch_api.jobs import require_worker_secret
from bimstitch_api.models.job import _JOB_TERMINAL, Job, JobStatus
from bimstitch_api.models.notification import NotificationEventType
from bimstitch_api.models.organization import Organization
from bimstitch_api.models.project_file import (
    ExtractionStatus,
    ProjectFile,
    ProjectFileRole,
    ProjectFileStatus,
)
from bimstitch_api.models.report import _REPORT_TERMINAL, Report, ReportStatus, ReportType
from bimstitch_api.notifications.service import create_notification, publish_notification
from bimstitch_api.schemas.attachment import AttachmentCallbackRequest, AttachmentRead
from bimstitch_api.schemas.project_file import ExtractionCallbackRequest, ProjectFileRead
from bimstitch_api.schemas.report import ReportCallbackRequest, ReportResponse
from bimstitch_api.storage import StorageBackend, get_storage
from bimstitch_api.tenancy import schema_name_for

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


async def _set_tenant_schema(session: AsyncSession, organization_id: UUID) -> str:
    """Verify the org id from a worker callback exists, then set search_path
    so subsequent tenant-table operations resolve in that org's schema.

    The worker is trusted (shared-secret auth), but we still check the org
    exists to avoid silently writing to a non-existent schema if the worker
    sends a bogus id.
    """
    schema = schema_name_for(organization_id)
    # Sanity-check the schema name maps to an existing org row.
    exists = (
        await session.execute(
            select(Organization.id).where(Organization.id == organization_id)
        )
    ).scalar_one_or_none()
    if exists is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="ORG_NOT_FOUND"
        )
    # SET LOCAL — without LOCAL, the modified search_path persists on the
    # underlying connection and leaks into the next request that pulls that
    # connection from the pool, which corrupts enum casts on public tables
    # (`status = $1::organizationmemberstatus` resolves to the org's
    # duplicate enum instead of public's, and Postgres rejects the implicit
    # cross-type cast).
    await session.execute(text(f'SET LOCAL search_path TO "{schema}", public'))
    return schema


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
        await _set_tenant_schema(session, payload.organization_id)
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
                row.geometry_storage_key = payload.geometry_key
                row.edges_storage_key = payload.edges_key
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

        # Audit terminal extraction states.
        if row.extraction_status == ExtractionStatus.succeeded:
            await audit.record(
                session,
                action="project_file.extraction_succeeded",
                resource_type="project_file",
                resource_id=row.id,
                after={
                    "original_filename": row.original_filename,
                    "file_type": row.file_type.value if row.file_type else None,
                    "extraction_status": "succeeded",
                },
                actor_user_id=row.uploaded_by_user_id,
                project_id=row.project_id,
            )
        elif row.extraction_status == ExtractionStatus.failed:
            await audit.record(
                session,
                action="project_file.extraction_failed",
                resource_type="project_file",
                resource_id=row.id,
                after={
                    "original_filename": row.original_filename,
                    "file_type": row.file_type.value if row.file_type else None,
                    "extraction_error": (row.extraction_error or "")[:200],
                },
                actor_user_id=row.uploaded_by_user_id,
                project_id=row.project_id,
            )

        # Also update the Job record if a job_id was provided.
        job: Job | None = None
        if payload.job_id is not None:
            job = await _load_job_optional(session, payload.job_id)
            if job is not None and job.status not in _JOB_TERMINAL:
                _apply_job_update(job, payload)

    # Transaction committed — now create and publish notification.
    await _emit_notification(session, row, job, payload)

    # Re-anchor the search_path so the implicit refresh transaction reads
    # `project_files` out of the tenant schema (the previous SET LOCAL is
    # gone now that the wrapping transaction committed).
    schema = schema_name_for(payload.organization_id)
    async with session.begin():
        await session.execute(text(f'SET LOCAL search_path TO "{schema}", public'))
        await session.refresh(row)
    return row


def _apply_job_update(job: Job, payload: ExtractionCallbackRequest) -> None:
    if payload.status is ExtractionStatus.running:
        job.status = JobStatus.running
        if payload.started_at is not None:
            job.started_at = payload.started_at
        if payload.progress is not None:
            job.progress = payload.progress
    elif payload.status is ExtractionStatus.succeeded:
        job.status = JobStatus.succeeded
        job.finished_at = payload.finished_at
        job.progress = 100
        job.result = {
            k: v
            for k, v in {
                "fragments_key": payload.fragments_key,
                "metadata_key": payload.metadata_key,
                "properties_key": payload.properties_key,
                "geometry_key": payload.geometry_key,
                "page_count": payload.page_count,
            }.items()
            if v is not None
        }
    else:  # failed
        job.status = JobStatus.failed
        job.error = payload.error
        job.finished_at = payload.finished_at
        job.retriable = payload.retriable
        job.error_kind = payload.error_kind


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

    # Progress ticks ride the `running` callback (they carry `progress`); the
    # Job row is already updated. Suppress their notification so the bell isn't
    # spammed — only the initial `running` callback (no `progress`) notifies.
    if payload.status is ExtractionStatus.running and payload.progress is not None:
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

    # Re-anchor the search_path inside this txn — the outer callback's
    # `SET search_path` may not survive a connection check-in between
    # transactions on the same AsyncSession (`SET LOCAL` only persists until
    # commit). Using `SET LOCAL` here keeps the notification insert pinned
    # to the right tenant schema regardless of the pool state.
    schema = schema_name_for(payload.organization_id)
    async with session.begin():
        await session.execute(text(f'SET LOCAL search_path TO "{schema}", public'))
        notification = await create_notification(
            session,
            event_type=event_type,
            title=title,
            body=body,
            project_id=job.project_id if job else None,
            file_id=file.id,
            job_id=job.id if job else None,
        )

    await publish_notification(notification, organization_id=payload.organization_id)


async def _load_file(session: AsyncSession, file_id: UUID) -> ProjectFile:
    row = (
        await session.execute(
            select(ProjectFile).where(ProjectFile.id == file_id).with_for_update()
        )
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="FILE_NOT_FOUND")
    return row


async def _load_job_optional(session: AsyncSession, job_id: UUID) -> Job | None:
    return (
        await session.execute(
            select(Job).where(Job.id == job_id).with_for_update()
        )
    ).scalar_one_or_none()


# ---------------------------------------------------------------------------
# Report callback (compliance_report and future PDF report job types)
# ---------------------------------------------------------------------------


@router.post("/reports/callback", response_model=ReportResponse)
async def report_callback(
    payload: ReportCallbackRequest,
    session: AsyncSession = Depends(get_async_session),
) -> Report:
    """Worker → API callback for `compliance_report` (and later assurance_plan /
    completion_declaration / dossier) jobs.

    Same auth + RLS-bypass as the extraction callback (the worker has no
    tenant context). Idempotent on terminal statuses.
    """
    async with session.begin():
        await _set_tenant_schema(session, payload.organization_id)
        report = (
            await session.execute(
                select(Report).where(Report.id == payload.report_id).with_for_update()
            )
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
                if payload.progress is not None:
                    job.progress = payload.progress
            elif payload.status == "ready":
                job.status = JobStatus.succeeded
                job.finished_at = payload.finished_at
                job.progress = 100
                job.result = {
                    "storage_key": payload.storage_key,
                    "byte_size": payload.byte_size,
                    "sha256": payload.sha256,
                }
            else:
                job.status = JobStatus.failed
                job.error = payload.error
                job.finished_at = payload.finished_at
                job.retriable = payload.retriable
                job.error_kind = payload.error_kind

    # Outside the txn — emit the notification.
    event_type = {
        "running": NotificationEventType.job_started,
        "ready": NotificationEventType.job_succeeded,
        "failed": NotificationEventType.job_failed,
    }.get(payload.status)
    # Suppress progress-tick notifications: a `running` callback carrying
    # `progress` only updates the Job row (see `_emit_notification`'s gate).
    if payload.status == "running" and payload.progress is not None:
        event_type = None
    if event_type is not None:
        locale = coerce_locale(report.locale)
        unknown_error = t("notifications.job.unknown_error", locale)
        status_value = payload.status  # "running" | "ready" | "failed"
        notif_title = t(f"notifications.job.{status_value}.title", locale)
        notif_body = t(
            f"notifications.job.{status_value}.body",
            locale,
            report_title=report.title,
            error=(payload.error or unknown_error)[:200],
        )
        # Re-anchor search_path inside this txn (see the matching comment in
        # `_emit_notification` above — `SET LOCAL` only persists until commit,
        # and the outer callback's transaction has already closed).
        schema = schema_name_for(payload.organization_id)
        async with session.begin():
            await session.execute(
                text(f'SET LOCAL search_path TO "{schema}", public')
            )
            notification = await create_notification(
                session,
                event_type=event_type,
                title=notif_title,
                body=notif_body,
                project_id=report.project_id,
                file_id=None,
                job_id=payload.job_id,
            )
        await publish_notification(notification, organization_id=payload.organization_id)

    # Dossier (#33) is generated asynchronously and can take minutes — email the
    # requester when it's ready, on top of the in-app notification above. Email
    # failure must never break the callback (the row is already terminal).
    if (
        payload.status == "ready"
        and report.report_type is ReportType.dossier
        and report.created_by_user_id is not None
    ):
        try:
            schema = schema_name_for(payload.organization_id)
            async with session.begin():
                await session.execute(text(f'SET LOCAL search_path TO "{schema}", public'))
                recipient = (
                    await session.execute(
                        text("SELECT email FROM public.users WHERE id = :uid"),
                        {"uid": str(report.created_by_user_id)},
                    )
                ).scalar_one_or_none()
            if recipient:
                locale = coerce_locale(report.locale)
                subject = t("notifications.dossier_ready_email.subject", locale)
                body = t(
                    "notifications.dossier_ready_email.body",
                    locale,
                    title=report.title,
                )
                await get_email_transport().send(recipient, subject, body)
        except Exception:
            logger.warning(
                "Failed to send dossier-ready email for report %s", report.id, exc_info=True
            )

    # Re-anchor search_path for the refresh — `SET LOCAL` from the earlier
    # transaction has reset by now.
    schema = schema_name_for(payload.organization_id)
    async with session.begin():
        await session.execute(text(f'SET LOCAL search_path TO "{schema}", public'))
        await session.refresh(report)
    return report


# ---------------------------------------------------------------------------
# Attachment callback (image_metadata_extraction)
# ---------------------------------------------------------------------------


@router.post("/attachments/callback", response_model=AttachmentRead)
async def attachment_metadata_callback(
    payload: AttachmentCallbackRequest,
    session: AsyncSession = Depends(get_async_session),
) -> ProjectFile:
    """Worker → API callback for `image_metadata_extraction` jobs.

    Same auth + RLS-bypass as the extraction callback (the worker has no
    tenant context). Idempotent on terminal statuses.
    """
    async with session.begin():
        await _set_tenant_schema(session, payload.organization_id)
        att = (
            await session.execute(
                select(ProjectFile)
                .where(
                    ProjectFile.id == payload.attachment_id,
                    ProjectFile.role == ProjectFileRole.attachment,
                )
                .with_for_update()
            )
        ).scalar_one_or_none()
        if att is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="ATTACHMENT_NOT_FOUND",
            )

        if payload.status == "succeeded" and payload.server_metadata is not None:
            att.server_metadata = payload.server_metadata

        job = await _load_job_optional(session, payload.job_id)
        if job is not None and job.status not in _JOB_TERMINAL:
            if payload.status == "running":
                job.status = JobStatus.running
                job.started_at = payload.started_at
                if payload.progress is not None:
                    job.progress = payload.progress
            elif payload.status == "succeeded":
                job.status = JobStatus.succeeded
                job.finished_at = payload.finished_at
                job.progress = 100
                job.result = payload.server_metadata or {}
            else:
                job.status = JobStatus.failed
                job.error = payload.error
                job.finished_at = payload.finished_at
                job.retriable = payload.retriable
                job.error_kind = payload.error_kind

    async with session.begin():
        schema = schema_name_for(payload.organization_id)
        await session.execute(text(f'SET LOCAL search_path TO "{schema}", public'))
        att = (
            await session.execute(
                select(ProjectFile)
                .options(selectinload(ProjectFile.uploaded_by_user))
                .where(
                    ProjectFile.id == payload.attachment_id,
                    ProjectFile.role == ProjectFileRole.attachment,
                )
            )
        ).scalar_one()
    return att


__all__ = ["router"]
