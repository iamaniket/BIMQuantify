"""Tenant project authorization primitives + FastAPI dependency factories.

Single home for the project-scoped access checks that used to live as private
(`_`-prefixed) functions inside the `projects` router and were imported by ~19
sibling routers. Centralising them here:

* gives the access matrix one owning, unit-testable module instead of a leaf
  route file acting as the de-facto security library;
* removes the import-cycle risk of routers depending on the projects router;
* exposes `require_resource(...)` / `require_resource_read(...)` FastAPI
  dependency factories so handlers stop hand-copying the
  load-project -> require-membership -> require_permission -> audit-denial block.

Imports only models + auth.permissions + audit + the session/tenant deps — never
a router — so it sits safely below the router layer.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from uuid import UUID

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from bimstitch_api import audit
from bimstitch_api.auth.fastapi_users import current_verified_user
from bimstitch_api.auth.permissions import Action, Resource, require_permission
from bimstitch_api.models.organization_member import (
    OrganizationMember,
    OrganizationMemberStatus,
)
from bimstitch_api.models.project import Project, ProjectLifecycleState
from bimstitch_api.models.project_member import ProjectMember, ProjectRole
from bimstitch_api.models.user import User
from bimstitch_api.tenancy import get_tenant_session, require_active_organization

# ---------------------------------------------------------------------------
# Low-level access checks (moved from routers/projects.py)
# ---------------------------------------------------------------------------


async def load_project_or_404(session: AsyncSession, project_id: UUID) -> Project:
    """Loads a project the current tenant can see (RLS-filtered). 404 if not."""
    project = (
        await session.execute(select(Project).where(Project.id == project_id))
    ).scalar_one_or_none()
    if project is None or project.lifecycle_state is ProjectLifecycleState.removed:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="PROJECT_NOT_FOUND")
    return project


async def get_membership(
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


async def require_membership(
    session: AsyncSession, project_id: UUID, user_id: UUID
) -> ProjectMember:
    """Returns the caller's membership; raises 404 if not a member. The 404
    keeps existence-leakage closed for same-org-non-member."""
    membership = await get_membership(session, project_id, user_id)
    if membership is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="PROJECT_NOT_FOUND")
    return membership


async def is_org_admin(session: AsyncSession, user_id: UUID, organization_id: UUID) -> bool:
    """True if the user has an active org-admin membership in the active org.

    Safe inside a tenant session: `organization_members` lives in `public` and
    falls through `search_path`; RLS is keyed off `app.current_org_id` which
    `get_tenant_session` already set.
    """
    row = (
        await session.execute(
            select(OrganizationMember.id).where(
                OrganizationMember.user_id == user_id,
                OrganizationMember.organization_id == organization_id,
                OrganizationMember.is_org_admin.is_(True),
                OrganizationMember.status == OrganizationMemberStatus.active,
            )
        )
    ).scalar_one_or_none()
    return row is not None


async def require_member_manager(
    session: AsyncSession,
    project_id: UUID,
    user: User,
    organization_id: UUID,
) -> None:
    """Gate for project-member mutations (add/remove/update role).

    Allowed: platform super-admin, org admin in the active org, or the
    project owner. Anyone else -> 403. Org admins get this power so a
    departing project owner doesn't leave a project stranded, and so
    onboarding/offboarding can be driven centrally.
    """
    if user.is_superuser:
        return
    if await is_org_admin(session, user.id, organization_id):
        return
    membership = await get_membership(session, project_id, user.id)
    if membership is not None and membership.role is ProjectRole.owner:
        return
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="INSUFFICIENT_PROJECT_ROLE")


async def require_project_read_access(
    session: AsyncSession,
    project_id: UUID,
    user: User,
    organization_id: UUID,
) -> ProjectMember | None:
    """Gate for reading project data (detail view, sub-resources).

    Returns the ProjectMember row when the caller is a member, or None
    when access is granted via an admin bypass (superuser or org admin).
    Non-member non-admins get 404 to keep existence-leakage closed.
    """
    if user.is_superuser:
        return None
    if await is_org_admin(session, user.id, organization_id):
        return None
    return await require_membership(session, project_id, user.id)


async def require_project_write_access(
    session: AsyncSession,
    project_id: UUID,
    user: User,
    organization_id: UUID,
) -> None:
    """Gate for updating project data (PATCH).

    Allowed: platform super-admin, org admin in the active org, or a
    project member with owner/editor role.  Non-member non-admins get 404
    to keep existence-leakage closed.
    """
    if user.is_superuser:
        return
    if await is_org_admin(session, user.id, organization_id):
        return
    membership = await require_membership(session, project_id, user.id)
    require_permission(membership.role, Resource.project, Action.update)


async def require_project_owner_or_admin(
    session: AsyncSession,
    project_id: UUID,
    user: User,
    organization_id: UUID,
    *,
    action: Action = Action.delete,
) -> None:
    """Gate for destructive / lifecycle project mutations (delete, archive,
    reactivate).

    Allowed: platform super-admin, org admin in the active org, or the
    project owner.  Editors are excluded — these are heavyweight actions.
    Non-member non-admins get 404.
    """
    if user.is_superuser:
        return
    if await is_org_admin(session, user.id, organization_id):
        return
    membership = await require_membership(session, project_id, user.id)
    require_permission(membership.role, Resource.project, action)


async def require_member_viewer(
    session: AsyncSession,
    project_id: UUID,
    user: User,
    organization_id: UUID,
) -> None:
    """Gate for reading the project member list.

    Allowed: platform super-admin, org admin in the active org, or any
    project member. Anyone else -> 404 (mirrors `require_membership` to
    keep existence-leakage closed).
    """
    if user.is_superuser:
        return
    if await is_org_admin(session, user.id, organization_id):
        return
    await require_membership(session, project_id, user.id)


def require_project_writable(project: Project) -> None:
    if project.lifecycle_state is ProjectLifecycleState.archived:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="PROJECT_ARCHIVED",
        )


# ---------------------------------------------------------------------------
# FastAPI dependency factories
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ResourceAccess:
    """Outcome of a project-scoped access check: the loaded project and the
    caller's membership. `membership` is None only on a read bypass (org-admin
    or superuser reaching the project without a membership row)."""

    project: Project
    membership: ProjectMember | None


def require_resource(
    resource: Resource,
    action: Action,
    *,
    writable: bool = True,
) -> Callable[..., Awaitable[ResourceAccess]]:
    """FastAPI dependency factory for project-scoped MUTATIONS.

    Collapses the hand-copied load -> require-membership -> require_permission
    -> (on denial) audit.log_permission_denied -> raise block. EVERY denial is
    audited — including the routers that previously raised a bare 403 without
    logging. For write actions (`writable=True`, the default) it also enforces
    the archived-project 409 guard.

    Usage:
        access: ResourceAccess = Depends(require_resource(Resource.finding, Action.create))
        ...
        project, membership = access.project, access.membership
    """

    async def dependency(
        project_id: UUID,
        request: Request,
        session: AsyncSession = Depends(get_tenant_session),
        user: User = Depends(current_verified_user),
    ) -> ResourceAccess:
        project = await load_project_or_404(session, project_id)
        membership = await require_membership(session, project.id, user.id)
        try:
            require_permission(membership.role, resource, action)
        except HTTPException:
            await audit.log_permission_denied(
                role=membership.role.value,
                resource=resource.value,
                action=action.value,
                actor_user_id=user.id,
                request=request,
            )
            raise
        if writable:
            require_project_writable(project)
        return ResourceAccess(project=project, membership=membership)

    return dependency


def require_project_view() -> Callable[..., Awaitable[ResourceAccess]]:
    """FastAPI dependency factory for project-scoped READS.

    Matches the existing read endpoints exactly: it gates on project-level read
    access (membership, or an org-admin/superuser bypass) and does NOT impose a
    resource-level `read` permission — reads have never been role-gated per
    resource, only per project. `membership` is None on an admin/superuser
    bypass.
    """

    async def dependency(
        project_id: UUID,
        session: AsyncSession = Depends(get_tenant_session),
        user: User = Depends(current_verified_user),
        organization_id: UUID = Depends(require_active_organization),
    ) -> ResourceAccess:
        project = await load_project_or_404(session, project_id)
        membership = await require_project_read_access(session, project.id, user, organization_id)
        return ResourceAccess(project=project, membership=membership)

    return dependency
