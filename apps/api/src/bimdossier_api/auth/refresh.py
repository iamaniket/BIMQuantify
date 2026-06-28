from datetime import UTC, datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from redis.asyncio import Redis
from redis.exceptions import RedisError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from bimdossier_api import audit
from bimdossier_api.auth.ratelimit import ResilientRateLimiter
from bimdossier_api.auth.tokens import (
    TokenError,
    create_token,
    create_token_with_jti,
    decode_token_full,
    token_predates_epoch,
)
from bimdossier_api.cache import get_redis_dep
from bimdossier_api.cache.blocklist import (
    get_refresh_rotation,
    is_revoked,
    mark_refresh_rotated,
)
from bimdossier_api.config import get_settings
from bimdossier_api.db import get_async_session
from bimdossier_api.models.organization_member import (
    OrganizationMember,
    OrganizationMemberStatus,
)
from bimdossier_api.models.user import User

router = APIRouter(prefix="/auth/jwt", tags=["auth"])

REFRESH_RATE_LIMITER = ResilientRateLimiter(
    times=get_settings().rate_limit_refresh_per_min, seconds=60
)


class RefreshRequest(BaseModel):
    refresh_token: str


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


async def _resolve_active_org(
    session: AsyncSession, user: User, claimed_org_id: UUID | None
) -> UUID | None:
    """Carry the refresh token's `org` claim forward, but only while the
    membership is still active. If the user's membership was suspended or
    removed since the refresh was issued, drop the claim — the portal surfaces
    the missing org via /auth/me and prompts for a switch.
    """
    if claimed_org_id is None:
        return None
    stmt = select(OrganizationMember).where(
        OrganizationMember.user_id == user.id,
        OrganizationMember.organization_id == claimed_org_id,
        OrganizationMember.status == OrganizationMemberStatus.active,
    )
    result = await session.execute(stmt)
    if result.scalar_one_or_none() is None:
        return None
    return claimed_org_id


@router.post(
    "/refresh",
    response_model=TokenPair,
    dependencies=[Depends(REFRESH_RATE_LIMITER)],
)
async def refresh_access_token(
    payload: RefreshRequest,
    request: Request,
    session: AsyncSession = Depends(get_async_session),
    redis: Redis = Depends(get_redis_dep),
) -> TokenPair:
    """Rotate the refresh token and mint a fresh access token.

    Each call retires the presented refresh token and returns a NEW refresh
    token alongside the access token (rotation). A retired token replayed
    outside the short grace window is treated as theft: the user's token epoch
    is bumped, signing out every session (reuse detection, per the OAuth 2.0
    Security BCP). The rotated refresh inherits the ORIGINAL token's expiry, so
    rotation never extends the absolute session lifetime.
    """
    try:
        decoded = decode_token_full(payload.refresh_token, expected_type="refresh")
    except TokenError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc

    # Impersonation sessions are access-only by design. `create_token` rejects
    # `imp` on refresh tokens, so this only triggers if a token was hand-crafted
    # — refuse to mint a new access from it.
    if decoded.impersonator_user_id is not None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="IMPERSONATION_REFRESH_FORBIDDEN",
        )

    # Every refresh token we mint carries a JTI; one without can't be tracked for
    # rotation/reuse, so it is malformed — reject rather than rotate blindly.
    jti = decoded.jti
    if jti is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="REFRESH_TOKEN_REVOKED"
        )

    # Hard revocation (logout / switch-organization / forced). Kept distinct from
    # rotation so a deliberately logged-out token's replay stays a plain
    # REFRESH_TOKEN_REVOKED rather than a sign-out-everywhere reuse event. Checked
    # first so a Redis outage (is_revoked fails CLOSED) rejects here.
    if await is_revoked(redis, jti):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="REFRESH_TOKEN_REVOKED"
        )

    user = await session.get(User, decoded.user_id)
    if user is None or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="USER_NO_LONGER_ACTIVE"
        )

    # Reject refresh tokens minted before a global sign-out / password change.
    if token_predates_epoch(decoded, user.tokens_valid_after):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="REFRESH_TOKEN_REVOKED"
        )

    # --- Rotation + reuse detection -------------------------------------------
    rotated, successor = await get_refresh_rotation(redis, jti)
    if rotated:
        if successor is not None:
            # Grace window: a benign concurrent refresh (e.g. two browser tabs)
            # or a network retry replayed the just-rotated token. Re-issue the
            # SAME successor idempotently plus a fresh access token, so neither
            # client is logged out and only one live refresh token survives.
            active_org_id = await _resolve_active_org(session, user, decoded.active_organization_id)
            return TokenPair(
                access_token=create_token(user.id, "access", active_organization_id=active_org_id),
                refresh_token=successor,
            )
        # Retired token replayed AFTER the grace window → the legitimate client
        # has long since moved to its successor, so this is reuse (likely theft).
        # Revoke the whole family by bumping the token epoch — every access and
        # refresh token for this user, on every device, dies on next use.
        user.tokens_valid_after = datetime.now(tz=UTC)
        await session.commit()
        await audit.record_event_independent(
            None,
            action="auth.refresh.reuse_detected",
            resource_type="user",
            resource_id=user.id,
            actor_user_id=user.id,
            request=request,
        )
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="REFRESH_TOKEN_REUSED")

    # Normal path: rotate. Propagate active_organization_id (membership-checked).
    active_org_id = await _resolve_active_org(session, user, decoded.active_organization_id)

    # Absolute-lifetime cap: the successor inherits the presented token's
    # remaining life, so a chain of refreshes can never outlive the original
    # 7-day session — a continuously-active user still re-authenticates at the
    # original expiry (matching pre-rotation behaviour).
    now = int(datetime.now(tz=UTC).timestamp())
    remaining = max(decoded.exp - now, 1)
    new_refresh = create_token_with_jti(
        user.id,
        "refresh",
        active_organization_id=active_org_id,
        ttl_override_seconds=remaining,
    )

    settings = get_settings()
    try:
        await mark_refresh_rotated(
            redis,
            jti,
            new_refresh.token,
            remaining_seconds=remaining,
            grace_seconds=settings.refresh_rotation_grace_seconds,
        )
    except RedisError as exc:
        # The presented token couldn't be durably retired. Refuse to hand out a
        # rotated pair that would leave the old token silently usable — the
        # client treats a 401 here like an expired session and re-authenticates.
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="REFRESH_TOKEN_REVOKED"
        ) from exc

    return TokenPair(
        access_token=create_token(user.id, "access", active_organization_id=active_org_id),
        refresh_token=new_refresh.token,
    )
