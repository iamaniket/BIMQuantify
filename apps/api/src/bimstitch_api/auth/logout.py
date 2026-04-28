from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Response, status
from fastapi.security import OAuth2PasswordBearer
from pydantic import BaseModel
from redis.asyncio import Redis

from bimstitch_api.auth.tokens import DecodedToken, TokenError, decode_token_full
from bimstitch_api.cache import get_redis_dep
from bimstitch_api.cache.blocklist import revoke_jti

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
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)
        ) from exc

    if access.jti:
        await revoke_jti(redis, access.jti, _ttl_seconds(access))

    if payload.refresh_token:
        try:
            refresh = decode_token_full(payload.refresh_token, expected_type="refresh")
        except TokenError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
            ) from exc
        if refresh.jti:
            await revoke_jti(redis, refresh.jti, _ttl_seconds(refresh))

    return Response(status_code=status.HTTP_204_NO_CONTENT)
