from fastapi import APIRouter, Depends, HTTPException, status
from fastapi_limiter.depends import RateLimiter
from pydantic import BaseModel
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession

from bimstitch_api.auth.tokens import TokenError, create_token, decode_token_full
from bimstitch_api.cache import get_redis_dep
from bimstitch_api.cache.blocklist import is_revoked
from bimstitch_api.config import get_settings
from bimstitch_api.db import get_async_session
from bimstitch_api.models.user import User

router = APIRouter(prefix="/auth/jwt", tags=["auth"])

REFRESH_RATE_LIMITER = RateLimiter(
    times=get_settings().rate_limit_refresh_per_min, seconds=60
)


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

    if await is_revoked(redis, decoded.jti):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="refresh token revoked"
        )

    user = await session.get(User, decoded.user_id)
    if user is None or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="user no longer active"
        )

    return AccessToken(access_token=create_token(user.id, "access"))
