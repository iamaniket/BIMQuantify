from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, Literal
from uuid import UUID, uuid4

from jose import JWTError, jwt

from bimstitch_api.config import get_settings

TokenType = Literal["access", "refresh"]

ALGORITHM = "HS256"
ACCESS_AUDIENCE = "fastapi-users:auth"
REFRESH_AUDIENCE = "bimstitch:refresh"


class TokenError(Exception):
    pass


@dataclass(frozen=True)
class DecodedToken:
    """The full decoded form of a token.

    `active_organization_id` is None when the user has no membership yet
    (newly-invited account, or platform-only super admin) — endpoints that
    require a tenant context check for None and respond with
    `NO_ACTIVE_ORGANIZATION`.
    """

    user_id: UUID
    jti: str | None
    exp: int
    active_organization_id: UUID | None


def _audience(token_type: TokenType) -> str:
    return ACCESS_AUDIENCE if token_type == "access" else REFRESH_AUDIENCE


def create_token(
    user_id: UUID,
    token_type: TokenType,
    *,
    active_organization_id: UUID | None = None,
) -> str:
    """Mint an access or refresh JWT.

    `active_organization_id` is carried on both access and refresh tokens
    so a refresh operation can mint a new access token without re-reading
    the user row. The `/auth/switch-organization` endpoint mints a new
    token pair with the new claim and revokes the old access JTI.
    """
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
        "jti": uuid4().hex,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(seconds=ttl)).timestamp()),
    }
    if active_organization_id is not None:
        payload["org"] = str(active_organization_id)
    return jwt.encode(payload, settings.jwt_secret, algorithm=ALGORITHM)


def decode_token_full(token: str, expected_type: TokenType) -> DecodedToken:
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
        user_id = UUID(sub)
    except ValueError as exc:
        raise TokenError("token sub is not a UUID") from exc

    raw_jti = payload.get("jti")
    jti = raw_jti if isinstance(raw_jti, str) else None

    raw_exp = payload.get("exp")
    if not isinstance(raw_exp, int):
        raise TokenError("token missing exp")

    active_org_id: UUID | None = None
    raw_org = payload.get("org")
    if isinstance(raw_org, str) and raw_org:
        try:
            active_org_id = UUID(raw_org)
        except ValueError as exc:
            raise TokenError("token org claim is not a UUID") from exc

    return DecodedToken(
        user_id=user_id,
        jti=jti,
        exp=raw_exp,
        active_organization_id=active_org_id,
    )


def decode_token(token: str, expected_type: TokenType) -> UUID:
    return decode_token_full(token, expected_type).user_id
