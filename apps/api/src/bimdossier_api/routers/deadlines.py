"""Per-project deadline endpoints.

System-managed deadlines — users cannot create or delete them. The
`recompute_deadlines()` service upserts rows on project create and
whenever date fields change. Users can only list/get deadlines and
mark them as met.

`is_overdue` is computed at read time (status == pending AND due_date < today
in Europe/Amsterdam timezone) — no background cron needed.
"""

from __future__ import annotations

from datetime import datetime
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from bimdossier_api import audit
from bimdossier_api.access import (
    load_project_or_404,
    require_membership,
    require_project_read_access,
)
from bimdossier_api.auth.fastapi_users import current_verified_user
from bimdossier_api.auth.permissions import Action, Resource, require_permission
from bimdossier_api.jurisdictions import get_deadline_rules, get_dossier_requirements, pick_label
from bimdossier_api.models.certificate import Certificate, CertificateStatus
from bimdossier_api.models.deadline import Deadline, DeadlineStatus
from bimdossier_api.models.finding import Finding, FindingStatus
from bimdossier_api.models.document import Document
from bimdossier_api.models.project_file import (
    ExtractionStatus,
    FileType,
    ProjectFile,
    ProjectFileRole,
    ProjectFileStatus,
)
from bimdossier_api.models.user import User
from bimdossier_api.schemas.deadline import DeadlineFileMet, DeadlineRead
from bimdossier_api.tenancy import get_tenant_session, require_active_organization

router = APIRouter(prefix="/projects/{project_id}/deadlines", tags=["deadlines"])

_AMS = ZoneInfo("Europe/Amsterdam")


def _serialize_deadline(dl: Deadline) -> DeadlineRead:
    """Build a DeadlineRead with the computed is_overdue flag."""
    today = datetime.now(_AMS).date()
    is_overdue = (
        dl.status == DeadlineStatus.pending
        and dl.due_date is not None
        and dl.due_date < today
    )
    return DeadlineRead(
        id=dl.id,
        project_id=dl.project_id,
        deadline_type=dl.deadline_type,
        due_date=dl.due_date,
        status=dl.status,
        met_at=dl.met_at,
        met_by_user_id=dl.met_by_user_id,
        reference_number=dl.reference_number,
        filing_notes=dl.filing_notes,
        filed_at=dl.filed_at,
        is_overdue=is_overdue,
        created_at=dl.created_at,
        updated_at=dl.updated_at,
    )


async def _load_deadline_or_404(
    session: AsyncSession, project_id: UUID, deadline_id: UUID
) -> Deadline:
    dl = (
        await session.execute(
            select(Deadline).where(
                Deadline.id == deadline_id, Deadline.project_id == project_id
            )
        )
    ).scalar_one_or_none()
    if dl is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="DEADLINE_NOT_FOUND"
        )
    return dl


@router.get("", response_model=list[DeadlineRead])
async def list_deadlines(
    project_id: UUID,
    response: Response,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> list[DeadlineRead]:
    project = await load_project_or_404(session, project_id)
    await require_project_read_access(session, project.id, user, active_org_id)

    base = select(Deadline).where(Deadline.project_id == project.id)
    total = (await session.scalar(select(func.count()).select_from(base.subquery()))) or 0
    response.headers["X-Total-Count"] = str(total)

    result = await session.execute(
        base.order_by(Deadline.due_date.asc().nulls_last()).limit(limit).offset(offset)
    )
    return [_serialize_deadline(dl) for dl in result.scalars().all()]


@router.get("/{deadline_id}", response_model=DeadlineRead)
async def get_deadline(
    project_id: UUID,
    deadline_id: UUID,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> DeadlineRead:
    project = await load_project_or_404(session, project_id)
    await require_project_read_access(session, project.id, user, active_org_id)
    dl = await _load_deadline_or_404(session, project.id, deadline_id)
    return _serialize_deadline(dl)


class ReadinessItem(BaseModel):
    code: str
    label: str
    category: str
    required: bool
    fulfilled: bool
    count: int


class DeadlineReadiness(BaseModel):
    deadline_id: UUID
    deadline_type: str
    items: list[ReadinessItem]
    ready_count: int
    total_required: int
    is_ready: bool


async def _count_ready_attachments_in_slot(
    session: AsyncSession,
    project_id: UUID,
    slot: str,
) -> int:
    """Count ready, non-deleted attachments tagged with the given dossier slot."""
    return (
        await session.scalar(
            select(func.count()).select_from(
                select(ProjectFile.id).where(
                    ProjectFile.project_id == project_id,
                    ProjectFile.role == ProjectFileRole.attachment,
                    ProjectFile.dossier_slot == slot,
                    ProjectFile.status == ProjectFileStatus.ready,
                    ProjectFile.deleted_at.is_(None),
                ).subquery()
            )
        )
    ) or 0


async def _count_models(session: AsyncSession, project_id: UUID) -> int:
    """Count non-deleted BIM models in the project."""
    return (
        await session.scalar(
            select(func.count()).select_from(
                select(Document.id).where(
                    Document.project_id == project_id,
                    Document.deleted_at.is_(None),
                ).subquery()
            )
        )
    ) or 0


async def _count_viewable_models(session: AsyncSession, project_id: UUID) -> int:
    """Count distinct models with at least one *viewable* model-source file.

    "Viewable" mirrors the portal: a ready IFC whose geometry extraction
    succeeded, or a ready PDF (something the 3D/2D viewer can actually open).
    A model that exists but is still processing — or has no file — does not
    count. This is what fulfils the model-backed "drawings" dossier slot.
    """
    return (
        await session.scalar(
            select(func.count(func.distinct(ProjectFile.document_id))).where(
                ProjectFile.project_id == project_id,
                ProjectFile.role == ProjectFileRole.model_source,
                ProjectFile.deleted_at.is_(None),
                ProjectFile.document_id.is_not(None),
                ProjectFile.status == ProjectFileStatus.ready,
                (
                    (
                        (ProjectFile.file_type == FileType.ifc)
                        & (ProjectFile.extraction_status == ExtractionStatus.succeeded)
                    )
                    | (ProjectFile.file_type == FileType.pdf)
                ),
            )
        )
    ) or 0


async def _check_fulfillment(
    session: AsyncSession,
    project_id: UUID,
    source_kind: str,
    source_value: str,
) -> tuple[bool, int]:
    """Check whether a single dossier requirement is fulfilled.

    Returns (fulfilled, count) where count is the number of matching items.
    """
    if source_kind == "attachment_slot":
        count = await _count_ready_attachments_in_slot(session, project_id, source_value)
        return count > 0, count

    if source_kind == "certificate_type":
        count = (
            await session.scalar(
                select(func.count()).select_from(
                    select(Certificate.id).where(
                        Certificate.project_id == project_id,
                        Certificate.certificate_type == source_value,
                        Certificate.status == CertificateStatus.ready,
                        Certificate.deleted_at.is_(None),
                    ).subquery()
                )
            )
        ) or 0
        return count > 0, count

    if source_kind == "derived":
        if source_value == "findings":
            open_count = (
                await session.scalar(
                    select(func.count()).select_from(
                        select(Finding.id).where(
                            Finding.project_id == project_id,
                            Finding.status.in_(
                                [FindingStatus.open, FindingStatus.in_progress]
                            ),
                            Finding.deleted_at.is_(None),
                        ).subquery()
                    )
                )
            ) or 0
            return open_count == 0, open_count

        if source_value == "deadlines":
            today = datetime.now(_AMS).date()
            overdue_count = (
                await session.scalar(
                    select(func.count()).select_from(
                        select(Deadline.id).where(
                            Deadline.project_id == project_id,
                            Deadline.status == DeadlineStatus.pending,
                            Deadline.due_date < today,
                        ).subquery()
                    )
                )
            ) or 0
            return overdue_count == 0, overdue_count

        if source_value == "documents":
            count = await _count_models(session, project_id)
            return count > 0, count

    if source_kind == "document" and source_value == "documents":
        # Drawings: a viewable/processed model (ready+extracted IFC or ready
        # PDF). Documents still processing — or without a file — don't count.
        count = await _count_viewable_models(session, project_id)
        return count > 0, count

    return False, 0


@router.get("/{deadline_id}/readiness", response_model=DeadlineReadiness)
async def get_deadline_readiness(
    project_id: UUID,
    deadline_id: UUID,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> DeadlineReadiness:
    project = await load_project_or_404(session, project_id)
    await require_project_read_access(session, project.id, user, active_org_id)
    dl = await _load_deadline_or_404(session, project.id, deadline_id)

    rules = get_deadline_rules(project.country)
    rule = next((r for r in rules if r.deadline_type == dl.deadline_type), None)

    if rule is None or not rule.required_dossier_codes:
        return DeadlineReadiness(
            deadline_id=dl.id,
            deadline_type=dl.deadline_type,
            items=[],
            ready_count=0,
            total_required=0,
            is_ready=True,
        )

    bt = project.building_type.value if project.building_type else None
    all_reqs = get_dossier_requirements(project.country, bt)
    req_by_code = {r.code: r for r in all_reqs}

    items: list[ReadinessItem] = []
    ready_count = 0
    total_required = 0

    for code in rule.required_dossier_codes:
        req = req_by_code.get(code)
        if req is None:
            continue

        label = pick_label(req.label, "en", "nl")
        fulfilled, count = await _check_fulfillment(
            session, project.id, req.source_kind, req.source_value
        )

        if req.required:
            total_required += 1
            if fulfilled:
                ready_count += 1

        items.append(
            ReadinessItem(
                code=code,
                label=label,
                category=req.category,
                required=req.required,
                fulfilled=fulfilled,
                count=count,
            )
        )

    return DeadlineReadiness(
        deadline_id=dl.id,
        deadline_type=dl.deadline_type,
        items=items,
        ready_count=ready_count,
        total_required=total_required,
        is_ready=ready_count >= total_required,
    )


@router.patch("/{deadline_id}", response_model=DeadlineRead)
async def mark_deadline_met(
    project_id: UUID,
    deadline_id: UUID,
    request: Request,
    body: DeadlineFileMet | None = None,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
) -> DeadlineRead:
    """Mark a pending deadline as met / filed.

    Idempotent: calling on an already-met deadline is a no-op 200.
    Rejects not_applicable deadlines (there's nothing to mark).
    Accepts optional filing metadata (reference number, notes).
    """
    project = await load_project_or_404(session, project_id)
    membership = await require_membership(session, project.id, user.id)
    require_permission(membership.role, Resource.deadline, Action.update)

    dl = await _load_deadline_or_404(session, project.id, deadline_id)

    if dl.status == DeadlineStatus.not_applicable:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="DEADLINE_NOT_APPLICABLE",
        )

    if dl.status == DeadlineStatus.pending:
        now = datetime.now(_AMS)
        dl.status = DeadlineStatus.met
        dl.met_at = now
        dl.met_by_user_id = user.id
        dl.filed_at = now
        if body:
            dl.reference_number = body.reference_number
            dl.filing_notes = body.filing_notes
        await session.flush()

        await audit.record(
            session,
            action="deadline.filed",
            resource_type="deadline",
            resource_id=dl.id,
            before={"status": "pending"},
            after={
                "status": "met",
                "reference_number": dl.reference_number,
                "filed_at": dl.filed_at.isoformat() if dl.filed_at else None,
            },
            actor_user_id=user.id,
            project_id=project.id,
            request=request,
        )

        await session.refresh(dl)

    return _serialize_deadline(dl)
