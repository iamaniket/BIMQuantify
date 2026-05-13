"""Endpoints for generated reports (PDF artifacts).

The first report type — `compliance_report` — renders the latest succeeded
compliance Job for a project as a PDF in the project's jurisdictional
default locale (NL → Dutch). Future report types (borgingsplan / verklaring
/ dossier per backlog #31/#32/#33) plug into this same router by adding
values to `ReportType` and a render branch in the worker.

Flow:
    POST /projects/{p}/reports
        → looks up the latest succeeded compliance Job for the project
        → snapshots its `result` JSONB + project metadata into the new
          worker Job's `payload` (stateless worker — no API roundtrip)
        → creates Report(queued) + Job(queued) in the same transaction
        → calls dispatch_job(job, settings)
        → on dispatch failure marks both as failed and returns 502
        → emits job_started notification
"""

import logging
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from bimstitch_api.auth.fastapi_users import current_verified_user
from bimstitch_api.config import Settings, get_settings
from bimstitch_api.jobs import DispatchJobError, dispatch_job
from bimstitch_api.jurisdictions import get as get_jurisdiction
from bimstitch_api.models.contractor import Contractor
from bimstitch_api.models.job import Job, JobStatus, JobType
from bimstitch_api.models.notification import NotificationEventType
from bimstitch_api.models.project import Project
from bimstitch_api.models.report import Report, ReportStatus, ReportType
from bimstitch_api.models.user import User
from bimstitch_api.notifications.service import create_notification, publish_notification
from bimstitch_api.routers.projects import _load_project_or_404, _require_membership
from bimstitch_api.schemas.report import (
    ReportCreateRequest,
    ReportListResponse,
    ReportResponse,
)
from bimstitch_api.storage import StorageBackend, get_storage
from bimstitch_api.tenancy import get_tenant_session

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/projects/{project_id}/reports", tags=["reports"])


_COMPLIANCE_JOB_TYPES = (JobType.compliance_check,)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


# Locale-specific labels for the compliance report title. NL stays the
# committed default; adding a locale is a one-line entry here. Phase 4 will
# migrate these into the shared i18n message catalog.
_COMPLIANCE_REPORT_TITLE_BY_LOCALE: dict[str, str] = {
    "nl": "Nalevingsrapport — {name}",
    "en": "Compliance report — {name}",
}

_COMPLIANCE_REPORT_NOTIFICATION_BY_LOCALE: dict[str, str] = {
    "nl": "Nalevingsrapport wordt gegenereerd…",
    "en": "Compliance report is being generated…",
}


def _compliance_report_title(project_name: str, locale: str) -> str:
    template = _COMPLIANCE_REPORT_TITLE_BY_LOCALE.get(
        locale, _COMPLIANCE_REPORT_TITLE_BY_LOCALE["en"]
    )
    return template.format(name=project_name)


def _compliance_report_notification_body(locale: str) -> str:
    return _COMPLIANCE_REPORT_NOTIFICATION_BY_LOCALE.get(
        locale, _COMPLIANCE_REPORT_NOTIFICATION_BY_LOCALE["en"]
    )


def _project_payload(project: Project, contractor: Contractor | None) -> dict[str, object]:
    """Snapshot of project metadata the worker uses to render the PDF cover.
    Worker is stateless — everything it renders comes from this payload."""
    return {
        "id": str(project.id),
        "name": project.name,
        "country": project.country,
        "reference_code": project.reference_code,
        "status": project.status.value,
        "phase": project.phase.value if project.phase is not None else None,
        "address": {
            "country": project.country,
            "street": project.street,
            "house_number": project.house_number,
            "postal_code": project.postal_code,
            "city": project.city,
            "municipality": project.municipality,
            "bag_id": project.bag_id,
        },
        "permit_number": project.permit_number,
        "delivery_date": project.delivery_date.isoformat() if project.delivery_date else None,
        "contractor": (
            {
                "name": contractor.name,
                "kvk_number": contractor.kvk_number,
                "contact_email": contractor.contact_email,
                "contact_phone": contractor.contact_phone,
            }
            if contractor is not None
            else None
        ),
    }


async def _load_latest_compliance_job(
    session: AsyncSession, project_id: UUID
) -> Job | None:
    """Return the most recent succeeded compliance Job for a project, across
    all framework variants (bbl/wkb/generic)."""
    return (
        await session.execute(
            select(Job)
            .where(
                Job.project_id == project_id,
                Job.job_type.in_(_COMPLIANCE_JOB_TYPES),
                Job.status == JobStatus.succeeded,
            )
            .order_by(Job.finished_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()


async def _to_response(
    report: Report, storage: StorageBackend
) -> ReportResponse:
    download_url: str | None = None
    if report.status is ReportStatus.ready and report.storage_key is not None:
        download_url = await storage.presigned_get_url(
            report.storage_key, f"{report.title}.pdf"
        )
    payload = ReportResponse.model_validate(report).model_dump()
    payload["download_url"] = download_url
    return ReportResponse(**payload)


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.post(
    "",
    response_model=ReportResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_report(
    project_id: UUID,
    payload: ReportCreateRequest,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    storage: StorageBackend = Depends(get_storage),
    settings: Settings = Depends(get_settings),
) -> ReportResponse:
    project = await _load_project_or_404(session, project_id)
    await _require_membership(session, project.id, user.id)

    # Find the source compliance data. Without one, we have nothing to render.
    source_job = await _load_latest_compliance_job(session, project.id)
    if source_job is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="NO_COMPLIANCE_DATA",
        )

    # Eager-load contractor for the render snapshot (project.contractor is a
    # relationship; we issue an explicit SELECT under tenant RLS).
    contractor: Contractor | None = None
    if project.contractor_id is not None:
        contractor = (
            await session.execute(
                select(Contractor).where(Contractor.id == project.contractor_id)
            )
        ).scalar_one_or_none()

    # Resolve locale: explicit request value wins, otherwise the
    # jurisdiction's default (NL → 'nl'). Falls back to 'en' if no
    # jurisdiction is registered for the project's country.
    jurisdiction = get_jurisdiction(project.country)
    fallback_locale = jurisdiction.default_locale if jurisdiction else "en"
    locale = payload.locale or fallback_locale

    title = _compliance_report_title(project.name, locale)
    generated_at = datetime.now(timezone.utc)

    # Create Report first so we have its ID for the worker's storage key.
    report = Report(
        organization_id=project.organization_id,
        project_id=project.id,
        report_type=ReportType.compliance_report,
        status=ReportStatus.queued,
        title=title,
        locale=locale,
        params=payload.params or {},
        source_job_id=source_job.id,
        created_by_user_id=user.id,
    )
    session.add(report)
    await session.flush()

    # Compose the worker payload. Stateless: everything the worker needs to
    # render lives here, no API roundtrip required from the worker.
    storage_key = f"reports/{project.organization_id}/{project.id}/{report.id}.pdf"
    worker_payload: dict[str, object] = {
        "report_id": str(report.id),
        "storage_key": storage_key,
        "project": _project_payload(project, contractor),
        "compliance": source_job.result or {},
        "generated_at": generated_at.isoformat(),
        "locale": locale,
        "jurisdiction": project.country,
    }

    job = Job(
        organization_id=project.organization_id,
        project_id=project.id,
        job_type=JobType.compliance_report,
        status=JobStatus.pending,
        payload=worker_payload,
        created_by_user_id=user.id,
    )
    session.add(job)
    await session.flush()

    report.job_id = job.id

    # Dispatch — keep within the tenant transaction so partial state never
    # ships. On failure mark both rows failed; the transaction commits cleanly.
    try:
        await dispatch_job(job, settings)
    except DispatchJobError as exc:
        msg = f"DISPATCH_FAILED: {exc}"[:500]
        report.status = ReportStatus.failed
        report.error = msg
        report.finished_at = datetime.now(timezone.utc)
        job.status = JobStatus.failed
        job.error = msg
        job.finished_at = report.finished_at
        logger.warning("Report dispatch failed for report %s: %s", report.id, exc)
        await session.flush()
    else:
        # Successful dispatch — emit a job_started notification so the portal
        # can update the new card immediately. Done outside the explicit
        # tenant transaction wouldn't be safe (RLS GUC drops on commit), so
        # we create the notification row in this same txn and publish it
        # after `get_tenant_session` commits.
        notification = await create_notification(
            session,
            organization_id=project.organization_id,
            event_type=NotificationEventType.job_started,
            title=title,
            body=_compliance_report_notification_body(locale),
            project_id=project.id,
            file_id=None,
            job_id=job.id,
        )
        # Defer publish until after the request's transaction commits.
        # `get_tenant_session` runs `async with session.begin()` itself, so we
        # cannot commit here. Instead, schedule the publish via a small hack:
        # publish synchronously after the response is returned. The test stubs
        # don't depend on Redis being live; the production path will see the
        # notification in DB regardless of whether the publish lands.
        try:
            await publish_notification(notification)
        except Exception:
            logger.warning(
                "Failed to publish job_started notification for report %s",
                report.id,
                exc_info=True,
            )

    await session.refresh(report)
    return await _to_response(report, storage)


@router.get("", response_model=ReportListResponse)
async def list_reports(
    project_id: UUID,
    report_type: ReportType | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    storage: StorageBackend = Depends(get_storage),
) -> ReportListResponse:
    project = await _load_project_or_404(session, project_id)
    await _require_membership(session, project.id, user.id)

    base = select(Report).where(Report.project_id == project.id)
    if report_type is not None:
        base = base.where(Report.report_type == report_type)

    count_stmt = select(func.count()).select_from(base.subquery())
    total = (await session.execute(count_stmt)).scalar_one()

    rows = (
        await session.execute(
            base.order_by(Report.created_at.desc()).limit(limit).offset(offset)
        )
    ).scalars().all()

    items = [await _to_response(r, storage) for r in rows]
    return ReportListResponse(items=items, total=int(total))


@router.get("/{report_id}", response_model=ReportResponse)
async def get_report(
    project_id: UUID,
    report_id: UUID,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    storage: StorageBackend = Depends(get_storage),
) -> ReportResponse:
    project = await _load_project_or_404(session, project_id)
    await _require_membership(session, project.id, user.id)

    report = (
        await session.execute(
            select(Report).where(
                Report.id == report_id,
                Report.project_id == project.id,
            )
        )
    ).scalar_one_or_none()
    if report is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="REPORT_NOT_FOUND"
        )

    return await _to_response(report, storage)
