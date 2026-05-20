"""Centralized FastAPI dependencies for auth/role checks.

This module is the single place that:
- pulls the `active_organization_id` claim out of the JWT
- gates super-admin endpoints (`require_superuser`)
- gates org-admin endpoints (`require_org_admin(org_id)`)

Rule of thumb: tenant-scoped endpoints use `get_tenant_session` from
`tenancy.py` (which depends on `get_active_organization_id`); admin
endpoints use these dependencies directly + the master session
(`get_async_session`).
"""

from __future__ import annotations

from uuid import UUID

from fastapi import Depends, Header, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from bimstitch_api.auth.fastapi_users import current_active_user
from bimstitch_api.auth.tokens import TokenError, decode_token_full
from bimstitch_api.db import get_async_session
from bimstitch_api.models.organization_member import (
    OrganizationMember,
    OrganizationMemberStatus,
)
from bimstitch_api.models.user import User

# Same tokenUrl as in auth/backend.py — keeps OpenAPI consistent so the
# "Authorize" button in /docs continues to work.
_oauth2_scheme = OAuth2PasswordBearer(tokenUrl="auth/jwt/login", auto_error=False)


async def get_active_organization_id(
    token: str | None = Depends(_oauth2_scheme),
    x_active_organization_override: str | None = Header(default=None),
) -> UUID | None:
    """Resolve the org the current request acts within.

    Source of truth is the JWT `org` claim — never request body or path.
    Returns None if the token has no org claim (which is valid for
    super-admin endpoints and for a newly invited user before they accept
    any invite).

    The `X-Active-Organization-Override` header is honoured ONLY when the
    decoded user is a superuser. It exists so a super admin can act on
    behalf of an org without re-minting their token via
    `/auth/switch-organization`. The check is enforced inside
    `get_tenant_session`, not here, so admin endpoints that don't need a
    tenant session never read it.
    """
    if token is None:
        return None
    try:
        decoded = decode_token_full(token, "access")
    except TokenError:
        return None
    return decoded.active_organization_id


async def get_impersonator_user_id(
    request: Request,
    token: str | None = Depends(_oauth2_scheme),
) -> UUID | None:
    """Extract the `imp` claim from the current access token, if present.

    Mounted as a router-level dependency on every authenticated router so
    `request.state.impersonator_user_id` is reliably set before any handler
    body runs. `audit.record(...)` reads from request.state to attribute
    every mutation written during an impersonation session to the real
    super admin while preserving the impersonated user as the on-paper
    actor.

    Returns None for normal (non-impersonated) traffic and for unauth
    requests. Never raises — the dep is purely informational.
    """
    if token is None:
        return None
    try:
        decoded = decode_token_full(token, "access")
    except TokenError:
        return None
    if decoded.impersonator_user_id is not None:
        request.state.impersonator_user_id = decoded.impersonator_user_id
    return decoded.impersonator_user_id


async def require_superuser(user: User = Depends(current_active_user)) -> User:
    """Gate for `/admin/*` endpoints. The dependency on `current_active_user`
    (not `current_verified_user`) is intentional — super-admins seeded via
    the bootstrap saga should always be created with is_verified=true, but
    the strictly-stronger check would block fresh seeds before email
    verification.
    """
    if not user.is_superuser:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="SUPERUSER_REQUIRED",
        )
    return user


async def require_org_admin(
    organization_id: UUID,
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_async_session),
) -> User:
    """Gate org-admin endpoints. Routes using this dependency must include
    `{organization_id}` in their path so FastAPI binds the value by name.

    Passes when the requester:
    - is a super-admin, OR
    - has an `organization_members` row for the path-bound org with
      `is_org_admin=true` and `status='active'`.
    """
    if user.is_superuser:
        return user

    stmt = select(OrganizationMember).where(
        OrganizationMember.user_id == user.id,
        OrganizationMember.organization_id == organization_id,
        OrganizationMember.is_org_admin.is_(True),
        OrganizationMember.status == OrganizationMemberStatus.active,
    )
    result = await session.execute(stmt)
    if result.scalar_one_or_none() is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="ORG_ADMIN_REQUIRED",
        )
    return user


async def require_active_org_membership(
    org_id: UUID,
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_async_session),
) -> OrganizationMember:
    """Resolve and return the requester's active membership in `org_id`.

    Used by `/auth/switch-organization` and any endpoint that needs to
    verify a member relationship without requiring admin rights. Raises
    403 if the membership is missing, pending, suspended, or removed.

    Super admins do NOT bypass — they have to have an actual
    `organization_members` row to switch into an org, mirroring the spec's
    "platform org" convention.
    """
    stmt = select(OrganizationMember).where(
        OrganizationMember.user_id == user.id,
        OrganizationMember.organization_id == org_id,
        OrganizationMember.status == OrganizationMemberStatus.active,
    )
    result = await session.execute(stmt)
    membership = result.scalar_one_or_none()
    if membership is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="ORG_MEMBERSHIP_REQUIRED",
        )
    return membership
