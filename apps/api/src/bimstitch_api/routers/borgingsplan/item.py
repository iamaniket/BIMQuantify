"""Checklist-item CRUD endpoints.

These endpoints register on the SAME `moment_router` defined in `.moment`
(imported below) so routes/operation_ids stay identical to the pre-split
module. The package `__init__` side-effect-imports this module so the
decorators run and the routes register.
"""

from uuid import UUID

from fastapi import Depends, HTTPException, Request, Response, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from bimstitch_api import audit
from bimstitch_api.access import (
    require_membership,
    require_project_writable,
)
from bimstitch_api.auth.fastapi_users import current_verified_user
from bimstitch_api.auth.permissions import Action, Resource, require_permission
from bimstitch_api.models.checklist_item import ChecklistItem
from bimstitch_api.models.user import User
from bimstitch_api.routers.borgingsplan.moment import (
    _load_moment_by_id_or_404,
    moment_router,
)
from bimstitch_api.routers.borgingsplan.plan import _require_plan_draft
from bimstitch_api.routers.borgingsplan._shared import _walk_to_project_via_moment
from bimstitch_api.schemas.borgingsplan import (
    ChecklistItemCreate,
    ChecklistItemRead,
    ChecklistItemReorderRequest,
    ChecklistItemUpdate,
)
from bimstitch_api.tenancy import get_tenant_session, require_active_organization


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _load_item_in_moment_or_404(
    session: AsyncSession, moment_id: UUID, item_id: UUID
) -> ChecklistItem:
    item = (
        await session.execute(
            select(ChecklistItem).where(
                ChecklistItem.id == item_id,
                ChecklistItem.borgingsmoment_id == moment_id,
            )
        )
    ).scalar_one_or_none()
    if item is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="CHECKLIST_ITEM_NOT_FOUND"
        )
    return item


# ---------------------------------------------------------------------------
# Checklist-item endpoints
# ---------------------------------------------------------------------------


@moment_router.post(
    "/borgingsmomenten/{moment_id}/checklist-items",
    response_model=ChecklistItemRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_checklist_item(
    moment_id: UUID,
    payload: ChecklistItemCreate,
    request: Request,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> ChecklistItem:
    moment = await _load_moment_by_id_or_404(session, moment_id)
    project, plan = await _walk_to_project_via_moment(session, moment)
    membership = await require_membership(session, project.id, user.id)
    try:
        require_permission(membership.role, Resource.assurance_plan, Action.create)
    except HTTPException:
        await audit.log_permission_denied(
            role=membership.role.value,
            resource=Resource.assurance_plan.value,
            action=Action.create.value,
            actor_user_id=user.id,
            resource_id=moment_id,
            request=request,
        )
        raise
    require_project_writable(project)
    _require_plan_draft(plan)

    seq = payload.sequence
    if seq is None:
        max_seq = (
            await session.execute(
                select(func.coalesce(func.max(ChecklistItem.sequence), -1)).where(
                    ChecklistItem.borgingsmoment_id == moment.id
                )
            )
        ).scalar_one()
        seq = int(max_seq) + 1

    data = payload.model_dump(exclude={"sequence"})
    item = ChecklistItem(
        borgingsmoment_id=moment.id,
        project_id=project.id,
        sequence=seq,
        **data,
    )
    session.add(item)
    await session.flush()
    await session.refresh(item)
    await audit.record(
        session,
        action="checklist_item.created",
        resource_type="checklist_item",
        resource_id=item.id,
        after={
            "moment_id": str(moment.id),
            "description": item.description,
            "evidence_type": item.evidence_type.value if item.evidence_type else None,
            "sequence": item.sequence,
        },
        actor_user_id=user.id,
        project_id=project.id,
        request=request,
    )
    return item


@moment_router.patch(
    "/borgingsmomenten/{moment_id}/checklist-items/{item_id}",
    response_model=ChecklistItemRead,
)
async def update_checklist_item(
    moment_id: UUID,
    item_id: UUID,
    payload: ChecklistItemUpdate,
    request: Request,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> ChecklistItem:
    moment = await _load_moment_by_id_or_404(session, moment_id)
    project, plan = await _walk_to_project_via_moment(session, moment)
    membership = await require_membership(session, project.id, user.id)
    try:
        require_permission(membership.role, Resource.assurance_plan, Action.update)
    except HTTPException:
        await audit.log_permission_denied(
            role=membership.role.value,
            resource=Resource.assurance_plan.value,
            action=Action.update.value,
            actor_user_id=user.id,
            resource_id=item_id,
            request=request,
        )
        raise
    require_project_writable(project)
    _require_plan_draft(plan)

    item = await _load_item_in_moment_or_404(session, moment.id, item_id)
    updates = payload.model_dump(exclude_unset=True)
    before = {k: (v.value if hasattr(v, "value") else str(v) if v is not None else None) for k, v in ((f, getattr(item, f)) for f in updates)}
    for field, value in updates.items():
        setattr(item, field, value)
    await session.flush()
    await session.refresh(item)
    after = {k: (v.value if hasattr(v, "value") else str(v) if v is not None else None) for k, v in ((f, getattr(item, f)) for f in updates)}
    await audit.record(
        session,
        action="checklist_item.updated",
        resource_type="checklist_item",
        resource_id=item.id,
        before=before,
        after=after,
        actor_user_id=user.id,
        project_id=project.id,
        request=request,
    )
    return item


@moment_router.delete(
    "/borgingsmomenten/{moment_id}/checklist-items/{item_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_checklist_item(
    moment_id: UUID,
    item_id: UUID,
    request: Request,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> Response:
    moment = await _load_moment_by_id_or_404(session, moment_id)
    project, plan = await _walk_to_project_via_moment(session, moment)
    membership = await require_membership(session, project.id, user.id)
    try:
        require_permission(membership.role, Resource.assurance_plan, Action.delete)
    except HTTPException:
        await audit.log_permission_denied(
            role=membership.role.value,
            resource=Resource.assurance_plan.value,
            action=Action.delete.value,
            actor_user_id=user.id,
            resource_id=item_id,
            request=request,
        )
        raise
    require_project_writable(project)
    _require_plan_draft(plan)

    item = await _load_item_in_moment_or_404(session, moment.id, item_id)
    before = {"description": item.description, "sequence": item.sequence}
    await session.delete(item)
    await session.flush()
    await audit.record(
        session,
        action="checklist_item.deleted",
        resource_type="checklist_item",
        resource_id=item_id,
        before=before,
        actor_user_id=user.id,
        project_id=project.id,
        request=request,
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@moment_router.post(
    "/borgingsmomenten/{moment_id}/checklist-items/reorder",
    response_model=list[ChecklistItemRead],
)
async def reorder_checklist_items(
    moment_id: UUID,
    payload: ChecklistItemReorderRequest,
    request: Request,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> list[ChecklistItem]:
    moment = await _load_moment_by_id_or_404(session, moment_id)
    project, plan = await _walk_to_project_via_moment(session, moment)
    membership = await require_membership(session, project.id, user.id)
    try:
        require_permission(membership.role, Resource.assurance_plan, Action.update)
    except HTTPException:
        await audit.log_permission_denied(
            role=membership.role.value,
            resource=Resource.assurance_plan.value,
            action=Action.update.value,
            actor_user_id=user.id,
            resource_id=moment_id,
            request=request,
        )
        raise
    require_project_writable(project)
    _require_plan_draft(plan)

    existing = (
        await session.execute(
            select(ChecklistItem).where(
                ChecklistItem.borgingsmoment_id == moment.id
            )
        )
    ).scalars().all()
    by_id = {it.id: it for it in existing}

    if set(by_id.keys()) != set(payload.item_ids) or len(payload.item_ids) != len(
        by_id
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="REORDER_ITEM_IDS_MISMATCH",
        )

    for index, iid in enumerate(payload.item_ids):
        by_id[iid].sequence = index
    await session.flush()
    await audit.record(
        session,
        action="checklist_item.reordered",
        resource_type="checklist_item",
        resource_id=moment_id,
        after={"order": [str(iid) for iid in payload.item_ids]},
        actor_user_id=user.id,
        project_id=project.id,
        request=request,
    )

    refreshed = (
        await session.execute(
            select(ChecklistItem)
            .where(ChecklistItem.borgingsmoment_id == moment.id)
            .order_by(ChecklistItem.sequence)
        )
    ).scalars().all()
    return list(refreshed)
