"""Free-tier snag-list PDF reports — pooled `public.pooled_reports`.

The free mirror of the paid snag-list report (`routers/reports/`): a pooled
report row + a detached Job dispatched to the SAME processor snag-list pipeline
(templates, locale labels, puppeteer render all reused — zero worker forks). The
job payload carries ``callback_path`` so the worker's report callback lands on
`/internal/jobs/pooled-report-callback` instead of the tenant one.

Surface (mirrors the paid `/projects/{id}/reports` shape so future free report
types slot in and the paid `ReportResponse` schema is reused verbatim):

  POST /pooled/projects/{id}/reports        → ReportResponse (v1: all findings)
  GET  /pooled/projects/{id}/reports        → ReportListResponse
  GET  /pooled/projects/{id}/reports/{rid}  → ReportResponse (presigned when ready)

Create = owner + editor (who can write snags can export them); list/download =
every participant incl. viewers (the CSV-export audience). The CREATE path runs
on the SUPERUSER session — assignee display names live in `users`, which
per-user RLS blanks for other participants (same rationale as the CSV export in
pooled_projects.py) — so every query carries hand-rolled participant/owner
predicates (the free_access hard rule). Reads run on the pooled RLS session.

No trial-expiry gate: a report is an export of existing data, consistent with
the "field loop forever" expiry model (only new-asset creation expires).

Watermark: free PDFs pass a minimal ``template.branding.footer_text`` ("Made
with BimDossier", localized) through the existing template branding seam — the
worker renders it in the page footer; logo/cover no-op without keys.
"""

import logging
from datetime import UTC, datetime
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from bimdossier_api.auth.fastapi_users import current_verified_user
from bimdossier_api.auth.ratelimit import FREE_REPORT_GEN_LIMITER
from bimdossier_api.config import Settings, get_settings
from bimdossier_api.db import get_async_session, get_session_maker
from bimdossier_api.i18n import coerce_locale, t
from bimdossier_api.i18n.resolution import resolve_user_locale
from bimdossier_api.jobs import require_worker_secret
from bimdossier_api.jobs.dispatcher import DispatchJobError, dispatch_job
from bimdossier_api.jobs.priority import (
    FREE_TIER_SENTINEL_ORG,
    POOLED_REPORT_CALLBACK_PATH,
    JobTier,
)
from bimdossier_api.models.job import Job, JobStatus, JobType
from bimdossier_api.models.pooled_attachment import PooledAttachment
from bimdossier_api.models.pooled_finding import PooledFinding
from bimdossier_api.models.pooled_project import PooledProject
from bimdossier_api.models.pooled_project_member import PooledProjectMember
from bimdossier_api.models.pooled_report import PooledReport
from bimdossier_api.models.report import ReportStatus, ReportType
from bimdossier_api.models.user import User
from bimdossier_api.notifications.pooled_service import emit_pooled_report_notification
from bimdossier_api.routers.free_access import require_free_tier_enabled
from bimdossier_api.routers.pooled_projects import (
    _assert_pooled_participant,
    _load_accessible_pooled_project_or_404,
    _load_pooled_project_superuser_or_404,
    _load_project_snags,
    _resolve_pooled_user_names,
)
from bimdossier_api.schemas.report import ReportListResponse, ReportResponse
from bimdossier_api.storage import StorageBackend, get_storage
from bimdossier_api.storage.scoping import (
    assert_key_scoped,
    assert_pooled_key_scoped,
    pooled_key_prefix,
)
from bimdossier_api.tenancy import get_pooled_session

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/pooled",
    tags=["free-reports"],
    dependencies=[Depends(require_free_tier_enabled)],
)
# Worker callback: secret-gated, NOT flag-gated — an in-flight render still
# completes if the kill-switch is flipped (mirrors pooled/_shared.py).
internal_router = APIRouter(prefix="/internal/jobs", tags=["internal"])

# Cheap concurrency guard: at most this many queued/running reports per OWNER.
# The rate limiter is the primary throttle; this stops a burst from stacking
# renders on the single shared free processor slot.
_MAX_ACTIVE_REPORTS_PER_OWNER = 2


class PooledReportCreateRequest(BaseModel):
    """Body of POST /pooled/projects/{id}/reports. v1 exports ALL project
    findings (parity with the free CSV export, which takes no filters)."""

    locale: str | None = Field(default=None, max_length=8)


class PooledReportCallbackRequest(BaseModel):
    """Worker → API callback body. The processor's ReportCallbackPayload also
    carries `organization_id` (the sentinel echo) / `job_id` / `retriable` /
    `error_kind` — ignored here (pydantic drops extras by default)."""

    report_id: UUID
    status: str
    storage_key: str | None = None
    byte_size: int | None = None
    sha256: str | None = None
    error: str | None = None
    finished_at: datetime | None = None
    progress: int | None = None


# ---------------------------------------------------------------------------
# Payload twins of routers/reports/payloads.py (those take tenant ORM types).
# ---------------------------------------------------------------------------


def _pooled_project_report_payload(p: PooledProject) -> dict[str, object]:
    """Worker cover snapshot — the `reportProjectSchema` shape (_helpers.ts)."""
    return {
        "id": str(p.id),
        "name": p.name,
        "country": p.country,
        "reference_code": p.reference_code,
        "phase": p.phase,
        "address": {
            "country": p.country,
            "street": p.street,
            "house_number": p.house_number,
            "postal_code": p.postal_code,
            "city": p.city,
            "municipality": p.municipality,
            "bag_id": p.bag_id,
        },
        "permit_number": p.permit_number,
        "delivery_date": p.delivery_date.isoformat() if p.delivery_date else None,
    }


def _pooled_snag_photo_payload(att: PooledAttachment) -> dict[str, object]:
    """Photo storage key + content type + best-effort capture timestamp (mirrors
    payloads.py::_snag_photo_payload). Free photos live in the DEFAULT bucket —
    exactly what the worker's `downloadObject` reads, so keys travel bare."""
    captured_at: str | None = None
    meta = att.capture_metadata if isinstance(att.capture_metadata, dict) else None
    raw = meta.get("server_received_at") if meta else None
    if isinstance(raw, str) and raw:
        captured_at = raw
    elif att.created_at is not None:
        captured_at = att.created_at.isoformat()
    return {
        "storage_key": att.storage_key,
        "content_type": att.content_type,
        "captured_at": captured_at,
    }


def _pooled_snag_finding_payload(
    snag: PooledFinding,
    atts: dict[str, PooledAttachment],
    names: dict[UUID, str],
) -> dict[str, object]:
    """A free snag in the worker's snag-list finding shape (mirrors
    payloads.py::_snag_finding_payload; free has no Bbl ref / resolution note)."""
    photos: list[dict[str, object]] = []
    seen: set[str] = set()
    for aid in list(snag.photo_ids or []) + list(snag.resolution_evidence_ids or []):
        key = str(aid)
        if key in seen:
            continue
        seen.add(key)
        att = atts.get(key)
        if att is None or not (att.content_type or "").startswith("image/"):
            continue
        photos.append(_pooled_snag_photo_payload(att))
    return {
        "title": snag.title,
        "description": snag.note or "",
        "severity": snag.severity,
        "status": snag.status,
        "assignee": (
            names.get(snag.assigned_to_user_id)
            if snag.assigned_to_user_id is not None
            else None
        ),
        "deadline_date": snag.deadline_date.isoformat() if snag.deadline_date else None,
        "bbl_article_ref": None,
        "resolution_note": None,
        "created_at": snag.created_at.isoformat() if snag.created_at else None,
        "linked_element_global_id": snag.linked_element_global_id,
        "linked_file_type": snag.linked_file_type,
        "anchor_page": snag.anchor_page,
        "anchor_x": snag.anchor_x,
        "anchor_y": snag.anchor_y,
        "anchor_z": snag.anchor_z,
        "photos": photos,
    }


async def _pooled_report_to_response(
    report: PooledReport, storage: StorageBackend
) -> ReportResponse:
    """Adapt a pooled row to the paid `ReportResponse` (so the portal's existing
    Zod schema validates unchanged). Presigns download/view when ready — the
    single `presigned_get_url` choke point applies `safe_content_disposition`."""
    download_url: str | None = None
    view_url: str | None = None
    if report.status == "ready" and report.storage_key is not None:
        filename = f"{report.title}.pdf"
        download_url = await storage.presigned_get_url(report.storage_key, filename)
        view_url = await storage.presigned_get_url(
            report.storage_key, filename, disposition="inline"
        )
    return ReportResponse(
        id=report.id,
        project_id=report.pooled_project_id,
        report_type=ReportType(report.report_type),
        status=ReportStatus(report.status),
        title=report.title,
        locale=report.locale,
        job_id=report.job_id,
        source_job_id=None,
        template_id=None,
        storage_key=report.storage_key,
        byte_size=report.byte_size,
        sha256=report.sha256,
        error=report.error,
        download_url=download_url,
        view_url=view_url,
        created_at=report.created_at,
        finished_at=report.finished_at,
    )


async def _require_pooled_report_write_role(
    session: AsyncSession, project: PooledProject, user_id: UUID
) -> None:
    """403 FREE_FORBIDDEN unless owner or editor member (superuser session —
    query the member row directly with explicit predicates)."""
    if project.owner_user_id == user_id:
        return
    role = await session.scalar(
        select(PooledProjectMember.role).where(
            PooledProjectMember.pooled_project_id == project.id,
            PooledProjectMember.user_id == user_id,
        )
    )
    if role != "editor":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="FREE_FORBIDDEN")


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.post(
    "/projects/{project_id}/reports",
    response_model=ReportResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(FREE_REPORT_GEN_LIMITER)],
)
async def create_pooled_report(
    project_id: UUID,
    payload: PooledReportCreateRequest,
    user: User = Depends(current_verified_user),
    session: AsyncSession = Depends(get_async_session),
    storage: StorageBackend = Depends(get_storage),
    settings: Settings = Depends(get_settings),
) -> ReportResponse:
    # Three-phase like the paid create_report: persist queued row, COMMIT, then
    # dispatch with no DB connection held; a dispatch failure marks the row
    # failed in a fresh short transaction.
    project = await _load_pooled_project_superuser_or_404(session, project_id)
    await _assert_pooled_participant(session, project, user.id)
    await _require_pooled_report_write_role(session, project, user.id)

    active = await session.scalar(
        select(PooledReport.id)
        .where(
            PooledReport.owner_user_id == project.owner_user_id,
            PooledReport.status.in_(("queued", "running")),
        )
        .offset(_MAX_ACTIVE_REPORTS_PER_OWNER - 1)
        .limit(1)
    )
    if active is not None:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="FREE_REPORT_BUSY"
        )

    locale = coerce_locale(payload.locale) if payload.locale else resolve_user_locale(user)
    title = t("notifications.report.snag_list.title", locale, name=project.name)

    snags = await _load_project_snags(session, project_id)
    names = await _resolve_pooled_user_names(session, snags)
    att_ids: set[UUID] = set()
    for s in snags:
        for aid in list(s.photo_ids or []) + list(s.resolution_evidence_ids or []):
            try:
                att_ids.add(UUID(str(aid)))
            except (ValueError, TypeError):
                continue
    atts: dict[str, PooledAttachment] = {}
    if att_ids:
        rows = (
            await session.execute(
                select(PooledAttachment).where(
                    PooledAttachment.id.in_(att_ids),
                    PooledAttachment.pooled_project_id == project.id,
                    PooledAttachment.deleted_at.is_(None),
                )
            )
        ).scalars().all()
        atts = {str(a.id): a for a in rows}

    report = PooledReport(
        owner_user_id=project.owner_user_id,
        pooled_project_id=project.id,
        created_by_user_id=user.id,
        report_type="snag_list",
        status="queued",
        title=title,
        locale=locale,
    )
    session.add(report)
    await session.flush()

    storage_key = f"{pooled_key_prefix(project.owner_user_id)}reports/{project.id}/{report.id}.pdf"
    worker_payload: dict[str, object] = {
        "report_id": str(report.id),
        "storage_key": storage_key,
        "generated_at": datetime.now(UTC).isoformat(),
        "locale": locale,
        "jurisdiction": project.country,
        "project": _pooled_project_report_payload(project),
        "findings": [_pooled_snag_finding_payload(s, atts, names) for s in snags],
        "recipient": None,
        "filters": {"status": None, "severity": None},
        # Free watermark via the existing branding seam (footer only; the
        # logo/cover steps no-op without keys). Localized to the report locale.
        "template": {"branding": {"footer_text": t("reports.pooled_footer", locale)}},
        "callback_path": POOLED_REPORT_CALLBACK_PATH,
    }
    job = Job(
        id=uuid4(),
        job_type=JobType.snag_list_report,
        status=JobStatus.pending,
        payload=worker_payload,
    )
    report.job_id = job.id
    report_id = report.id
    await session.commit()

    # Phase 2: dispatch with no connection held.
    try:
        await dispatch_job(job, settings, FREE_TIER_SENTINEL_ORG, tier=JobTier.free)
    except DispatchJobError as exc:
        msg = f"DISPATCH_FAILED: {exc}"[:500]
        logger.warning("Free report dispatch failed for %s: %s", report_id, exc)
        async with get_session_maker()() as retry, retry.begin():
            failed = await retry.get(PooledReport, report_id)
            if failed is not None:
                failed.status = "failed"
                failed.error = msg
                failed.finished_at = datetime.now(UTC)
                return await _pooled_report_to_response(failed, storage)
        return await _pooled_report_to_response(report, storage)

    return await _pooled_report_to_response(report, storage)


@router.get("/projects/{project_id}/reports", response_model=ReportListResponse)
async def list_pooled_reports(
    project_id: UUID,
    user: User = Depends(current_verified_user),
    session: AsyncSession = Depends(get_pooled_session),
    storage: StorageBackend = Depends(get_storage),
) -> ReportListResponse:
    # Pooled RLS session: owner-or-member visibility comes from the policy.
    await _load_accessible_pooled_project_or_404(session, project_id)
    rows = (
        (
            await session.execute(
                select(PooledReport)
                .where(PooledReport.pooled_project_id == project_id)
                .order_by(PooledReport.created_at.desc())
            )
        )
        .scalars()
        .all()
    )
    items = [await _pooled_report_to_response(r, storage) for r in rows]
    return ReportListResponse(items=items, total=len(items))


@router.get("/projects/{project_id}/reports/{report_id}", response_model=ReportResponse)
async def get_pooled_report(
    project_id: UUID,
    report_id: UUID,
    user: User = Depends(current_verified_user),
    session: AsyncSession = Depends(get_pooled_session),
    storage: StorageBackend = Depends(get_storage),
) -> ReportResponse:
    await _load_accessible_pooled_project_or_404(session, project_id)
    report = (
        await session.execute(
            select(PooledReport).where(
                PooledReport.id == report_id,
                PooledReport.pooled_project_id == project_id,
            )
        )
    ).scalar_one_or_none()
    if report is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="FREE_REPORT_NOT_FOUND"
        )
    return await _pooled_report_to_response(report, storage)


# ---------------------------------------------------------------------------
# Worker callback (secret-gated, superuser session — RLS-bypassing)
# ---------------------------------------------------------------------------


@internal_router.post("/pooled-report-callback", status_code=status.HTTP_200_OK)
async def pooled_report_callback(
    payload: PooledReportCallbackRequest,
    _: None = Depends(require_worker_secret),
) -> dict[str, bool]:
    notify: dict[str, object] | None = None
    async with get_session_maker()() as session, session.begin():
        row = await session.get(PooledReport, payload.report_id, with_for_update=True)
        if row is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="FREE_REPORT_NOT_FOUND"
            )
        if row.status in ("ready", "failed"):
            return {"ok": True}  # terminal — idempotent no-op

        if payload.status == "running":
            row.status = "running"
        elif payload.status == "ready":
            if payload.storage_key is None:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST, detail="MISSING_STORAGE_KEY"
                )
            # Superuser session — bind the worker-supplied key to the OWNER's
            # namespace AND this report's own reports/<project>/ prefix.
            assert_pooled_key_scoped(payload.storage_key, row.owner_user_id)
            assert_key_scoped(
                payload.storage_key,
                f"{pooled_key_prefix(row.owner_user_id)}reports/{row.pooled_project_id}/",
                detail="INVALID_FREE_STORAGE_KEY",
            )
            row.status = "ready"
            row.storage_key = payload.storage_key
            row.byte_size = payload.byte_size
            row.sha256 = payload.sha256
            row.error = None
            row.finished_at = payload.finished_at or datetime.now(UTC)
        elif payload.status == "failed":
            row.status = "failed"
            row.error = (payload.error or "report generation failed")[:2000]
            row.finished_at = payload.finished_at or datetime.now(UTC)
        else:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="VALIDATION_ERROR"
            )

        if payload.status in ("ready", "failed") and row.created_by_user_id is not None:
            notify = {
                "recipient_user_id": row.created_by_user_id,
                "event_type": (
                    "job_succeeded" if payload.status == "ready" else "job_failed"
                ),
                "report_title": row.title,
                "locale": row.locale,
                "project_id": row.pooled_project_id,
                "error": payload.error if payload.status == "failed" else None,
            }

    if notify is not None:
        await emit_pooled_report_notification(**notify)  # type: ignore[arg-type]
    return {"ok": True}
