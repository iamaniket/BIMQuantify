"""Aggregate dashboard endpoint: GET /projects/{project_id}/overview.

One call assembles everything the project-detail page paints on a cold load —
project metadata, the completeness donut, header KPIs, and a capped preview +
exact count for findings / certificates / attachments / reports / deadlines,
plus members and the weekly activity trend. Replaces ~10 separate requests.

All sub-queries run inside the single `get_tenant_session` transaction (schema
isolation is physical, so there is no cross-project work and no N+1). This is a
read-only endpoint — it MUST NOT call `session.commit()`; the tenant session's
`async with session.begin()` owns the transaction.
"""

import asyncio
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi import Depends, Response
from sqlalchemy import Select, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased, selectinload

from bimdossier_api.access import (
    get_membership,
    load_project_or_404,
    require_project_read_access,
)
from bimdossier_api.auth.fastapi_users import current_verified_user
from bimdossier_api.cache import CACHE_TTL_PROJECT_DETAIL, cache_response
from bimdossier_api.deadlines.completeness import compute_project_completeness
from bimdossier_api.models.certificate import Certificate, CertificateStatus
from bimdossier_api.models.deadline import Deadline, DeadlineStatus
from bimdossier_api.models.finding import Finding, FindingStatus
from bimdossier_api.models.project_file import (
    ProjectFile,
    ProjectFileRole,
    ProjectFileStatus,
)
from bimdossier_api.models.project_member import ProjectMember
from bimdossier_api.models.report import Report
from bimdossier_api.models.user import User
from bimdossier_api.routers.projects._shared import _project_to_read, router
from bimdossier_api.schemas.attachment import AttachmentRead
from bimdossier_api.schemas.certificate import CertificateRead
from bimdossier_api.schemas.finding import FindingRead
from bimdossier_api.schemas.project import ProjectMemberRead, ProjectRead
from bimdossier_api.schemas.project_overview import (
    AttachmentsBlock,
    CertificatesBlock,
    DeadlinesBlock,
    FindingsBlock,
    OverviewStats,
    ProjectOverviewRead,
    ReportsBlock,
)
from bimdossier_api.storage import StorageBackend, get_storage
from bimdossier_api.tenancy import get_tenant_session, require_active_organization

# How many rows each preview card serves. The launcher cards render as many as
# fit on screen, so this is a little above the typical visible count.
OVERVIEW_PREVIEW_LIMIT = 8

# Mirrors the portal's `EXPIRY_WARNING_DAYS` (features/certificates/expiry.ts).
_CERT_EXPIRY_WARNING_DAYS = 30

_AMS = ZoneInfo("Europe/Amsterdam")


async def _count_of(session: AsyncSession, stmt: Select[Any]) -> int:
    return (await session.scalar(select(func.count()).select_from(stmt.subquery()))) or 0


@router.get("/{project_id}/overview", response_model=ProjectOverviewRead)
async def get_project_overview(
    project_id: UUID,
    response: Response,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
    storage: StorageBackend = Depends(get_storage),
) -> ProjectOverviewRead:
    # Cross-router helpers imported lazily to keep this leaf router free of any
    # import-order coupling to the reports / deadlines / activity routers.
    from bimdossier_api.routers.activity import compute_activity_timeline
    from bimdossier_api.routers.deadlines import _serialize_deadline
    from bimdossier_api.routers.reports.endpoints import _to_response as _report_to_response

    project = await load_project_or_404(session, project_id)
    await require_project_read_access(session, project.id, user, active_org_id)
    my_membership = await get_membership(session, project.id, user.id)

    # --- Completeness donut (dossier + findings + deadlines wedges) ----------
    completeness = await compute_project_completeness(session, project)

    # --- Findings: count/open reuse the completeness ring; preview is top-N --
    findings_rows = (
        (
            await session.execute(
                select(Finding)
                .where(Finding.project_id == project.id, Finding.deleted_at.is_(None))
                .order_by(Finding.created_at.desc())
                .limit(OVERVIEW_PREVIEW_LIMIT)
            )
        )
        .scalars()
        .all()
    )
    by_status = completeness.findings.by_status
    findings_block = FindingsBlock(
        count=completeness.findings.total,
        open=by_status[FindingStatus.open.value] + by_status[FindingStatus.in_progress.value],
        preview=[FindingRead.model_validate(f) for f in findings_rows],
    )

    # --- Certificates: head-of-group, expiry counts, top-N preview ----------
    c2 = aliased(Certificate)
    cert_has_newer = (
        select(c2.id)
        .where(
            c2.project_id == project.id,
            c2.status == CertificateStatus.ready,
            c2.deleted_at.is_(None),
            func.coalesce(c2.parent_certificate_id, c2.id)
            == func.coalesce(Certificate.parent_certificate_id, Certificate.id),
            c2.version_number > Certificate.version_number,
        )
        .exists()
    )
    cert_base = select(Certificate).where(
        Certificate.project_id == project.id,
        Certificate.status == CertificateStatus.ready,
        Certificate.deleted_at.is_(None),
        ~cert_has_newer,
    )
    today = datetime.now(UTC).date()
    cert_count = await _count_of(session, cert_base)
    cert_expired = await _count_of(
        session,
        cert_base.where(
            Certificate.valid_until.is_not(None),
            Certificate.valid_until < today,
        ),
    )
    cert_expiring = await _count_of(
        session,
        cert_base.where(
            Certificate.valid_until.is_not(None),
            Certificate.valid_until >= today,
            Certificate.valid_until <= today + timedelta(days=_CERT_EXPIRY_WARNING_DAYS),
        ),
    )
    cert_rows = (
        (
            await session.execute(
                cert_base.options(selectinload(Certificate.uploaded_by_user))
                .order_by(Certificate.valid_until.asc().nulls_last(), Certificate.created_at.desc())
                .limit(OVERVIEW_PREVIEW_LIMIT)
            )
        )
        .scalars()
        .all()
    )
    certificates_block = CertificatesBlock(
        count=cert_count,
        expired=cert_expired,
        expiring_soon=cert_expiring,
        preview=[CertificateRead.model_validate(c) for c in cert_rows],
    )

    # --- Attachments: head-of-group ready, top-N preview --------------------
    a2 = aliased(ProjectFile)
    att_has_newer = (
        select(a2.id)
        .where(
            a2.project_id == project.id,
            a2.role == ProjectFileRole.attachment,
            a2.status == ProjectFileStatus.ready,
            a2.deleted_at.is_(None),
            func.coalesce(a2.parent_file_id, a2.id)
            == func.coalesce(ProjectFile.parent_file_id, ProjectFile.id),
            a2.version_number > ProjectFile.version_number,
        )
        .exists()
    )
    att_base = select(ProjectFile).where(
        ProjectFile.project_id == project.id,
        ProjectFile.role == ProjectFileRole.attachment,
        ProjectFile.status == ProjectFileStatus.ready,
        ProjectFile.deleted_at.is_(None),
        ~att_has_newer,
    )
    att_count = await _count_of(session, att_base)
    att_rows = (
        (
            await session.execute(
                att_base.options(selectinload(ProjectFile.uploaded_by_user))
                .order_by(ProjectFile.created_at.desc())
                .limit(OVERVIEW_PREVIEW_LIMIT)
            )
        )
        .scalars()
        .all()
    )
    attachments_block = AttachmentsBlock(
        count=att_count,
        preview=[AttachmentRead.model_validate(a) for a in att_rows],
    )

    # --- Reports: count + top-N preview (presigned URLs via _to_response) ----
    report_base = select(Report).where(Report.project_id == project.id)
    report_count = await _count_of(session, report_base)
    report_rows = (
        (
            await session.execute(
                report_base.order_by(Report.created_at.desc()).limit(OVERVIEW_PREVIEW_LIMIT)
            )
        )
        .scalars()
        .all()
    )
    report_preview = list(
        await asyncio.gather(*[_report_to_response(r, storage) for r in report_rows])
    )
    reports_block = ReportsBlock(count=report_count, preview=report_preview)

    # --- Deadlines: full (small) list + header KPI counts -------------------
    deadline_rows = (
        (
            await session.execute(
                select(Deadline)
                .where(Deadline.project_id == project.id)
                .order_by(Deadline.due_date.asc().nulls_last())
            )
        )
        .scalars()
        .all()
    )
    deadline_preview = [_serialize_deadline(dl) for dl in deadline_rows]
    deadlines_met = sum(1 for dl in deadline_preview if dl.status == DeadlineStatus.met)
    deadlines_overdue = sum(1 for dl in deadline_preview if dl.is_overdue)
    deadlines_block = DeadlinesBlock(
        total=len(deadline_preview),
        met=deadlines_met,
        overdue=deadlines_overdue,
        preview=deadline_preview,
    )

    # --- Members: email/full_name joined for assignee avatars ---------------
    # Select the User entity (not bare User.email/full_name columns): the
    # FastAPI-Users base types those attributes as plain str, which select()
    # rejects at type-check time — read them off the instance instead.
    member_rows = (
        await session.execute(
            select(ProjectMember, User)
            # User.id is typed as a plain UUID by the FastAPI-Users base, so the
            # ON expression reads as `bool` to mypy — runtime is a real clause.
            .join(User, User.id == ProjectMember.user_id)  # type: ignore[arg-type]
            .where(ProjectMember.project_id == project.id)
            .order_by(ProjectMember.created_at.asc())
        )
    ).all()
    members = [
        ProjectMemberRead(
            project_id=m.project_id,
            user_id=m.user_id,
            role=m.role,
            created_at=m.created_at,
            email=u.email,
            full_name=u.full_name,
        )
        for m, u in member_rows
    ]

    # --- Activity-over-time (weekly buckets) --------------------------------
    activity_timeline = await compute_activity_timeline(session, project.id, bucket="week")

    # --- Header stats -------------------------------------------------------
    delivery_days: int | None = None
    if project.delivery_date is not None:
        delivery_days = (project.delivery_date - datetime.now(_AMS).date()).days
    stats = OverviewStats(
        deadlines_met=deadlines_met,
        deadlines_total=len(deadline_preview),
        attachments_count=att_count,
        # The HOLDBACK chip shows dossier-only completeness, not the overall donut.
        holdback_pct=completeness.dossier.pct,
        delivery_days_remaining=delivery_days,
    )

    project_read = ProjectRead.model_validate(
        await _project_to_read(
            project, storage, my_role=my_membership.role if my_membership is not None else None
        )
    )

    cache_response(response, CACHE_TTL_PROJECT_DETAIL)
    return ProjectOverviewRead(
        project=project_read,
        completeness=completeness,
        stats=stats,
        findings=findings_block,
        certificates=certificates_block,
        attachments=attachments_block,
        reports=reports_block,
        deadlines=deadlines_block,
        members=members,
        activity_timeline=activity_timeline,
    )
