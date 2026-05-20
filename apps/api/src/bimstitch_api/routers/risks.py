"""Per-project Risicobeoordeling (Wkb risk-assessment) CRUD.

Wkb MVP backlog #13: each Project owns a flat list of Risk rows the
kwaliteitsborger curates from Bbl templates (or writes freehand). RLS
filters every read/write by tenant; project-membership + role gates
the writes. Reads are open to any project member; writes require owner
or editor.

Audit log entries (backlog #36) are TODO — once the audit_log table
exists, mutating endpoints retro-fill via the same pattern.
"""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from bimstitch_api.auth.fastapi_users import current_verified_user
from bimstitch_api.models.project_member import ProjectRole
from bimstitch_api.models.risk import Risk
from bimstitch_api.models.user import User
from bimstitch_api.routers.projects import (
    _load_project_or_404,
    _require_membership,
    _require_project_read_access,
    _require_project_writable,
    _require_role,
)
from bimstitch_api.schemas.risk import RiskCreate, RiskRead, RiskUpdate
from bimstitch_api.tenancy import get_tenant_session, require_active_organization

router = APIRouter(prefix="/projects/{project_id}/risks", tags=["risks"])


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
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
) -> Risk:
    project = await _load_project_or_404(session, project_id)
    membership = await _require_membership(session, project.id, user.id)
    _require_role(membership, ProjectRole.owner, ProjectRole.editor)
    _require_project_writable(project)

    # TODO(#36): emit audit_log entry once the table lands.
    risk = Risk(project_id=project.id, **payload.model_dump())
    session.add(risk)
    await session.flush()
    await session.refresh(risk)
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
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
) -> Risk:
    project = await _load_project_or_404(session, project_id)
    membership = await _require_membership(session, project.id, user.id)
    _require_role(membership, ProjectRole.owner, ProjectRole.editor)
    _require_project_writable(project)

    risk = await _load_risk_or_404(session, project.id, risk_id)
    updates = payload.model_dump(exclude_unset=True)
    # TODO(#36): emit audit_log entry once the table lands.
    for field, value in updates.items():
        setattr(risk, field, value)
    await session.flush()
    await session.refresh(risk)
    return risk


@router.delete("/{risk_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_risk(
    project_id: UUID,
    risk_id: UUID,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
) -> Response:
    project = await _load_project_or_404(session, project_id)
    membership = await _require_membership(session, project.id, user.id)
    _require_role(membership, ProjectRole.owner, ProjectRole.editor)
    _require_project_writable(project)

    risk = await _load_risk_or_404(session, project.id, risk_id)
    # TODO(#36): emit audit_log entry once the table lands.
    await session.delete(risk)
    await session.flush()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
