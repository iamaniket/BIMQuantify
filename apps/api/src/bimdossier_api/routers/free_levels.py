"""Free-tier Levels CRUD — pooled `public.free_levels` (mirror of routers/levels.py).

A free user groups PDF drawings by building level (the shared 2D/3D spine). Owner
writes, members read; owner-OR-member RLS (`get_free_session`) is the isolation
boundary, the explicit owner load is the permission gate. Reuses the paid Level
schemas so the portal renders free levels through the identical components.

A 2D drawing is assigned to a level via the free document PATCH (`level_id`).
"""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from bimdossier_api.auth.fastapi_users import current_verified_user
from bimdossier_api.models.free_level import FreeLevel
from bimdossier_api.models.user import User
from bimdossier_api.routers.free_access import (
    assert_free_account_not_expired,
    require_free_tier_enabled,
)
from bimdossier_api.routers.free_projects import (
    _load_accessible_free_project_or_404,
    _load_free_project_or_404,
)
from bimdossier_api.schemas.level import LevelCreate, LevelRead, LevelUpdate
from bimdossier_api.tenancy import get_free_session

router = APIRouter(
    prefix="/free/projects/{project_id}/levels",
    tags=["free-viewer"],
    dependencies=[Depends(require_free_tier_enabled)],
)


def _to_read(level: FreeLevel) -> LevelRead:
    return LevelRead(
        id=level.id,
        project_id=level.free_project_id,
        name=level.name,
        elevation_m=level.elevation_m,
        ordering=level.ordering,
        source=level.source,
        created_at=level.created_at,
        updated_at=level.updated_at,
    )


async def _load_free_level_or_404(
    session: AsyncSession, project_id: UUID, level_id: UUID
) -> FreeLevel:
    level = (
        await session.execute(
            select(FreeLevel).where(
                FreeLevel.id == level_id,
                FreeLevel.free_project_id == project_id,
                FreeLevel.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if level is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="LEVEL_NOT_FOUND")
    return level


@router.post("", response_model=LevelRead, status_code=status.HTTP_201_CREATED)
async def create_free_level(
    project_id: UUID,
    payload: LevelCreate,
    user: User = Depends(current_verified_user),
    session: AsyncSession = Depends(get_free_session),
) -> LevelRead:
    project = await _load_free_project_or_404(session, project_id, user.id)  # owner-only
    await assert_free_account_not_expired(user)
    level = FreeLevel(
        owner_user_id=project.owner_user_id,
        free_project_id=project.id,
        name=payload.name,
        elevation_m=payload.elevation_m,
        ordering=payload.ordering,
        source="manual",
    )
    session.add(level)
    try:
        await session.flush()
    except IntegrityError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="LEVEL_NAME_CONFLICT"
        ) from exc
    return _to_read(level)


@router.get("", response_model=list[LevelRead])
async def list_free_levels(
    project_id: UUID,
    user: User = Depends(current_verified_user),
    session: AsyncSession = Depends(get_free_session),
) -> list[LevelRead]:
    await _load_accessible_free_project_or_404(session, project_id)  # owner-or-member
    rows = (
        (
            await session.execute(
                select(FreeLevel)
                .where(
                    FreeLevel.free_project_id == project_id,
                    FreeLevel.deleted_at.is_(None),
                )
                # Ascending by floor: ordering then elevation (NULLs last), name tiebreak.
                .order_by(
                    FreeLevel.ordering.asc(),
                    FreeLevel.elevation_m.asc(),
                    FreeLevel.name.asc(),
                )
            )
        )
        .scalars()
        .all()
    )
    return [_to_read(r) for r in rows]


@router.patch("/{level_id}", response_model=LevelRead)
async def update_free_level(
    project_id: UUID,
    level_id: UUID,
    payload: LevelUpdate,
    user: User = Depends(current_verified_user),
    session: AsyncSession = Depends(get_free_session),
) -> LevelRead:
    await _load_free_project_or_404(session, project_id, user.id)  # owner-only
    await assert_free_account_not_expired(user)
    level = await _load_free_level_or_404(session, project_id, level_id)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(level, field, value)
    try:
        await session.flush()
    except IntegrityError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="LEVEL_NAME_CONFLICT"
        ) from exc
    # Refresh so the onupdate-expired `updated_at` is re-fetched in the async
    # context (else _to_read lazy-loads it → MissingGreenlet).
    await session.refresh(level)
    return _to_read(level)


@router.delete("/{level_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_free_level(
    project_id: UUID,
    level_id: UUID,
    user: User = Depends(current_verified_user),
    session: AsyncSession = Depends(get_free_session),
) -> Response:
    await _load_free_project_or_404(session, project_id, user.id)  # owner-only
    level = await _load_free_level_or_404(session, project_id, level_id)
    # Hard delete (mirrors paid delete_level): free_documents.level_id is SET NULL,
    # so assigned drawings revert to Unassigned.
    await session.delete(level)
    await session.flush()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


__all__ = ["router"]
