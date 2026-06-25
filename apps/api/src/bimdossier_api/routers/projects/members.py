from uuid import UUID

from fastapi import (
    Depends,
    HTTPException,
    Query,
    Request,
    Response,
    status,
)
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from bimdossier_api import audit
from bimdossier_api.access import (
    get_membership,
    load_project_or_404,
    require_member_manager,
    require_member_viewer,
    require_project_writable,
)
from bimdossier_api.auth.fastapi_users import current_verified_user
from bimdossier_api.models.organization_member import (
    OrganizationMember,
    OrganizationMemberStatus,
)
from bimdossier_api.models.project_member import ProjectMember, ProjectRole
from bimdossier_api.models.user import User
from bimdossier_api.pagination import (
    SortParams,
    apply_sort,
    sort_params,
)
from bimdossier_api.routers.projects._shared import (
    _member_to_read,
    router,
)
from bimdossier_api.schemas.project import (
    ProjectMemberCreate,
    ProjectMemberRead,
    ProjectMemberUpdate,
)
from bimdossier_api.tenancy import get_tenant_session, require_active_organization


# ---------------------------------------------------------------------------
# Membership management
# ---------------------------------------------------------------------------


@router.get("/{project_id}/members", response_model=list[ProjectMemberRead])
async def list_members(
    project_id: UUID,
    response: Response,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    sort: SortParams = Depends(sort_params),
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> list[dict[str, object]]:
    """List members of a project. Visible to project members, org admins, and
    super-admins. Non-member non-admins get a 404 to keep existence-leakage
    closed."""
    project = await load_project_or_404(session, project_id)
    await require_member_viewer(session, project.id, user, active_org_id)

    total = (
        await session.scalar(
            select(func.count())
            .select_from(ProjectMember)
            .where(ProjectMember.project_id == project.id)
        )
    ) or 0
    response.headers["X-Total-Count"] = str(total)

    base = (
        select(ProjectMember, User.email, User.full_name)
        .join(User, User.id == ProjectMember.user_id)
        .where(ProjectMember.project_id == project.id)
    )
    stmt = apply_sort(
        base,
        sort,
        {
            "email": User.email,
            "full_name": User.full_name,
            "role": ProjectMember.role,
            "created_at": ProjectMember.created_at,
        },
        default="created_at",
        default_dir="asc",
        tiebreaker=ProjectMember.user_id,
    ).limit(limit).offset(offset)
    rows = (await session.execute(stmt)).all()
    return [
        {
            "project_id": member.project_id,
            "user_id": member.user_id,
            "role": member.role,
            "created_at": member.created_at,
            "email": email,
            "full_name": full_name,
        }
        for member, email, full_name in rows
    ]


@router.post(
    "/{project_id}/members",
    response_model=ProjectMemberRead,
    status_code=status.HTTP_201_CREATED,
)
async def add_member(
    project_id: UUID,
    payload: ProjectMemberCreate,
    request: Request,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> dict[str, object]:
    project = await load_project_or_404(session, project_id)
    await require_member_manager(session, project.id, user, active_org_id)
    require_project_writable(project)

    if payload.role is ProjectRole.owner:
        # No second-owner. The partial unique index would also catch this, but
        # rejecting up-front gives a clearer error.
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="OWNER_ROLE_NOT_ASSIGNABLE"
        )

    # Same-org invariant: the target user must have an active membership in
    # the current org. We can read `organization_members` even from a tenant
    # session because master tables fall through search_path to `public`,
    # and RLS on `organization_members` is scoped via `app.current_org_id`
    # which `get_tenant_session` already set.
    membership_exists = (
        await session.execute(
            select(OrganizationMember.id).where(
                OrganizationMember.user_id == payload.user_id,
                OrganizationMember.organization_id == active_org_id,
                OrganizationMember.status == OrganizationMemberStatus.active,
            )
        )
    ).scalar_one_or_none()
    if membership_exists is None:
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
    await audit.record(
        session,
        action="project_member.added",
        resource_type="project_member",
        resource_id=project.id,
        after={"user_id": str(payload.user_id), "role": payload.role.value},
        actor_user_id=user.id,
        project_id=project.id,
        request=request,
    )
    return await _member_to_read(session, member)


@router.delete("/{project_id}/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_member(
    project_id: UUID,
    user_id: UUID,
    request: Request,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> Response:
    project = await load_project_or_404(session, project_id)
    await require_member_manager(session, project.id, user, active_org_id)
    require_project_writable(project)

    target = await get_membership(session, project.id, user_id)
    if target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="MEMBER_NOT_FOUND")
    if target.role is ProjectRole.owner:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="OWNER_NOT_REMOVABLE")

    before = {"user_id": str(user_id), "role": target.role.value}
    await session.delete(target)
    await session.flush()
    await audit.record(
        session,
        action="project_member.removed",
        resource_type="project_member",
        resource_id=project.id,
        before=before,
        actor_user_id=user.id,
        project_id=project.id,
        request=request,
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.patch("/{project_id}/members/{user_id}", response_model=ProjectMemberRead)
async def update_member_role(
    project_id: UUID,
    user_id: UUID,
    payload: ProjectMemberUpdate,
    request: Request,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> dict[str, object]:
    project = await load_project_or_404(session, project_id)
    await require_member_manager(session, project.id, user, active_org_id)
    require_project_writable(project)

    target = await get_membership(session, project.id, user_id)
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

    old_role = target.role
    target.role = payload.role
    await session.flush()
    await session.refresh(target)
    await audit.record(
        session,
        action="project_member.role_changed",
        resource_type="project_member",
        resource_id=project.id,
        before={"user_id": str(user_id), "role": old_role.value},
        after={"user_id": str(user_id), "role": payload.role.value},
        actor_user_id=user.id,
        project_id=project.id,
        request=request,
    )
    return await _member_to_read(session, target)
