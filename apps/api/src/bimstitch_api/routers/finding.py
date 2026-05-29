"""Per-project Bevinding (inspection finding) CRUD.

Wkb MVP backlog #25: a finding is a first-class object (not a sub-record of an
inspection) so one defect can be tracked across multiple borgingsmomenten. In
the current aannemer-first mode findings are created manually from the KB's
emailed/PDF report; the `source_checklist_item_id` column is reserved for the
later auto-draft-from-failed-checklist hook.

RLS filters every read/write by tenant (schema-per-tenant); project-membership +
the `Resource.finding` permission matrix gate the writes. A finding is promoted
from `draft` to `open` by setting a deadline and an assignee.
"""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from bimstitch_api import audit
from bimstitch_api.auth.fastapi_users import current_verified_user
from bimstitch_api.auth.permissions import Action, Resource, require_permission
from bimstitch_api.models.finding import Finding, FindingSeverity, FindingStatus
from bimstitch_api.models.notification import NotificationEventType
from bimstitch_api.models.user import User
from bimstitch_api.notifications.service import create_notification
from bimstitch_api.routers.projects import (
    _get_membership,
    _load_project_or_404,
    _require_membership,
    _require_project_read_access,
    _require_project_writable,
)
from bimstitch_api.schemas.finding import FindingCreate, FindingRead, FindingUpdate
from bimstitch_api.tenancy import get_tenant_session, require_active_organization

router = APIRouter(prefix="/projects/{project_id}/findings", tags=["findings"])


def _finding_snapshot(finding: Finding) -> dict[str, str | None]:
    return {
        "title": finding.title,
        "description": finding.description,
        "severity": finding.severity.value,
        "status": finding.status.value,
        "assignee_user_id": str(finding.assignee_user_id) if finding.assignee_user_id else None,
        "deadline_date": finding.deadline_date.isoformat() if finding.deadline_date else None,
        "bbl_article_ref": finding.bbl_article_ref,
        "source_checklist_item_id": (
            str(finding.source_checklist_item_id) if finding.source_checklist_item_id else None
        ),
        "borgingsmoment_id": (
            str(finding.borgingsmoment_id) if finding.borgingsmoment_id else None
        ),
        "linked_file_id": str(finding.linked_file_id) if finding.linked_file_id else None,
        "linked_element_global_id": finding.linked_element_global_id,
    }


async def _load_finding_or_404(
    session: AsyncSession, project_id: UUID, finding_id: UUID
) -> Finding:
    """Filters on both columns so a finding under a sibling project surfaces as
    404, not a 200 leaking the row. Soft-deleted rows are also hidden."""
    finding = (
        await session.execute(
            select(Finding).where(
                Finding.id == finding_id,
                Finding.project_id == project_id,
                Finding.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if finding is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="FINDING_NOT_FOUND")
    return finding


@router.post("", response_model=FindingRead, status_code=status.HTTP_201_CREATED)
async def create_finding(
    project_id: UUID,
    payload: FindingCreate,
    request: Request,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> Finding:
    project = await _load_project_or_404(session, project_id)
    membership = await _require_membership(session, project.id, user.id)
    try:
        require_permission(membership.role, Resource.finding, Action.create)
    except HTTPException:
        await audit.log_permission_denied(
            role=membership.role.value,
            resource=Resource.finding.value,
            action=Action.create.value,
            actor_user_id=user.id,
            request=request,
        )
        raise
    _require_project_writable(project)

    finding = Finding(
        project_id=project.id,
        created_by_user_id=user.id,
        status=FindingStatus.draft,
        **payload.model_dump(),
    )
    session.add(finding)
    await session.flush()
    await session.refresh(finding)
    await audit.record(
        session,
        action="finding.created",
        resource_type="finding",
        resource_id=finding.id,
        after=_finding_snapshot(finding),
        actor_user_id=user.id,
        request=request,
    )
    return finding


@router.get("", response_model=list[FindingRead])
async def list_findings(
    project_id: UUID,
    response: Response,
    status_filter: FindingStatus | None = None,
    severity: FindingSeverity | None = None,
    linked_file_id: UUID | None = None,
    linked_element_global_id: str | None = Query(default=None, max_length=22),
    unlinked: bool = False,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> list[Finding]:
    project = await _load_project_or_404(session, project_id)
    await _require_project_read_access(session, project.id, user, active_org_id)

    stmt = (
        select(Finding)
        .where(Finding.project_id == project.id, Finding.deleted_at.is_(None))
    )
    if status_filter is not None:
        stmt = stmt.where(Finding.status == status_filter)
    if severity is not None:
        stmt = stmt.where(Finding.severity == severity)
    if linked_file_id is not None:
        stmt = stmt.where(Finding.linked_file_id == linked_file_id)
    if linked_element_global_id is not None:
        stmt = stmt.where(Finding.linked_element_global_id == linked_element_global_id)
    if unlinked:
        stmt = stmt.where(Finding.linked_element_global_id.is_(None))

    total = (await session.scalar(select(func.count()).select_from(stmt.subquery()))) or 0
    response.headers["X-Total-Count"] = str(total)

    stmt = stmt.order_by(Finding.created_at.desc()).limit(limit).offset(offset)
    result = await session.execute(stmt)
    return list(result.scalars().all())


@router.get("/{finding_id}", response_model=FindingRead)
async def get_finding(
    project_id: UUID,
    finding_id: UUID,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> Finding:
    project = await _load_project_or_404(session, project_id)
    await _require_project_read_access(session, project.id, user, active_org_id)
    return await _load_finding_or_404(session, project.id, finding_id)


@router.patch("/{finding_id}", response_model=FindingRead)
async def update_finding(
    project_id: UUID,
    finding_id: UUID,
    payload: FindingUpdate,
    request: Request,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> Finding:
    project = await _load_project_or_404(session, project_id)
    membership = await _require_membership(session, project.id, user.id)
    try:
        require_permission(membership.role, Resource.finding, Action.update)
    except HTTPException:
        await audit.log_permission_denied(
            role=membership.role.value,
            resource=Resource.finding.value,
            action=Action.update.value,
            actor_user_id=user.id,
            resource_id=finding_id,
            request=request,
        )
        raise
    _require_project_writable(project)

    finding = await _load_finding_or_404(session, project.id, finding_id)
    before = _finding_snapshot(finding)
    previous_status = finding.status

    updates = payload.model_dump(exclude_unset=True)
    for field, value in updates.items():
        setattr(finding, field, value)

    # Validate a chosen assignee actually belongs to the project so an invalid
    # id surfaces as a clean 422 rather than an FK IntegrityError 500.
    if finding.assignee_user_id is not None and "assignee_user_id" in updates:
        assignee_membership = await _get_membership(
            session, project.id, finding.assignee_user_id
        )
        if assignee_membership is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="ASSIGNEE_NOT_A_PROJECT_MEMBER",
            )

    # Promotion rule: draft -> open requires both a deadline and an assignee.
    if finding.status is FindingStatus.open and (
        finding.deadline_date is None or finding.assignee_user_id is None
    ):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="FINDING_PROMOTE_REQUIRES_DEADLINE_ASSIGNEE",
        )

    await session.flush()
    await session.refresh(finding)

    promoted = previous_status is FindingStatus.draft and finding.status is FindingStatus.open
    if promoted:
        await create_notification(
            session,
            event_type=NotificationEventType.finding_created,
            title="Nieuwe bevinding toegewezen",
            body=finding.title,
            project_id=project.id,
        )

    await audit.record(
        session,
        action="finding.promoted" if promoted else "finding.updated",
        resource_type="finding",
        resource_id=finding.id,
        before=before,
        after=_finding_snapshot(finding),
        actor_user_id=user.id,
        request=request,
    )
    return finding


@router.delete("/{finding_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_finding(
    project_id: UUID,
    finding_id: UUID,
    request: Request,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> Response:
    project = await _load_project_or_404(session, project_id)
    membership = await _require_membership(session, project.id, user.id)
    try:
        require_permission(membership.role, Resource.finding, Action.delete)
    except HTTPException:
        await audit.log_permission_denied(
            role=membership.role.value,
            resource=Resource.finding.value,
            action=Action.delete.value,
            actor_user_id=user.id,
            resource_id=finding_id,
            request=request,
        )
        raise
    _require_project_writable(project)

    finding = await _load_finding_or_404(session, project.id, finding_id)
    before = _finding_snapshot(finding)
    finding.soft_delete()
    await session.flush()
    await audit.record(
        session,
        action="finding.deleted",
        resource_type="finding",
        resource_id=finding_id,
        before=before,
        actor_user_id=user.id,
        request=request,
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
