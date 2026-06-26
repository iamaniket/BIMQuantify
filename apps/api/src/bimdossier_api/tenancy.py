"""Per-request tenant scoping for schema-per-tenant isolation.

`get_tenant_session` opens a session, begins a transaction, sets:

  1. `SET LOCAL ROLE bim_app`                — drops to the non-bypass role so
                                                master-table RLS actually
                                                enforces.
  2. `SET LOCAL search_path = "<schema>", public`
                                              — tenant tables resolve to the
                                                active org's schema; master
                                                tables fall through to public.
  3. `app.current_org_id`, `app.current_user_id` GUCs
                                              — fed into the surviving RLS
                                                policies on `users` and
                                                `organization_members`.

Endpoint code under this dependency MUST NOT call `session.commit()` itself
— committing closes the txn and drops the GUCs + search_path, breaking
isolation for any subsequent query in the same request. The wrapping
`async with session.begin():` handles commit/rollback automatically.

The active organization id comes from the JWT `org` claim — never from
request path, query string, or body. If a request reaches here with no org
claim (e.g. fresh super-admin token), the dep returns 409
`NO_ACTIVE_ORGANIZATION` so the portal can prompt for tenant selection.
"""

from collections.abc import AsyncGenerator
from uuid import UUID

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from bimdossier_api.auth.dependencies import get_active_organization_id
from bimdossier_api.auth.fastapi_users import current_verified_user
from bimdossier_api.db import get_async_session, get_session_maker
from bimdossier_api.models.organization import Organization, OrganizationStatus
from bimdossier_api.models.organization_member import (
    OrganizationMember,
    OrganizationMemberStatus,
)
from bimdossier_api.models.user import User


def schema_name_for(organization_id: UUID) -> str:
    """Canonical schema name for an org. Postgres identifier (no quoting
    needed) — lowercase, underscore, hex only. Length: 36 chars; well
    inside Postgres' 63-byte identifier limit.
    """
    return f"org_{organization_id.hex}"


# Name of the platform/super-admin org. Its tenant schema holds audit rows for
# events that belong to no single customer org (anonymous auth failures,
# platform-level super-admin actions). Defined here (not in seed.py) so runtime
# code can resolve the platform schema without importing the seed module.
PLATFORM_ORG_NAME = "BimDossier Platform"

_platform_schema: str | None = None


async def resolve_platform_schema(session: AsyncSession) -> str:
    """Return the platform org's tenant schema name, cached after first lookup.

    The platform org is created by the seed and never renamed, so its schema
    name is stable for the process lifetime.
    """
    global _platform_schema
    if _platform_schema is None:
        schema = (
            await session.execute(
                select(Organization.schema_name).where(
                    Organization.name == PLATFORM_ORG_NAME
                )
            )
        ).scalar_one_or_none()
        if schema is None:
            raise RuntimeError(
                f"Platform org {PLATFORM_ORG_NAME!r} not found — run the seed first."
            )
        _platform_schema = schema
    return _platform_schema


async def require_active_organization(
    request: Request,
    user: User = Depends(current_verified_user),
    org_id: UUID | None = Depends(get_active_organization_id),
    master_session: AsyncSession = Depends(get_async_session),
) -> UUID:
    """Resolve the active org from the JWT `org` claim AND verify the caller
    has a usable membership in it before returning.

    409 NO_ACTIVE_ORGANIZATION if the token carries no claim — the portal
    surfaces this as "pick a workspace" and routes to the switcher. 403 / 409
    (from `_verify_membership`) if the claim names an org the user is not an
    active member of, or one that is suspended / soft-deleted.

    Verifying here — not just inside `get_tenant_session` — means the org id
    handed to any endpoint that depends on this is always membership-checked,
    so an endpoint can't accidentally trust a raw claim. The verified
    `Organization.schema_name` is stashed on `request.state.active_schema` so
    `get_tenant_session` can bind the schema without re-running the query
    (FastAPI caches this dependency within a request → verified exactly once).
    """
    if org_id is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="NO_ACTIVE_ORGANIZATION",
        )
    _, org = await _verify_membership(master_session, user.id, org_id)
    request.state.active_schema = org.schema_name
    return org_id


async def _verify_membership(
    session: AsyncSession, user_id: UUID, organization_id: UUID
) -> tuple[OrganizationMember, Organization]:
    """Check the user has an active membership in the org AND the org is
    in a usable state. Returns both rows so callers can read schema_name
    without a second roundtrip.
    """
    stmt = (
        select(OrganizationMember, Organization)
        .join(Organization, Organization.id == OrganizationMember.organization_id)
        .where(
            OrganizationMember.user_id == user_id,
            OrganizationMember.organization_id == organization_id,
            OrganizationMember.status == OrganizationMemberStatus.active,
        )
    )
    result = await session.execute(stmt)
    row = result.first()
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="ORG_MEMBERSHIP_REQUIRED",
        )
    membership, org = row
    if org.status == OrganizationStatus.suspended or org.deleted_at is not None:
        # Suspended (admin-paused) or soft-deleted — block all tenant access.
        # The user can still hit /auth/me and /admin/* (super-admins only),
        # but no tenant-scoped endpoint will resolve. Surfaced to the portal
        # as a 403 with a distinct detail so the UI can render a banner
        # rather than a generic "no membership" error.
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="ORG_SUSPENDED",
        )
    if org.status != OrganizationStatus.active:
        # provisioning, or any future non-usable status
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="ORG_NOT_AVAILABLE",
        )
    return membership, org


async def get_tenant_session(
    request: Request,
    user: User = Depends(current_verified_user),
    organization_id: UUID = Depends(require_active_organization),
) -> AsyncGenerator[AsyncSession, None]:
    """Yield a session scoped to the active org's schema.

    Membership is already verified by `require_active_organization` (which
    this depends on), which also stashed the org's schema name on
    `request.state.active_schema` using a separate master session (public
    schema, no search_path tweaks). We read it here and open a fresh session
    for the tenant work — keeping the verification and the work cleanly
    separated and avoiding any leakage of search_path between them.
    """
    schema: str = request.state.active_schema

    session_maker = get_session_maker()
    async with session_maker() as session, session.begin():
        await session.execute(text("SET LOCAL ROLE bim_app"))
        await session.execute(text(f'SET LOCAL search_path = "{schema}", public'))
        # Combine the two set_config calls into a single round-trip.
        await session.execute(
            text(
                "SELECT set_config('app.current_org_id', :org, true),"
                "       set_config('app.current_user_id', :uid, true)"
            ),
            {"org": str(organization_id), "uid": str(user.id)},
        )
        yield session


# Backwards-compat shim: pre-refactor code imported `require_org_user` which
# returned the `User` after verifying they had an org_id. The semantics now
# live in `require_active_organization` (returns the org id from JWT), but
# leaving this stub here would mask import errors. Removing it intentionally
# — callers should migrate to the new dep family.
