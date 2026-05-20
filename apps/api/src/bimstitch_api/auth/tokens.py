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

    `impersonator_user_id` is set ONLY on access tokens minted by
    `POST /admin/impersonate/{user_id}`. It records the super admin who
    initiated the session so subsequent audit log writes can attribute the
    real actor (the impersonator) alongside the on-paper actor (the
    impersonated user). Refresh tokens never carry this claim.
    """

    user_id: UUID
    jti: str | None
    exp: int
    active_organization_id: UUID | None
    impersonator_user_id: UUID | None = None


@dataclass(frozen=True)
class MintedToken:
    """Result of `create_token_with_jti` — the encoded token and its JTI.

    Use this when the caller needs the JTI immediately (e.g. impersonation
    audit log records the JTI as a correlation key). Most callers should
    use `create_token` which returns just the encoded string.
    """

    token: str
    jti: str
    expires_at: datetime


def _audience(token_type: TokenType) -> str:
    return ACCESS_AUDIENCE if token_type == "access" else REFRESH_AUDIENCE


def create_token_with_jti(
    user_id: UUID,
    token_type: TokenType,
    *,
    active_organization_id: UUID | None = None,
    impersonator_user_id: UUID | None = None,
    ttl_override_seconds: int | None = None,
) -> MintedToken:
    """Mint an access or refresh JWT and return the JTI alongside.

    `active_organization_id` is carried on both access and refresh tokens
    so a refresh operation can mint a new access token without re-reading
    the user row. The `/auth/switch-organization` endpoint mints a new
    token pair with the new claim and revokes the old access JTI.

    `impersonator_user_id` is only valid on access tokens. It encodes the
    super admin who initiated the impersonation session into the `imp`
    claim; downstream the dependency layer copies it onto request.state
    so the audit log can attribute the real actor.

    `ttl_override_seconds` clamps the token lifetime DOWN — it cannot
    extend beyond the configured TTL for the given token type. Callers
    pass it to mint shorter-lived tokens (impersonation).
    """
    if impersonator_user_id is not None and token_type != "access":
        raise ValueError("imp claim only valid on access tokens")

    settings = get_settings()
    ttl = (
        settings.jwt_access_ttl_seconds
        if token_type == "access"
        else settings.jwt_refresh_ttl_seconds
    )
    if ttl_override_seconds is not None:
        # Clamp DOWN only; never extend beyond the configured ceiling.
        ttl = min(ttl, max(ttl_override_seconds, 60))

    now = datetime.now(tz=UTC)
    expires_at = now + timedelta(seconds=ttl)
    jti = uuid4().hex
    payload: dict[str, Any] = {
        "sub": str(user_id),
        "aud": _audience(token_type),
        "typ": token_type,
        "jti": jti,
        "iat": int(now.timestamp()),
        "exp": int(expires_at.timestamp()),
    }
    if active_organization_id is not None:
        payload["org"] = str(active_organization_id)
    if impersonator_user_id is not None:
        payload["imp"] = str(impersonator_user_id)
    encoded = jwt.encode(payload, settings.jwt_secret, algorithm=ALGORITHM)
    return MintedToken(token=encoded, jti=jti, expires_at=expires_at)


def create_token(
    user_id: UUID,
    token_type: TokenType,
    *,
    active_organization_id: UUID | None = None,
    impersonator_user_id: UUID | None = None,
    ttl_override_seconds: int | None = None,
) -> str:
    """Thin wrapper over `create_token_with_jti` that returns just the
    encoded string. Use this when the caller does not need the JTI.
    """
    return create_token_with_jti(
        user_id,
        token_type,
        active_organization_id=active_organization_id,
        impersonator_user_id=impersonator_user_id,
        ttl_override_seconds=ttl_override_seconds,
    ).token


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

    impersonator_user_id: UUID | None = None
    raw_imp = payload.get("imp")
    if isinstance(raw_imp, str) and raw_imp:
        try:
            impersonator_user_id = UUID(raw_imp)
        except ValueError as exc:
            raise TokenError("token imp claim is not a UUID") from exc

    return DecodedToken(
        user_id=user_id,
        jti=jti,
        exp=raw_exp,
        active_organization_id=active_org_id,
        impersonator_user_id=impersonator_user_id,
    )


def decode_token(token: str, expected_type: TokenType) -> UUID:
    return decode_token_full(token, expected_type).user_id
