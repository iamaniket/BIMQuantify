"""Self-serve account surface for the pooled FREE tier.

A free user (org-less account) has no organization to derive seats/storage from,
so the portal account page can't reuse the paid `OrganizationMemberBrief`
quotas. This endpoint exposes the caller's OWN free-tier footprint vs. the
configured caps so the account page can render a usage card.

It reuses `free_usage.compute_free_usage` — the exact computation behind the
super-admin `/admin/users/free` listing — but scoped to the single calling user
via the pooled free session (RLS keys on `app.current_user_id`). Flag-gated like
the rest of `/free/*` (FREE_TIER_DISABLED when off).
"""

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from bimdossier_api.auth.fastapi_users import current_verified_user
from bimdossier_api.config import get_settings
from bimdossier_api.free_limits import resolve_free_limits
from bimdossier_api.free_usage import compute_free_usage
from bimdossier_api.models.user import User
from bimdossier_api.routers.free_access import require_free_tier_enabled
from bimdossier_api.schemas.admin import FreeAccountLimits, FreeUserUsage
from bimdossier_api.tenancy import get_pooled_session

router = APIRouter(
    prefix="/pooled",
    tags=["free"],
    dependencies=[Depends(require_free_tier_enabled)],
)


@router.get("/account/usage", response_model=FreeUserUsage)
async def get_pooled_account_usage(
    user: User = Depends(current_verified_user),
    session: AsyncSession = Depends(get_pooled_session),
) -> FreeUserUsage:
    """The caller's own free-tier usage vs. their EFFECTIVE caps (per-user
    override ?? env default). Zeros for an account that has created nothing yet —
    the caps are always populated so the UI never hardcodes thresholds."""
    limits = await resolve_free_limits(user)
    usage = await compute_free_usage(
        session, [user.id], get_settings(), {user.id: limits}
    )
    return usage[user.id]


@router.get("/account/limits", response_model=FreeAccountLimits)
async def get_pooled_account_limits(
    user: User = Depends(current_verified_user),
) -> FreeAccountLimits:
    """The caller's own effective free caps + trial countdown — drives the portal
    trial banner ("X days left", or "trial ended"). Resolves via a superuser probe
    (the override table has no bim_app grant), so no request DB session is held."""
    limits = await resolve_free_limits(user)
    return FreeAccountLimits(
        max_projects=limits.max_projects,
        max_members_per_project=limits.max_members_per_project,
        max_documents=limits.max_documents,
        storage_max_bytes=limits.storage_max_bytes,
        account_max_age_days=limits.account_max_age_days,
        account_expires_at=limits.account_expires_at,
        days_remaining=limits.days_remaining,
        expired=limits.is_expired,
        expiry_exempt=limits.expiry_exempt,
    )
