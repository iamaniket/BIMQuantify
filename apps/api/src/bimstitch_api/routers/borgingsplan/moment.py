"""Borgingsmoment (moment-level) CRUD endpoints + helpers."""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from bimstitch_api import audit
from bimstitch_api.access import (
    require_membership,
    require_project_writable,
)
from bimstitch_api.auth.fastapi_users import current_verified_user
from bimstitch_api.auth.permissions import Action, Resource, require_permission
from bimstitch_api.models.borgingsmoment import Borgingsmoment
from bimstitch_api.models.borgingsplan import Borgingsplan
from bimstitch_api.models.user import User
from bimstitch_api.routers.borgingsplan.plan import _require_plan_draft
from bimstitch_api.routers.borgingsplan._shared import (
    _walk_to_project_via_moment,
    _walk_to_project_via_plan,
)
from bimstitch_api.schemas.borgingsplan import (
    BorgingsmomentCreate,
    BorgingsmomentRead,
    BorgingsmomentUpdate,
    MomentReorderRequest,
)
from bimstitch_api.tenancy import get_tenant_session, require_active_organization

moment_router = APIRouter(tags=["borgingsplan"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _reload_moment_with_items(
    session: AsyncSession, moment_id: UUID
) -> Borgingsmoment:
    return (
        await session.execute(
            select(Borgingsmoment)
            .options(selectinload(Borgingsmoment.checklist_items))
            .where(Borgingsmoment.id == moment_id)
        )
    ).scalar_one()


async def _load_moment_by_id_or_404(
    session: AsyncSession, moment_id: UUID
) -> Borgingsmoment:
    moment = (
        await session.execute(
            select(Borgingsmoment).where(Borgingsmoment.id == moment_id)
        )
    ).scalar_one_or_none()
    if moment is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="BORGINGSMOMENT_NOT_FOUND"
        )
    return moment


async def _load_moment_in_plan_or_404(
    session: AsyncSession, plan_id: UUID, moment_id: UUID
) -> Borgingsmoment:
    moment = (
        await session.execute(
            select(Borgingsmoment).where(
                Borgingsmoment.id == moment_id, Borgingsmoment.borgingsplan_id == plan_id
            )
        )
    ).scalar_one_or_none()
    if moment is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="BORGINGSMOMENT_NOT_FOUND"
        )
    return moment


# ---------------------------------------------------------------------------
# Moment-level endpoints
# ---------------------------------------------------------------------------


@moment_router.post(
    "/borgingsplans/{plan_id}/moments",
    response_model=BorgingsmomentRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_moment(
    plan_id: UUID,
    payload: BorgingsmomentCreate,
    request: Request,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> Borgingsmoment:
    plan = (
        await session.execute(select(Borgingsplan).where(Borgingsplan.id == plan_id))
    ).scalar_one_or_none()
    if plan is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="BORGINGSPLAN_NOT_FOUND"
        )
    project = await _walk_to_project_via_plan(session, plan)
    membership = await require_membership(session, project.id, user.id)
    try:
        require_permission(membership.role, Resource.assurance_plan, Action.create)
    except HTTPException:
        await audit.log_permission_denied(
            role=membership.role.value,
            resource=Resource.assurance_plan.value,
            action=Action.create.value,
            actor_user_id=user.id,
            resource_id=plan_id,
            request=request,
        )
        raise
    require_project_writable(project)
    _require_plan_draft(plan)

    seq = payload.sequence_in_phase
    if seq is None:
        max_seq = (
            await session.execute(
                select(func.coalesce(func.max(Borgingsmoment.sequence_in_phase), -1))
                .where(
                    Borgingsmoment.borgingsplan_id == plan.id,
                    Borgingsmoment.phase == payload.phase,
                )
            )
        ).scalar_one()
        seq = int(max_seq) + 1

    data = payload.model_dump(exclude={"sequence_in_phase"})
    moment = Borgingsmoment(
        borgingsplan_id=plan.id,
        project_id=project.id,
        sequence_in_phase=seq,
        **data,
    )
    session.add(moment)
    await session.flush()
    await audit.record(
        session,
        action="borgingsmoment.created",
        resource_type="borgingsmoment",
        resource_id=moment.id,
        after={
            "phase": moment.phase.value,
            "planned_date": str(moment.planned_date) if moment.planned_date else None,
            "sequence_in_phase": moment.sequence_in_phase,
        },
        actor_user_id=user.id,
        project_id=project.id,
        request=request,
    )
    return await _reload_moment_with_items(session, moment.id)


@moment_router.patch(
    "/borgingsplans/{plan_id}/moments/{moment_id}", response_model=BorgingsmomentRead
)
async def update_moment(
    plan_id: UUID,
    moment_id: UUID,
    payload: BorgingsmomentUpdate,
    request: Request,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> Borgingsmoment:
    moment = await _load_moment_in_plan_or_404(session, plan_id, moment_id)
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

    updates = payload.model_dump(exclude_unset=True)
    before = {k: (v.value if hasattr(v, "value") else str(v) if v is not None else None)
               for k, v in ((f, getattr(moment, f)) for f in updates)}
    for field, value in updates.items():
        setattr(moment, field, value)
    await session.flush()
    after = {k: (v.value if hasattr(v, "value") else str(v) if v is not None else None)
              for k, v in ((f, getattr(moment, f)) for f in updates)}
    await audit.record(
        session,
        action="borgingsmoment.updated",
        resource_type="borgingsmoment",
        resource_id=moment.id,
        before=before,
        after=after,
        actor_user_id=user.id,
        project_id=project.id,
        request=request,
    )
    return await _reload_moment_with_items(session, moment.id)


@moment_router.delete(
    "/borgingsplans/{plan_id}/moments/{moment_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_moment(
    plan_id: UUID,
    moment_id: UUID,
    request: Request,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> Response:
    moment = await _load_moment_in_plan_or_404(session, plan_id, moment_id)
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
            resource_id=moment_id,
            request=request,
        )
        raise
    require_project_writable(project)
    _require_plan_draft(plan)

    before = {"phase": moment.phase.value, "sequence_in_phase": moment.sequence_in_phase}
    await session.delete(moment)
    await session.flush()
    await audit.record(
        session,
        action="borgingsmoment.deleted",
        resource_type="borgingsmoment",
        resource_id=moment_id,
        before=before,
        actor_user_id=user.id,
        project_id=project.id,
        request=request,
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@moment_router.post(
    "/borgingsplans/{plan_id}/moments/reorder",
    response_model=list[BorgingsmomentRead],
)
async def reorder_moments(
    plan_id: UUID,
    payload: MomentReorderRequest,
    request: Request,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> list[Borgingsmoment]:
    plan = (
        await session.execute(select(Borgingsplan).where(Borgingsplan.id == plan_id))
    ).scalar_one_or_none()
    if plan is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="BORGINGSPLAN_NOT_FOUND"
        )
    project = await _walk_to_project_via_plan(session, plan)
    membership = await require_membership(session, project.id, user.id)
    try:
        require_permission(membership.role, Resource.assurance_plan, Action.update)
    except HTTPException:
        await audit.log_permission_denied(
            role=membership.role.value,
            resource=Resource.assurance_plan.value,
            action=Action.update.value,
            actor_user_id=user.id,
            resource_id=plan_id,
            request=request,
        )
        raise
    require_project_writable(project)
    _require_plan_draft(plan)

    existing = (
        await session.execute(
            select(Borgingsmoment).where(
                Borgingsmoment.borgingsplan_id == plan.id,
                Borgingsmoment.phase == payload.phase,
            )
        )
    ).scalars().all()
    by_id = {m.id: m for m in existing}

    if set(by_id.keys()) != set(payload.moment_ids) or len(payload.moment_ids) != len(
        by_id
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="REORDER_MOMENT_IDS_MISMATCH",
        )

    for index, mid in enumerate(payload.moment_ids):
        by_id[mid].sequence_in_phase = index
    await session.flush()
    await audit.record(
        session,
        action="borgingsmoment.reordered",
        resource_type="borgingsmoment",
        resource_id=plan_id,
        after={"phase": payload.phase.value, "order": [str(mid) for mid in payload.moment_ids]},
        actor_user_id=user.id,
        project_id=project.id,
        request=request,
    )

    refreshed = (
        await session.execute(
            select(Borgingsmoment)
            .options(selectinload(Borgingsmoment.checklist_items))
            .where(
                Borgingsmoment.borgingsplan_id == plan.id,
                Borgingsmoment.phase == payload.phase,
            )
            .order_by(Borgingsmoment.sequence_in_phase)
        )
    ).scalars().all()
    return list(refreshed)
