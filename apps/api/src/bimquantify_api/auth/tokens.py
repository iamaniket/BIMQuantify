from datetime import UTC, datetime, timedelta
from typing import Any, Literal
from uuid import UUID

from jose import JWTError, jwt

from bimquantify_api.config import get_settings

TokenType = Literal["access", "refresh"]

ALGORITHM = "HS256"
ACCESS_AUDIENCE = "fastapi-users:auth"
REFRESH_AUDIENCE = "bimquantify:refresh"


class TokenError(Exception):
    pass


def _audience(token_type: TokenType) -> str:
    return ACCESS_AUDIENCE if token_type == "access" else REFRESH_AUDIENCE


def create_token(user_id: UUID, token_type: TokenType) -> str:
    settings = get_settings()
    ttl = (
        settings.jwt_access_ttl_seconds
        if token_type == "access"
        else settings.jwt_refresh_ttl_seconds
    )
    now = datetime.now(tz=UTC)
    payload: dict[str, Any] = {
        "sub": str(user_id),
        "aud": _audience(token_type),
        "typ": token_type,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(seconds=ttl)).timestamp()),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=ALGORITHM)


def decode_token(token: str, expected_type: TokenType) -> UUID:
    settings = get_settings()
    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret,
            algorithms=[ALGORITHM],
            audience=_audience(expected_type),
        )
    except JWTError as exc:
        raise TokenError(str(exc)) from exc

    if payload.get("typ") != expected_type:
        raise TokenError(f"expected {expected_type} token, got {payload.get('typ')}")

    sub = payload.get("sub")
    if not isinstance(sub, str):
        raise TokenError("token missing sub")

    try:
        return UUID(sub)
    except ValueError as exc:
        raise TokenError("token sub is not a UUID") from exc
