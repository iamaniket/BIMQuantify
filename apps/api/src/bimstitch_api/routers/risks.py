"""Per-project Risicobeoordeling (Wkb risk-assessment) CRUD.

Wkb MVP backlog #13: each Project owns a flat list of Risk rows the
kwaliteitsborger curates from Bbl templates (or writes freehand). RLS
filters every read/write by tenant; project-membership + role gates
the writes. Reads are open to any project member; writes require owner
or editor.
"""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from bimstitch_api import audit
from bimstitch_api.auth.fastapi_users import current_verified_user
from bimstitch_api.auth.permissions import Action, Resource, require_permission
from bimstitch_api.models.risk import Risk
from bimstitch_api.models.user import User
from bimstitch_api.routers.projects import (
    _load_project_or_404,
    _require_membership,
    _require_project_read_access,
    _require_project_writable,
)
from bimstitch_api.schemas.risk import RiskCreate, RiskRead, RiskUpdate
from bimstitch_api.tenancy import get_tenant_session, require_active_organization

router = APIRouter(prefix="/projects/{project_id}/risks", tags=["risks"])


def _risk_snapshot(risk: Risk) -> dict:
    return {
        "category": risk.category.value,
        "level": risk.level.value,
        "description": risk.description,
        "mitigation": risk.mitigation,
        "responsible_party": risk.responsible_party,
        "bbl_article_ref": risk.bbl_article_ref,
    }


async def _load_risk_or_404(session: AsyncSession, project_id: UUID, risk_id: UUID) -> Risk:
    """Filters on both columns so a risk that lives under a sibling project
    surfaces as 404, not as a 200 leaking the row across projects."""
    risk = (
        await session.execute(select(Risk).where(Risk.id == risk_id, Risk.project_id == project_id))
    ).scalar_one_or_none()
    if risk is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="RISK_NOT_FOUND")
    return risk


@router.post("", response_model=RiskRead, status_code=status.HTTP_201_CREATED)
async def create_risk(
    project_id: UUID,
    payload: RiskCreate,
    request: Request,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> Risk:
    project = await _load_project_or_404(session, project_id)
    membership = await _require_membership(session, project.id, user.id)
    try:
        require_permission(membership.role, Resource.risk, Action.create)
    except HTTPException:
        await audit.log_permission_denied(
            role=membership.role.value,
            resource=Resource.risk.value,
            action=Action.create.value,
            actor_user_id=user.id,
            organization_id=active_org_id,
            request=request,
        )
        raise
    _require_project_writable(project)

    risk = Risk(project_id=project.id, **payload.model_dump())
    session.add(risk)
    await session.flush()
    await session.refresh(risk)
    await audit.record(
        session,
        action="risk.created",
        resource_type="risk",
        resource_id=risk.id,
        after=_risk_snapshot(risk),
        actor_user_id=user.id,
        organization_id=active_org_id,
        request=request,
    )
    return risk


@router.get("", response_model=list[RiskRead])
async def list_risks(
    project_id: UUID,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> list[Risk]:
    project = await _load_project_or_404(session, project_id)
    await _require_project_read_access(session, project.id, user, active_org_id)

    result = await session.execute(
        select(Risk)
        .where(Risk.project_id == project.id)
        .order_by(Risk.category, Risk.level, Risk.created_at)
    )
    return list(result.scalars().all())


@router.get("/{risk_id}", response_model=RiskRead)
async def get_risk(
    project_id: UUID,
    risk_id: UUID,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> Risk:
    project = await _load_project_or_404(session, project_id)
    await _require_project_read_access(session, project.id, user, active_org_id)
    return await _load_risk_or_404(session, project.id, risk_id)


@router.patch("/{risk_id}", response_model=RiskRead)
async def update_risk(
    project_id: UUID,
    risk_id: UUID,
    payload: RiskUpdate,
    request: Request,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> Risk:
    project = await _load_project_or_404(session, project_id)
    membership = await _require_membership(session, project.id, user.id)
    try:
        require_permission(membership.role, Resource.risk, Action.update)
    except HTTPException:
        await audit.log_permission_denied(
            role=membership.role.value,
            resource=Resource.risk.value,
            action=Action.update.value,
            actor_user_id=user.id,
            organization_id=active_org_id,
            resource_id=risk_id,
            request=request,
        )
        raise
    _require_project_writable(project)

    risk = await _load_risk_or_404(session, project.id, risk_id)
    before = _risk_snapshot(risk)
    updates = payload.model_dump(exclude_unset=True)
    for field, value in updates.items():
        setattr(risk, field, value)
    await session.flush()
    await session.refresh(risk)
    await audit.record(
        session,
        action="risk.updated",
        resource_type="risk",
        resource_id=risk.id,
        before=before,
        after=_risk_snapshot(risk),
        actor_user_id=user.id,
        organization_id=active_org_id,
        request=request,
    )
    return risk


@router.delete("/{risk_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_risk(
    project_id: UUID,
    risk_id: UUID,
    request: Request,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> Response:
    project = await _load_project_or_404(session, project_id)
    membership = await _require_membership(session, project.id, user.id)
    try:
        require_permission(membership.role, Resource.risk, Action.delete)
    except HTTPException:
        await audit.log_permission_denied(
            role=membership.role.value,
            resource=Resource.risk.value,
            action=Action.delete.value,
            actor_user_id=user.id,
            organization_id=active_org_id,
            resource_id=risk_id,
            request=request,
        )
        raise
    _require_project_writable(project)

    risk = await _load_risk_or_404(session, project.id, risk_id)
    before = _risk_snapshot(risk)
    await session.delete(risk)
    await session.flush()
    await audit.record(
        session,
        action="risk.deleted",
        resource_type="risk",
        resource_id=risk_id,
        before=before,
        actor_user_id=user.id,
        organization_id=active_org_id,
        request=request,
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
