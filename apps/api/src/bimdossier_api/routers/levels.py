"""CRUD endpoints for a project's Levels (the shared 2D/3D spine).

Levels are project-owned: they exist for 2D-only projects (created manually
here) and for 3D projects (auto-created during IFC extraction reconciliation,
``source='ifc'`` — see ``jobs_internal._upsert_storeys``). A 2D drawing document
is assigned to a level via ``PATCH /projects/{id}/documents/{id}`` (``level_id``).

Authorization mirrors documents (``Resource.document``): any project member can
read; owner/editor can mutate.
"""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from bimdossier_api import audit
from bimdossier_api.access import (
    load_project_or_404,
    require_membership,
    require_project_read_access,
    require_project_writable,
)
from bimdossier_api.auth.fastapi_users import current_verified_user
from bimdossier_api.auth.permissions import Action, Resource, require_permission
from bimdossier_api.models.levels import Level, LevelSource
from bimdossier_api.models.user import User
from bimdossier_api.pagination import set_total_count
from bimdossier_api.schemas.level import LevelCreate, LevelRead, LevelUpdate
from bimdossier_api.tenancy import get_tenant_session, require_active_organization

router = APIRouter(prefix="/projects/{project_id}/levels", tags=["levels"])


async def _load_level_or_404(session: AsyncSession, project_id: UUID, level_id: UUID) -> Level:
    level = (
        await session.execute(
            select(Level).where(
                Level.id == level_id,
                Level.project_id == project_id,
                Level.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if level is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="LEVEL_NOT_FOUND")
    return level


@router.post("", response_model=LevelRead, status_code=status.HTTP_201_CREATED)
async def create_level(
    project_id: UUID,
    payload: LevelCreate,
    request: Request,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> Level:
    project = await load_project_or_404(session, project_id)
    membership = await require_membership(session, project.id, user.id)
    require_permission(membership.role, Resource.document, Action.create)
    require_project_writable(project)

    level = Level(
        project_id=project.id,
        name=payload.name,
        elevation_m=payload.elevation_m,
        ordering=payload.ordering,
        source=LevelSource.manual,
    )
    session.add(level)
    try:
        await session.flush()
    except IntegrityError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="LEVEL_NAME_CONFLICT"
        ) from exc
    await session.refresh(level)

    await audit.record(
        session,
        action="level.created",
        resource_type="level",
        resource_id=level.id,
        after={"name": level.name, "elevation_m": level.elevation_m, "source": level.source},
        actor_user_id=user.id,
        project_id=project.id,
        request=request,
    )
    return level


@router.get("", response_model=list[LevelRead])
async def list_levels(
    project_id: UUID,
    response: Response,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> list[Level]:
    project = await load_project_or_404(session, project_id)
    await require_project_read_access(session, project.id, user, active_org_id)

    stmt = select(Level).where(Level.project_id == project.id, Level.deleted_at.is_(None))
    total = (await session.scalar(select(func.count()).select_from(stmt.subquery()))) or 0
    set_total_count(response, total)

    # Ascending by floor: ordering then elevation (ASC sorts NULLs last), name
    # as the stable tiebreaker.
    stmt = stmt.order_by(Level.ordering.asc(), Level.elevation_m.asc(), Level.name.asc())
    return list((await session.execute(stmt)).scalars().all())


@router.patch("/{level_id}", response_model=LevelRead)
async def update_level(
    project_id: UUID,
    level_id: UUID,
    payload: LevelUpdate,
    request: Request,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> Level:
    project = await load_project_or_404(session, project_id)
    membership = await require_membership(session, project.id, user.id)
    require_permission(membership.role, Resource.document, Action.update)
    require_project_writable(project)

    level = await _load_level_or_404(session, project.id, level_id)
    updates = payload.model_dump(exclude_unset=True)
    before = {k: getattr(level, k) for k in updates}
    for field, value in updates.items():
        setattr(level, field, value)
    try:
        await session.flush()
    except IntegrityError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="LEVEL_NAME_CONFLICT"
        ) from exc
    await session.refresh(level)

    await audit.record(
        session,
        action="level.updated",
        resource_type="level",
        resource_id=level.id,
        before=before,
        after={k: getattr(level, k) for k in updates},
        actor_user_id=user.id,
        project_id=project.id,
        request=request,
    )
    return level


@router.delete("/{level_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_level(
    project_id: UUID,
    level_id: UUID,
    request: Request,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> Response:
    project = await load_project_or_404(session, project_id)
    membership = await require_membership(session, project.id, user.id)
    require_permission(membership.role, Resource.document, Action.delete)
    require_project_writable(project)

    level = await _load_level_or_404(session, project.id, level_id)
    # Hard delete (mirrors delete_model): the FKs do the cleanup — models.level_id
    # and storeys.level_id are ON DELETE SET NULL (drawings revert to Unassigned,
    # storeys unlink), and aligned_sheets.level_id is ON DELETE CASCADE.
    await audit.record(
        session,
        action="level.deleted",
        resource_type="level",
        resource_id=level.id,
        before={"name": level.name, "elevation_m": level.elevation_m, "source": level.source},
        actor_user_id=user.id,
        project_id=project.id,
        request=request,
    )
    await session.delete(level)
    await session.flush()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


__all__ = ["router"]
