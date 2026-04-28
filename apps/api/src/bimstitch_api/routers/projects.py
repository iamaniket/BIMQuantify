from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from bimstitch_api.auth.fastapi_users import current_verified_user
from bimstitch_api.models.project import Project
from bimstitch_api.models.project_member import ProjectMember, ProjectRole
from bimstitch_api.models.user import User
from bimstitch_api.schemas.project import (
    ProjectCreate,
    ProjectMemberCreate,
    ProjectMemberRead,
    ProjectMemberUpdate,
    ProjectRead,
    ProjectUpdate,
)
from bimstitch_api.tenancy import get_tenant_session

router = APIRouter(prefix="/projects", tags=["projects"])


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


async def _load_project_or_404(session: AsyncSession, project_id: UUID) -> Project:
    """Loads a project the current tenant can see (RLS-filtered). 404 if not."""
    project = (
        await session.execute(select(Project).where(Project.id == project_id))
    ).scalar_one_or_none()
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="PROJECT_NOT_FOUND")
    return project


async def _get_membership(
    session: AsyncSession, project_id: UUID, user_id: UUID
) -> ProjectMember | None:
    return (
        await session.execute(
            select(ProjectMember).where(
                ProjectMember.project_id == project_id,
                ProjectMember.user_id == user_id,
            )
        )
    ).scalar_one_or_none()


async def _require_membership(
    session: AsyncSession, project_id: UUID, user_id: UUID
) -> ProjectMember:
    """Returns the caller's membership; raises 404 if not a member. The 404
    keeps existence-leakage closed for same-org-non-member."""
    membership = await _get_membership(session, project_id, user_id)
    if membership is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="PROJECT_NOT_FOUND")
    return membership


def _require_role(membership: ProjectMember, *allowed: ProjectRole) -> None:
    if membership.role not in allowed:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="INSUFFICIENT_PROJECT_ROLE"
        )


# ---------------------------------------------------------------------------
# Project CRUD
# ---------------------------------------------------------------------------


@router.post("", response_model=ProjectRead, status_code=status.HTTP_201_CREATED)
async def create_project(
    payload: ProjectCreate,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
) -> Project:
    project = Project(
        organization_id=user.organization_id,
        name=payload.name,
        description=payload.description,
        thumbnail_url=payload.thumbnail_url,
        owner_id=user.id,
    )
    session.add(project)
    try:
        await session.flush()
    except IntegrityError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="PROJECT_NAME_CONFLICT"
        ) from exc

    session.add(ProjectMember(project_id=project.id, user_id=user.id, role=ProjectRole.owner))
    await session.flush()
    await session.refresh(project)
    return project


@router.get("", response_model=list[ProjectRead])
async def list_projects(
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
) -> list[Project]:
    stmt = (
        select(Project)
        .join(ProjectMember, ProjectMember.project_id == Project.id)
        .where(ProjectMember.user_id == user.id)
        .order_by(Project.created_at)
    )
    result = await session.execute(stmt)
    return list(result.scalars().all())


@router.get("/{project_id}", response_model=ProjectRead)
async def get_project(
    project_id: UUID,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
) -> Project:
    project = await _load_project_or_404(session, project_id)
    await _require_membership(session, project.id, user.id)
    return project


@router.patch("/{project_id}", response_model=ProjectRead)
async def update_project(
    project_id: UUID,
    payload: ProjectUpdate,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
) -> Project:
    project = await _load_project_or_404(session, project_id)
    membership = await _require_membership(session, project.id, user.id)
    _require_role(membership, ProjectRole.owner, ProjectRole.editor)

    updates = payload.model_dump(exclude_unset=True)
    for field, value in updates.items():
        setattr(project, field, value)
    try:
        await session.flush()
    except IntegrityError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="PROJECT_NAME_CONFLICT"
        ) from exc
    await session.refresh(project)
    return project


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_project(
    project_id: UUID,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
) -> Response:
    project = await _load_project_or_404(session, project_id)
    membership = await _require_membership(session, project.id, user.id)
    _require_role(membership, ProjectRole.owner)

    await session.delete(project)
    await session.flush()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------------------
# Membership management
# ---------------------------------------------------------------------------


@router.post(
    "/{project_id}/members",
    response_model=ProjectMemberRead,
    status_code=status.HTTP_201_CREATED,
)
async def add_member(
    project_id: UUID,
    payload: ProjectMemberCreate,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
) -> ProjectMember:
    project = await _load_project_or_404(session, project_id)
    caller = await _require_membership(session, project.id, user.id)
    _require_role(caller, ProjectRole.owner)

    if payload.role is ProjectRole.owner:
        # No second-owner. The partial unique index would also catch this, but
        # rejecting up-front gives a clearer error.
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="OWNER_ROLE_NOT_ASSIGNABLE"
        )

    # Same-org invariant. RLS prevents reading users from other orgs, so a
    # cross-org user_id resolves to None here — surface as a 400, not 404, so
    # the caller knows the user exists conceptually but not in their tenant.
    target_org = (
        await session.execute(select(User.organization_id).where(User.id == payload.user_id))
    ).scalar_one_or_none()
    if target_org is None or target_org != project.organization_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="USER_NOT_IN_PROJECT_ORG"
        )

    member = ProjectMember(project_id=project.id, user_id=payload.user_id, role=payload.role)
    session.add(member)
    try:
        await session.flush()
    except IntegrityError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="MEMBER_ALREADY_EXISTS"
        ) from exc
    await session.refresh(member)
    return member


@router.delete("/{project_id}/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_member(
    project_id: UUID,
    user_id: UUID,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
) -> Response:
    project = await _load_project_or_404(session, project_id)
    caller = await _require_membership(session, project.id, user.id)
    _require_role(caller, ProjectRole.owner)

    target = await _get_membership(session, project.id, user_id)
    if target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="MEMBER_NOT_FOUND")
    if target.role is ProjectRole.owner:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="OWNER_NOT_REMOVABLE")

    await session.delete(target)
    await session.flush()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.patch("/{project_id}/members/{user_id}", response_model=ProjectMemberRead)
async def update_member_role(
    project_id: UUID,
    user_id: UUID,
    payload: ProjectMemberUpdate,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
) -> ProjectMember:
    project = await _load_project_or_404(session, project_id)
    caller = await _require_membership(session, project.id, user.id)
    _require_role(caller, ProjectRole.owner)

    target = await _get_membership(session, project.id, user_id)
    if target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="MEMBER_NOT_FOUND")

    # No transferring or demoting the owner this iteration.
    if target.role is ProjectRole.owner:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="OWNER_ROLE_NOT_CHANGEABLE"
        )
    if payload.role is ProjectRole.owner:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="OWNER_ROLE_NOT_ASSIGNABLE"
        )

    target.role = payload.role
    await session.flush()
    await session.refresh(target)
    return target
