"""CRUD endpoints for a project's Levels (the shared 2D/3D spine).

Levels are project-owned: they exist for 2D-only projects (created manually
here) and for 3D projects (auto-created during IFC extraction reconciliation,
``source='ifc'`` — see ``jobs_internal._upsert_storeys``). A 2D drawing document
is assigned to a level via ``PATCH /projects/{id}/documents/{id}`` (``level_id``).

Authorization mirrors documents (``Resource.document``): any project member can
read; owner/editor can mutate.

**Tier-unified (free/paid bridge).** Every handler depends on
``get_scoped_session`` + ``get_scope_context`` and branches ONCE on
``scope.is_free``: an org JWT runs the schema-per-tenant ``Level`` path (with the
project-membership permission matrix + audit); an org-less (free) JWT runs the
pooled ``PooledLevel`` path (owner-OR-member RLS, owner-only writes, no audit).
Both return the identical ``LevelRead`` shape. The same router is mounted at
``/projects/{id}/levels`` AND aliased at ``/free/projects/{id}/levels`` in
``main.py`` so the client never picks the isolation surface (the tier comes from
the verified JWT, never the URL prefix).
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
from bimdossier_api.auth.permissions import Action, Resource, require_permission
from bimdossier_api.models.pooled_level import PooledLevel
from bimdossier_api.models.levels import Level, LevelSource
from bimdossier_api.pagination import set_total_count
from bimdossier_api.routers.free_access import (
    assert_free_account_not_expired,
    require_free_tier_enabled,
)
from bimdossier_api.routers.pooled_projects import (
    _load_accessible_free_project_or_404,
    _load_free_project_or_404,
)
from bimdossier_api.schemas.level import LevelCreate, LevelRead, LevelUpdate
from bimdossier_api.tenancy import ScopeContext, get_scope_context, get_scoped_session

router = APIRouter(prefix="/projects/{project_id}/levels", tags=["levels"])


# ---------------------------------------------------------------------------
# Paid (tenant) helpers
# ---------------------------------------------------------------------------


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


# ---------------------------------------------------------------------------
# Free (pooled) helpers — mirror of the former routers/pooled_levels.py
# ---------------------------------------------------------------------------


def _free_to_read(level: PooledLevel) -> LevelRead:
    """Adapt a pooled PooledLevel to the paid LevelRead shape (rename
    ``pooled_project_id`` → ``project_id``)."""
    return LevelRead(
        id=level.id,
        project_id=level.pooled_project_id,
        name=level.name,
        elevation_m=level.elevation_m,
        ordering=level.ordering,
        source=level.source,
        created_at=level.created_at,
        updated_at=level.updated_at,
    )


async def _load_free_level_or_404(
    session: AsyncSession, project_id: UUID, level_id: UUID
) -> PooledLevel:
    level = (
        await session.execute(
            select(PooledLevel).where(
                PooledLevel.id == level_id,
                PooledLevel.pooled_project_id == project_id,
                PooledLevel.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if level is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="LEVEL_NOT_FOUND")
    return level


# ---------------------------------------------------------------------------
# Routes (tier-blind URL; tier resolved server-side from the JWT)
# ---------------------------------------------------------------------------


@router.post("", response_model=LevelRead, status_code=status.HTTP_201_CREATED)
async def create_level(
    project_id: UUID,
    payload: LevelCreate,
    request: Request,
    session: AsyncSession = Depends(get_scoped_session),
    scope: ScopeContext = Depends(get_scope_context),
) -> LevelRead | Level:
    if scope.is_free:
        require_free_tier_enabled()
        free_project = await _load_free_project_or_404(
            session, project_id, scope.user.id
        )  # owner-only
        await assert_free_account_not_expired(scope.user)
        free_level = PooledLevel(
            owner_user_id=free_project.owner_user_id,
            pooled_project_id=free_project.id,
            name=payload.name,
            elevation_m=payload.elevation_m,
            ordering=payload.ordering,
            source="manual",
        )
        session.add(free_level)
        try:
            await session.flush()
        except IntegrityError as exc:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail="LEVEL_NAME_CONFLICT"
            ) from exc
        return _free_to_read(free_level)

    user = scope.user
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
    session: AsyncSession = Depends(get_scoped_session),
    scope: ScopeContext = Depends(get_scope_context),
) -> list[LevelRead] | list[Level]:
    # Ascending by floor: ordering then elevation (ASC sorts NULLs last), name
    # as the stable tiebreaker — same ordering for both tiers.
    if scope.is_free:
        require_free_tier_enabled()
        await _load_accessible_free_project_or_404(session, project_id)  # owner-or-member
        rows = list(
            (
                await session.execute(
                    select(PooledLevel)
                    .where(
                        PooledLevel.pooled_project_id == project_id,
                        PooledLevel.deleted_at.is_(None),
                    )
                    .order_by(
                        PooledLevel.ordering.asc(),
                        PooledLevel.elevation_m.asc(),
                        PooledLevel.name.asc(),
                    )
                )
            )
            .scalars()
            .all()
        )
        set_total_count(response, len(rows))
        return [_free_to_read(r) for r in rows]

    user = scope.user
    # Non-free ⇒ get_scoped_session already verified the org membership, so org_id
    # is guaranteed present (narrow it for the type checker).
    assert scope.org_id is not None
    project = await load_project_or_404(session, project_id)
    await require_project_read_access(session, project.id, user, scope.org_id)

    stmt = select(Level).where(Level.project_id == project.id, Level.deleted_at.is_(None))
    total = (await session.scalar(select(func.count()).select_from(stmt.subquery()))) or 0
    set_total_count(response, total)

    stmt = stmt.order_by(Level.ordering.asc(), Level.elevation_m.asc(), Level.name.asc())
    return list((await session.execute(stmt)).scalars().all())


@router.patch("/{level_id}", response_model=LevelRead)
async def update_level(
    project_id: UUID,
    level_id: UUID,
    payload: LevelUpdate,
    request: Request,
    session: AsyncSession = Depends(get_scoped_session),
    scope: ScopeContext = Depends(get_scope_context),
) -> LevelRead | Level:
    if scope.is_free:
        require_free_tier_enabled()
        await _load_free_project_or_404(session, project_id, scope.user.id)  # owner-only
        await assert_free_account_not_expired(scope.user)
        free_level = await _load_free_level_or_404(session, project_id, level_id)
        for field, value in payload.model_dump(exclude_unset=True).items():
            setattr(free_level, field, value)
        try:
            await session.flush()
        except IntegrityError as exc:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail="LEVEL_NAME_CONFLICT"
            ) from exc
        # Refresh so the onupdate-expired updated_at is re-fetched (avoids a
        # MissingGreenlet lazy-load in _free_to_read).
        await session.refresh(free_level)
        return _free_to_read(free_level)

    user = scope.user
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
    session: AsyncSession = Depends(get_scoped_session),
    scope: ScopeContext = Depends(get_scope_context),
) -> Response:
    if scope.is_free:
        require_free_tier_enabled()
        await _load_free_project_or_404(session, project_id, scope.user.id)  # owner-only
        free_level = await _load_free_level_or_404(session, project_id, level_id)
        # Hard delete (mirrors paid): pooled_documents.level_id is SET NULL, so
        # assigned drawings revert to Unassigned.
        await session.delete(free_level)
        await session.flush()
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    user = scope.user
    project = await load_project_or_404(session, project_id)
    membership = await require_membership(session, project.id, user.id)
    require_permission(membership.role, Resource.document, Action.delete)
    require_project_writable(project)

    level = await _load_level_or_404(session, project.id, level_id)
    # Hard delete (mirrors delete_model): the FKs do the cleanup — documents.level_id
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
