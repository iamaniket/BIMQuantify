from fastapi import APIRouter, Depends, HTTPException, status
from fastapi_limiter.depends import RateLimiter
from pydantic import BaseModel
from redis.asyncio import Redis
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from bimstitch_api.auth.tokens import TokenError, create_token, decode_token_full
from bimstitch_api.cache import get_redis_dep
from bimstitch_api.cache.blocklist import is_revoked
from bimstitch_api.config import get_settings
from bimstitch_api.db import get_async_session
from bimstitch_api.models.organization_member import (
    OrganizationMember,
    OrganizationMemberStatus,
)
from bimstitch_api.models.user import User

router = APIRouter(prefix="/auth/jwt", tags=["auth"])

REFRESH_RATE_LIMITER = RateLimiter(times=get_settings().rate_limit_refresh_per_min, seconds=60)


class RefreshRequest(BaseModel):
    refresh_token: str


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class AccessToken(BaseModel):
    access_token: str
    token_type: str = "bearer"


@router.post(
    "/refresh",
    response_model=AccessToken,
    dependencies=[Depends(REFRESH_RATE_LIMITER)],
)
async def refresh_access_token(
    payload: RefreshRequest,
    session: AsyncSession = Depends(get_async_session),
    redis: Redis = Depends(get_redis_dep),
) -> AccessToken:
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

    if await is_revoked(redis, decoded.jti):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="REFRESH_TOKEN_REVOKED"
        )

    user = await session.get(User, decoded.user_id)
    if user is None or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="USER_NO_LONGER_ACTIVE"
        )

    # Propagate active_organization_id from the refresh token but verify the
    # membership is still active. If the user's membership was suspended or
    # removed since the refresh was issued, drop the claim — the portal will
    # surface the missing org via /auth/me and prompt for a switch.
    active_org_id = decoded.active_organization_id
    if active_org_id is not None:
        stmt = select(OrganizationMember).where(
            OrganizationMember.user_id == user.id,
            OrganizationMember.organization_id == active_org_id,
            OrganizationMember.status == OrganizationMemberStatus.active,
        )
        result = await session.execute(stmt)
        if result.scalar_one_or_none() is None:
            active_org_id = None

    return AccessToken(
        access_token=create_token(user.id, "access", active_organization_id=active_org_id),
    )
