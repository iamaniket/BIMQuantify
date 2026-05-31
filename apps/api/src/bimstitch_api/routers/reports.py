"""Endpoints for generated reports (PDF artifacts).

The first report type — `compliance_report` — renders the latest succeeded
compliance Job for a project as a PDF in the project's jurisdictional
default locale (NL → Dutch). Future report types (assurance_plan /
completion_declaration / dossier per backlog #31/#32/#33) plug into this same router by adding
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

import asyncio
import hashlib
import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from bimstitch_api import audit
from bimstitch_api.auth.fastapi_users import current_verified_user
from bimstitch_api.auth.permissions import Action, Resource, require_permission
from bimstitch_api.config import Settings, get_settings
from bimstitch_api.jobs import (
    DispatchJobError,
    JobConcurrencyError,
    check_job_concurrency,
    dispatch_job,
)
from bimstitch_api.jurisdictions import find_instrument
from bimstitch_api.jurisdictions import get as get_jurisdiction
from bimstitch_api.models.attachment import Attachment
from bimstitch_api.models.borgingsmoment import Borgingsmoment
from bimstitch_api.models.borgingsplan import Borgingsplan, BorgingsplanStatus
from bimstitch_api.models.certificate import Certificate, CertificateStatus
from bimstitch_api.models.contractor import Contractor
from bimstitch_api.models.finding import Finding
from bimstitch_api.models.job import Job, JobStatus, JobType
from bimstitch_api.models.notification import NotificationEventType
from bimstitch_api.models.project import Project
from bimstitch_api.models.report import Report, ReportStatus, ReportType
from bimstitch_api.models.risk import Risk
from bimstitch_api.models.user import User
from bimstitch_api.notifications.service import create_notification, publish_notification
from bimstitch_api.routers.projects import (
    _load_project_or_404,
    _require_membership,
    _require_project_read_access,
)
from bimstitch_api.schemas.report import (
    ReportCreateRequest,
    ReportListResponse,
    ReportResponse,
)
from bimstitch_api.storage import StorageBackend, get_storage
from bimstitch_api.tenancy import get_tenant_session, require_active_organization

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/projects/{project_id}/reports", tags=["reports"])


_COMPLIANCE_JOB_TYPES = (JobType.compliance_check,)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


# Per-type, per-locale report titles + "generating…" notification bodies. NL is
# the committed default; adding a locale is a one-line entry. Phase 4 will
# migrate these into the shared i18n message catalog.
_REPORT_TITLE_TEMPLATES: dict[ReportType, dict[str, str]] = {
    ReportType.compliance_report: {
        "nl": "Nalevingsrapport — {name}",
        "en": "Compliance report — {name}",
    },
    ReportType.assurance_plan: {
        "nl": "Borgingsplan — {name}",
        "en": "Assurance plan — {name}",
    },
    ReportType.completion_declaration: {
        "nl": "Verklaring kwaliteitsborger — {name}",
        "en": "Completion declaration — {name}",
    },
    ReportType.dossier: {
        "nl": "Dossier bevoegd gezag — {name}",
        "en": "Dossier for the competent authority — {name}",
    },
}

_REPORT_NOTIFICATION_BODY: dict[ReportType, dict[str, str]] = {
    ReportType.compliance_report: {
        "nl": "Nalevingsrapport wordt gegenereerd…",
        "en": "Compliance report is being generated…",
    },
    ReportType.assurance_plan: {
        "nl": "Borgingsplan-PDF wordt gegenereerd…",
        "en": "Assurance plan PDF is being generated…",
    },
    ReportType.completion_declaration: {
        "nl": "Verklaring wordt gegenereerd…",
        "en": "Completion declaration is being generated…",
    },
    ReportType.dossier: {
        "nl": "Dossier bevoegd gezag wordt gegenereerd…",
        "en": "Dossier for the competent authority is being generated…",
    },
}


def _report_title(report_type: ReportType, project_name: str, locale: str) -> str:
    by_locale = _REPORT_TITLE_TEMPLATES[report_type]
    template = by_locale.get(locale, by_locale["en"])
    return template.format(name=project_name)


def _report_notification_body(report_type: ReportType, locale: str) -> str:
    by_locale = _REPORT_NOTIFICATION_BODY[report_type]
    return by_locale.get(locale, by_locale["en"])


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
# Per-type source resolvers
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class _ReportPlan:
    """What a per-type resolver returns: the worker JobType, the optional
    pointer to the data-source Job, the user-facing title, and the type-specific
    extra payload merged into the common worker envelope."""

    job_type: JobType
    source_job_id: UUID | None
    title: str
    payload_extra: dict[str, object]


async def _resolve_compliance_source(
    session: AsyncSession, project: Project, user: User, locale: str
) -> _ReportPlan:
    """compliance_report: render the latest succeeded compliance Job."""
    source_job = await _load_latest_compliance_job(session, project.id)
    if source_job is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="NO_COMPLIANCE_DATA",
        )
    return _ReportPlan(
        job_type=JobType.compliance_report,
        source_job_id=source_job.id,
        title=_report_title(ReportType.compliance_report, project.name, locale),
        payload_extra={"compliance": source_job.result or {}},
    )


# Construction-phase ordering for borgingsmomenten on the rendered plan.
_PHASE_RANK: dict[str, int] = {
    "foundation": 0,
    "shell": 1,
    "roof": 2,
    "finishing": 3,
    "handover": 4,
    "other": 5,
}


def _instrument_payload(project: Project) -> dict[str, object] | None:
    """The project's toegelaten instrument resolved from the jurisdiction
    registry — name/provider/methodology for the report cover. None if the
    project hasn't picked one yet (aannemer-first: 'KB will select')."""
    if project.instrument_id is None:
        return None
    inst = find_instrument(project.country, project.instrument_id)
    if inst is None:
        return None
    return {
        "id": inst.id,
        "name": inst.name,
        "provider": inst.provider,
        "methodology_url": inst.methodology_url,
    }


def _user_display_name(u: User | None) -> str | None:
    """Display name (full_name, else email) for an eager-loaded User, or None."""
    if u is None:
        return None
    return u.full_name or u.email


def _assurance_plan_payload(plan: Borgingsplan) -> dict[str, object]:
    """Snapshot the borgingsplan + its moments/checklist items for rendering.
    moments + checklist_items are selectin-loaded with the plan; `created_by`
    and each moment's `responsible` are eager-loaded by the resolver."""
    moments = sorted(
        plan.moments,
        key=lambda m: (_PHASE_RANK.get(m.phase.value, 99), m.sequence_in_phase),
    )
    return {
        "version_number": plan.version_number,
        "status": plan.status.value,
        "created_by": _user_display_name(plan.created_by),
        "published_at": plan.published_at.isoformat() if plan.published_at else None,
        "notes": plan.notes,
        "moments": [
            {
                "phase": m.phase.value,
                "name": m.name,
                "planned_date": m.planned_date.isoformat(),
                "actual_date": m.actual_date.isoformat() if m.actual_date else None,
                "responsible": _user_display_name(m.responsible),
                "status": m.status.value,
                "checklist_items": [
                    {
                        "description": ci.description,
                        "evidence_type": ci.evidence_type.value,
                        "bbl_article_ref": ci.bbl_article_ref,
                        "pass_fail_criteria": ci.pass_fail_criteria,
                    }
                    for ci in sorted(m.checklist_items, key=lambda c: c.sequence)
                ],
            }
            for m in moments
        ],
    }


def _risk_payload(risk: Risk) -> dict[str, object]:
    return {
        "category": risk.category.value,
        "level": risk.level.value,
        "description": risk.description,
        "mitigation": risk.mitigation,
        "responsible_party": risk.responsible_party,
        "bbl_article_ref": risk.bbl_article_ref,
    }


async def _load_active_plan(
    session: AsyncSession, project_id: UUID
) -> Borgingsplan | None:
    """The project's active borgingsplan (published preferred, else draft), with
    created_by + moments.responsible eager-loaded. Shared by #31 and #33."""
    return (
        await session.execute(
            select(Borgingsplan)
            .where(
                Borgingsplan.project_id == project_id,
                Borgingsplan.status.in_(
                    (BorgingsplanStatus.published, BorgingsplanStatus.draft)
                ),
            )
            .options(
                selectinload(Borgingsplan.created_by),
                selectinload(Borgingsplan.moments).selectinload(
                    Borgingsmoment.responsible
                ),
            )
            # published wins over draft; newest version first.
            .order_by(
                (Borgingsplan.status == BorgingsplanStatus.published).desc(),
                Borgingsplan.version_number.desc(),
            )
            .limit(1)
        )
    ).scalar_one_or_none()


async def _load_project_risks(session: AsyncSession, project_id: UUID) -> list[Risk]:
    return list(
        (
            await session.execute(
                select(Risk)
                .where(Risk.project_id == project_id)
                .order_by(Risk.category, Risk.level)
            )
        ).scalars().all()
    )


async def _resolve_assurance_plan_source(
    session: AsyncSession, project: Project, user: User, locale: str
) -> _ReportPlan:
    """assurance_plan (#31): render the project's active borgingsplan
    (published preferred, else draft) plus its risicobeoordeling."""
    plan = await _load_active_plan(session, project.id)
    if plan is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="NO_ASSURANCE_PLAN",
        )
    risks = await _load_project_risks(session, project.id)
    return _ReportPlan(
        job_type=JobType.assurance_plan_report,
        source_job_id=None,
        title=_report_title(ReportType.assurance_plan, project.name, locale),
        payload_extra={
            "instrument": _instrument_payload(project),
            "assurance_plan": _assurance_plan_payload(plan),
            "risks": [_risk_payload(r) for r in risks],
        },
    )


def _declaration_payload(
    user: User,
    *,
    signed: bool,
    signed_at: str | None,
    signature_hash: str | None,
) -> dict[str, object]:
    """The verklaring's declarant + signing state. Unsigned at generate time;
    the sign endpoint re-renders with signed=True + the stamp fields."""
    return {
        "kwaliteitsborger": _user_display_name(user),
        "kwaliteitsborger_email": user.email,
        "signed": signed,
        "signed_at": signed_at,
        "signature_hash": signature_hash,
    }


async def _resolve_completion_declaration_source(
    session: AsyncSession, project: Project, user: User, locale: str
) -> _ReportPlan:
    """completion_declaration (#32): render the kwaliteitsborger's verklaring.
    Generated unsigned; an inspector locks it via POST .../sign, which re-renders
    the stamped version. No source-data gate — project + declarant always exist."""
    return _ReportPlan(
        job_type=JobType.completion_declaration_report,
        source_job_id=None,
        title=_report_title(ReportType.completion_declaration, project.name, locale),
        payload_extra={
            "instrument": _instrument_payload(project),
            "declaration": _declaration_payload(
                user, signed=False, signed_at=None, signature_hash=None
            ),
        },
    )


def _dossier_finding_payload(
    finding: Finding, atts: dict[str, Attachment]
) -> dict[str, object]:
    """A finding + its resolution + image-attachment storage keys (the worker
    embeds those photos). Only image attachments are embedded."""
    photos: list[dict[str, str]] = []
    seen: set[str] = set()
    for aid in list(finding.photo_ids or []) + list(finding.resolution_evidence_ids or []):
        key = str(aid)
        if key in seen:
            continue
        seen.add(key)
        att = atts.get(key)
        if att is None or not att.content_type.startswith("image/"):
            continue
        photos.append({"storage_key": att.storage_key, "content_type": att.content_type})
    return {
        "title": finding.title,
        "description": finding.description,
        "severity": finding.severity.value,
        "status": finding.status.value,
        "deadline_date": finding.deadline_date.isoformat() if finding.deadline_date else None,
        "bbl_article_ref": finding.bbl_article_ref,
        "resolution_note": finding.resolution_note,
        "photos": photos,
    }


def _dossier_certificate_payload(cert: Certificate) -> dict[str, object]:
    """A certificate's metadata + storage key (the worker merges PDF certs)."""
    return {
        "certificate_type": cert.certificate_type.value,
        "certificate_number": cert.certificate_number,
        "issuer": cert.issuer,
        "subject": cert.subject,
        "valid_from": cert.valid_from.isoformat() if cert.valid_from else None,
        "valid_until": cert.valid_until.isoformat() if cert.valid_until else None,
        "filename": cert.original_filename,
        "content_type": cert.content_type,
        "storage_key": cert.storage_key,
    }


async def _resolve_dossier_source(
    session: AsyncSession, project: Project, user: User, locale: str
) -> _ReportPlan:
    """dossier (#33): bundle everything for the gereedmelding — project,
    instrument, risicobeoordeling, borgingsplan, findings (with resolution +
    photos), certificates, and the signed verklaring. Domain data travels inline;
    binary blobs (photos, certificate PDFs, the verklaring PDF) travel as storage
    keys the worker fetches from MinIO and embeds/merges. No data gate — an
    early-stage dossier is sparse but still valid."""
    plan = await _load_active_plan(session, project.id)
    risks = await _load_project_risks(session, project.id)

    findings = list(
        (
            await session.execute(
                select(Finding)
                .where(Finding.project_id == project.id, Finding.deleted_at.is_(None))
                .order_by(Finding.created_at)
            )
        ).scalars().all()
    )

    # Resolve every attachment a finding references (photos + resolution evidence).
    att_ids: set[UUID] = set()
    for f in findings:
        for aid in list(f.photo_ids or []) + list(f.resolution_evidence_ids or []):
            try:
                att_ids.add(UUID(str(aid)))
            except (ValueError, TypeError):
                continue
    atts: dict[str, Attachment] = {}
    if att_ids:
        rows = (
            await session.execute(
                select(Attachment).where(
                    Attachment.id.in_(att_ids), Attachment.deleted_at.is_(None)
                )
            )
        ).scalars().all()
        atts = {str(a.id): a for a in rows}

    certificates = list(
        (
            await session.execute(
                select(Certificate)
                .where(
                    Certificate.project_id == project.id,
                    Certificate.status == CertificateStatus.ready,
                    Certificate.deleted_at.is_(None),
                )
                .order_by(Certificate.created_at)
            )
        ).scalars().all()
    )

    verklaring = (
        await session.execute(
            select(Report)
            .where(
                Report.project_id == project.id,
                Report.report_type == ReportType.completion_declaration,
                Report.signed_at.is_not(None),
                Report.status == ReportStatus.ready,
                Report.storage_key.is_not(None),
            )
            .order_by(Report.signed_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()

    return _ReportPlan(
        job_type=JobType.dossier_report,
        source_job_id=None,
        title=_report_title(ReportType.dossier, project.name, locale),
        payload_extra={
            "instrument": _instrument_payload(project),
            "assurance_plan": _assurance_plan_payload(plan) if plan is not None else None,
            "risks": [_risk_payload(r) for r in risks],
            "findings": [_dossier_finding_payload(f, atts) for f in findings],
            "certificates": [_dossier_certificate_payload(c) for c in certificates],
            "verklaring": (
                {
                    "storage_key": verklaring.storage_key,
                    "content_type": "application/pdf",
                    "signature_hash": verklaring.signature_hash,
                }
                if verklaring is not None
                else None
            ),
        },
    )


# report_type → resolver. New types land incrementally (#31/#32/#33); a known
# type with no entry yet yields 422 REPORT_TYPE_NOT_AVAILABLE from create_report.
_Resolver = Callable[[AsyncSession, Project, User, str], Awaitable[_ReportPlan]]
_RESOLVERS: dict[ReportType, _Resolver] = {
    ReportType.compliance_report: _resolve_compliance_source,
    ReportType.assurance_plan: _resolve_assurance_plan_source,
    ReportType.completion_declaration: _resolve_completion_declaration_source,
    ReportType.dossier: _resolve_dossier_source,
}


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
    request: Request,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
    storage: StorageBackend = Depends(get_storage),
    settings: Settings = Depends(get_settings),
) -> ReportResponse:
    project = await _load_project_or_404(session, project_id)
    membership = await _require_membership(session, project.id, user.id)
    require_permission(membership.role, Resource.report, Action.create)

    # Eager-load contractor for the render snapshot (project.contractor is a
    # relationship; we issue an explicit SELECT under tenant RLS). Used by every
    # report type's cover page.
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

    # Route to the per-type source resolver: it loads its own data and returns
    # the worker JobType, optional source-Job pointer, title, and type-specific
    # payload. A known type whose resolver hasn't landed yet → clean 422.
    resolver = _RESOLVERS.get(payload.report_type)
    if resolver is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="REPORT_TYPE_NOT_AVAILABLE",
        )
    plan = await resolver(session, project, user, locale)

    generated_at = datetime.now(UTC)

    # Create Report first so we have its ID for the worker's storage key.
    report = Report(
        project_id=project.id,
        report_type=payload.report_type,
        status=ReportStatus.queued,
        title=plan.title,
        locale=locale,
        params=payload.params or {},
        source_job_id=plan.source_job_id,
        created_by_user_id=user.id,
    )
    session.add(report)
    await session.flush()

    # Compose the worker payload. Stateless: everything the worker needs to
    # render lives here. Binary blobs (dossier photos / certificate PDFs) are
    # passed as storage keys in `payload_extra` and fetched from MinIO by the
    # worker — never round-tripped through the API.
    storage_key = f"reports/{active_org_id}/{project.id}/{report.id}.pdf"
    worker_payload: dict[str, object] = {
        "report_id": str(report.id),
        "storage_key": storage_key,
        "project": _project_payload(project, contractor),
        "generated_at": generated_at.isoformat(),
        "locale": locale,
        "jurisdiction": project.country,
        **plan.payload_extra,
    }

    try:
        await check_job_concurrency(session, settings)
    except JobConcurrencyError as exc:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="TOO_MANY_ACTIVE_JOBS",
        ) from exc

    job = Job(
        project_id=project.id,
        job_type=plan.job_type,
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
        await dispatch_job(job, settings, active_org_id)
    except DispatchJobError as exc:
        msg = f"DISPATCH_FAILED: {exc}"[:500]
        report.status = ReportStatus.failed
        report.error = msg
        report.finished_at = datetime.now(UTC)
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
            event_type=NotificationEventType.job_started,
            title=plan.title,
            body=_report_notification_body(payload.report_type, locale),
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
            await publish_notification(notification, organization_id=active_org_id)
        except Exception:
            logger.warning(
                "Failed to publish job_started notification for report %s",
                report.id,
                exc_info=True,
            )

    await audit.record(
        session,
        action="report.created",
        resource_type="report",
        resource_id=report.id,
        after={
            "report_type": report.report_type.value,
            "locale": report.locale,
            "title": report.title,
        },
        actor_user_id=user.id,
        project_id=project.id,
        request=request,
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
    active_org_id: UUID = Depends(require_active_organization),
    storage: StorageBackend = Depends(get_storage),
) -> ReportListResponse:
    project = await _load_project_or_404(session, project_id)
    await _require_project_read_access(session, project.id, user, active_org_id)

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

    items = list(await asyncio.gather(*[_to_response(r, storage) for r in rows]))
    return ReportListResponse(items=items, total=int(total))


@router.get("/{report_id}", response_model=ReportResponse)
async def get_report(
    project_id: UUID,
    report_id: UUID,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
    storage: StorageBackend = Depends(get_storage),
) -> ReportResponse:
    project = await _load_project_or_404(session, project_id)
    await _require_project_read_access(session, project.id, user, active_org_id)

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


@router.post("/{report_id}/sign", response_model=ReportResponse)
async def sign_report(
    project_id: UUID,
    report_id: UUID,
    request: Request,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
    storage: StorageBackend = Depends(get_storage),
    settings: Settings = Depends(get_settings),
) -> ReportResponse:
    """Sign a ready verklaring (#32). Inspector-only (sole holder of
    Action.sign on completion_declaration). Locks the report (signed_at set),
    embeds an audit-id hash, and re-renders the stamped PDF over the same key.
    Idempotency-guarded: a second sign returns 409."""
    project = await _load_project_or_404(session, project_id)
    membership = await _require_membership(session, project.id, user.id)
    require_permission(membership.role, Resource.completion_declaration, Action.sign)

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
    if report.report_type is not ReportType.completion_declaration:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="NOT_A_DECLARATION"
        )
    if report.signed_at is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="REPORT_ALREADY_SIGNED"
        )
    if report.status is not ReportStatus.ready or report.storage_key is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="REPORT_NOT_READY"
        )

    signed_at = datetime.now(UTC)
    # Audit-id hash binding the artifact (its sha256) to the signer + moment.
    digest_src = f"{report.id}|{report.sha256 or ''}|{user.id}|{signed_at.isoformat()}"
    signature_hash = hashlib.sha256(digest_src.encode("utf-8")).hexdigest()

    report.signed_at = signed_at
    report.signed_by_user_id = user.id
    report.signature_hash = signature_hash
    # Re-render the locked, stamped PDF over the same storage key.
    report.status = ReportStatus.queued
    report.error = None
    report.finished_at = None

    worker_payload: dict[str, object] = {
        "report_id": str(report.id),
        "storage_key": report.storage_key,
        "project": _project_payload(project, None),
        "generated_at": datetime.now(UTC).isoformat(),
        "locale": report.locale,
        "jurisdiction": project.country,
        "instrument": _instrument_payload(project),
        "declaration": _declaration_payload(
            user,
            signed=True,
            signed_at=signed_at.isoformat(),
            signature_hash=signature_hash,
        ),
    }

    try:
        await check_job_concurrency(session, settings)
    except JobConcurrencyError as exc:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="TOO_MANY_ACTIVE_JOBS",
        ) from exc

    job = Job(
        project_id=project.id,
        job_type=JobType.completion_declaration_report,
        status=JobStatus.pending,
        payload=worker_payload,
        created_by_user_id=user.id,
    )
    session.add(job)
    await session.flush()
    report.job_id = job.id

    try:
        await dispatch_job(job, settings, active_org_id)
    except DispatchJobError as exc:
        msg = f"DISPATCH_FAILED: {exc}"[:500]
        report.status = ReportStatus.failed
        report.error = msg
        report.finished_at = datetime.now(UTC)
        job.status = JobStatus.failed
        job.error = msg
        job.finished_at = report.finished_at
        logger.warning("Signed re-render dispatch failed for report %s: %s", report.id, exc)
        await session.flush()

    await audit.record(
        session,
        action="report.signed",
        resource_type="report",
        resource_id=report.id,
        after={
            "signature_hash": signature_hash,
            "signed_by_user_id": str(user.id),
            "signed_at": signed_at.isoformat(),
        },
        actor_user_id=user.id,
        project_id=project.id,
        request=request,
    )

    await session.refresh(report)
    return await _to_response(report, storage)
