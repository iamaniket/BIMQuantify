from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Response, status
from fastapi.security import OAuth2PasswordBearer
from pydantic import BaseModel
from redis.asyncio import Redis
from redis.exceptions import RedisError
from sqlalchemy.ext.asyncio import AsyncSession

from bimdossier_api.auth.fastapi_users import current_active_user
from bimdossier_api.auth.tokens import DecodedToken, TokenError, decode_token_full
from bimdossier_api.cache import get_redis_dep
from bimdossier_api.cache.blocklist import revoke_jti
from bimdossier_api.db import get_async_session
from bimdossier_api.models.user import User

router = APIRouter(prefix="/auth", tags=["auth"])

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="auth/jwt/login", auto_error=True)


class LogoutRequest(BaseModel):
    refresh_token: str | None = None


def _ttl_seconds(decoded: DecodedToken) -> int:
    return max(decoded.exp - int(datetime.now(tz=UTC).timestamp()), 0)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    payload: LogoutRequest,
    access_token: str = Depends(oauth2_scheme),
    redis: Redis = Depends(get_redis_dep),
) -> Response:
    try:
        access = decode_token_full(access_token, expected_type="access")
    except TokenError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc

    # Decode the refresh token (if any) before touching Redis so a malformed
    # token still yields a 400 rather than masking it behind a Redis outage.
    refresh: DecodedToken | None = None
    if payload.refresh_token:
        try:
            refresh = decode_token_full(payload.refresh_token, expected_type="refresh")
        except TokenError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    # Fail closed: if the blocklist write can't be persisted, report the
    # logout as not-yet-effective (503) instead of returning 204 for a token
    # that would still work once Redis recovers.
    try:
        if access.jti:
            await revoke_jti(redis, access.jti, _ttl_seconds(access))
        if refresh is not None and refresh.jti:
            await revoke_jti(redis, refresh.jti, _ttl_seconds(refresh))
    except RedisError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="LOGOUT_REVOCATION_UNAVAILABLE",
        ) from exc

    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/logout-all", status_code=status.HTTP_204_NO_CONTENT)
async def logout_all(
    payload: LogoutRequest,
    user: User = Depends(current_active_user),
    access_token: str = Depends(oauth2_scheme),
    session: AsyncSession = Depends(get_async_session),
    redis: Redis = Depends(get_redis_dep),
) -> Response:
    """Sign out everywhere. Stamps the user's token epoch (`tokens_valid_after`)
    so every previously-issued access/refresh token — this device and all
    others — is rejected on its next use (any token whose `iat` predates the
    stamp fails). A fresh login mints tokens after the epoch and works normally.

    The DB-backed epoch is the durable guarantee; we also best-effort blocklist
    the presented access/refresh pair for immediacy. A bad token or Redis hiccup
    there must not fail the logout — the epoch already covers those tokens.
    """
    # `user` was loaded via the same (cached) master session, so it is attached
    # here — mutate + commit directly.
    user.tokens_valid_after = datetime.now(tz=UTC)
    await session.commit()

    try:
        access = decode_token_full(access_token, expected_type="access")
        if access.jti:
            await revoke_jti(redis, access.jti, _ttl_seconds(access))
        if payload.refresh_token:
            refresh = decode_token_full(payload.refresh_token, expected_type="refresh")
            if refresh.jti:
                await revoke_jti(redis, refresh.jti, _ttl_seconds(refresh))
    except (TokenError, RedisError):
        # The epoch already invalidated every token durably; the blocklist
        # write is only an immediacy optimisation, so swallow its failures.
        pass

    return Response(status_code=status.HTTP_204_NO_CONTENT)
