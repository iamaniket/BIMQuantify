"""Super-admin impersonation endpoint.

`POST /admin/impersonate/{user_id}` mints a short-lived access token for
another user so the platform team can reproduce a customer's exact view
during a support session. The token is access-only (no refresh) so the
session ends at expiry unless explicitly extended by re-impersonating,
and every audit row written while the token is in use carries
`impersonator_user_id` so we always know who really did what.

Restrictions:
* super admin only
* target must be active + verified
* cannot impersonate another super admin
* cannot self-impersonate
* TTL is clamped DOWN to `IMPERSONATION_TOKEN_TTL_SECONDS`
"""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from redis.asyncio import Redis
from redis.exceptions import RedisError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from bimstitch_api import audit
from bimstitch_api.auth.dependencies import require_superuser
from bimstitch_api.auth.tokens import (
    DecodedToken,
    TokenError,
    create_token_with_jti,
    decode_token_full,
)
from bimstitch_api.cache import get_redis_dep
from bimstitch_api.cache.blocklist import revoke_jti
from bimstitch_api.config import get_settings
from bimstitch_api.db import get_async_session
from bimstitch_api.models.organization_member import (
    OrganizationMember,
    OrganizationMemberStatus,
)
from bimstitch_api.models.user import User
from bimstitch_api.schemas.admin import (
    ImpersonatedUserSummary,
    ImpersonateRequest,
    ImpersonateResponse,
    ImpersonateStopResponse,
)

router = APIRouter(prefix="/admin", tags=["admin-impersonate"])

# auto_error=True: a `stop` call without a bearer token is a 401, not a
# silent no-op — the endpoint identifies the session from the token itself.
_oauth2_scheme = OAuth2PasswordBearer(tokenUrl="auth/jwt/login", auto_error=True)


def _remaining_ttl_seconds(decoded: DecodedToken) -> int:
    return max(decoded.exp - int(datetime.now(tz=UTC).timestamp()), 0)


# NOTE: this literal-path route MUST be declared before `/impersonate/{user_id}`.
# Starlette matches in declaration order and `{user_id}` (str convertor) would
# otherwise swallow "stop" and fail UUID validation with a 422.
@router.post(
    "/impersonate/stop",
    response_model=ImpersonateStopResponse,
    status_code=status.HTTP_200_OK,
)
async def stop_impersonation(
    request: Request,
    access_token: str = Depends(_oauth2_scheme),
    session: AsyncSession = Depends(get_async_session),
    redis: Redis = Depends(get_redis_dep),
) -> ImpersonateStopResponse:
    """End the active impersonation session immediately.

    Called WITH the impersonation access token — the `imp`-bearing token the
    portal swapped in. Possessing that token is what authorizes ending it, so
    this endpoint deliberately does NOT gate on `require_superuser`: the
    token's `sub` is the impersonated (regular) user, who is not a super
    admin. We verify instead that the presented token actually carries an
    `imp` claim.

    The impersonation token is access-only and would otherwise linger until
    its (short) TTL expires. Revoking its JTI on the blocklist cuts the
    session off at once, and an `auth.impersonate.stop` audit row — attributed
    to the real super admin — closes the bracket opened by
    `auth.impersonate.start`.
    """
    try:
        decoded = decode_token_full(access_token, "access")
    except TokenError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)
        ) from exc

    impersonator_id = decoded.impersonator_user_id
    if impersonator_id is None:
        # A normal (non-impersonated) token has nothing to stop.
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="NOT_AN_IMPERSONATION_SESSION",
        )

    # Fail closed: if the blocklist write can't persist, report the session as
    # not-yet-ended (503) rather than 200 for a token that still authenticates.
    try:
        if decoded.jti:
            await revoke_jti(redis, decoded.jti, _remaining_ttl_seconds(decoded))
    except RedisError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="IMPERSONATION_STOP_UNAVAILABLE",
        ) from exc

    await audit.record_for_org(
        session,
        decoded.active_organization_id,
        action="auth.impersonate.stop",
        resource_type="user",
        resource_id=decoded.user_id,
        after={
            "target_user_id": str(decoded.user_id),
            "organization_id": (
                str(decoded.active_organization_id)
                if decoded.active_organization_id
                else None
            ),
            "jti": decoded.jti,
        },
        # The super admin (recorded in `imp`) is the real actor ending the
        # session, mirroring how the start event attributes itself.
        actor_user_id=impersonator_id,
        impersonator_user_id=impersonator_id,
        request=request,
    )
    await session.commit()

    return ImpersonateStopResponse(
        impersonated_user_id=decoded.user_id,
        impersonator_user_id=impersonator_id,
    )


@router.post(
    "/impersonate/{user_id}",
    response_model=ImpersonateResponse,
    status_code=status.HTTP_200_OK,
)
async def start_impersonation(
    user_id: UUID,
    request: Request,
    payload: ImpersonateRequest,
    requester: User = Depends(require_superuser),
    session: AsyncSession = Depends(get_async_session),
) -> ImpersonateResponse:
    if user_id == requester.id:
        # Self-impersonation has no support value and would muddy audit.
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="CANNOT_IMPERSONATE_SELF",
        )

    target = await session.get(User, user_id)
    if target is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="USER_NOT_FOUND"
        )

    if target.is_superuser:
        # Refuse super-on-super to keep the audit trail unambiguous.
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="CANNOT_IMPERSONATE_SUPERUSER",
        )
    if not target.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="CANNOT_IMPERSONATE_INACTIVE",
        )
    if not target.is_verified:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="CANNOT_IMPERSONATE_UNVERIFIED",
        )

    # Resolve the org claim. If the body specifies an org, the target must
    # actually be an active member of it (regular OR guest is fine — guest
    # impersonation is supported and useful for reproducing guest scope).
    resolved_org: UUID | None = None
    if payload.organization_id is not None:
        membership = await session.execute(
            select(OrganizationMember.id).where(
                OrganizationMember.user_id == target.id,
                OrganizationMember.organization_id == payload.organization_id,
                OrganizationMember.status == OrganizationMemberStatus.active,
            )
        )
        if membership.scalar_one_or_none() is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="TARGET_NOT_IN_ORG",
            )
        resolved_org = payload.organization_id
    else:
        resolved_org = target.active_organization_id

    settings = get_settings()
    ceiling = settings.impersonation_token_ttl_seconds
    if payload.ttl_seconds is None:
        ttl = ceiling
    else:
        # Floor enforced by pydantic (ge=60); ceiling enforced here so a
        # bigger request can't extend beyond the configured maximum.
        ttl = min(payload.ttl_seconds, ceiling)

    minted = create_token_with_jti(
        target.id,
        "access",
        active_organization_id=resolved_org,
        impersonator_user_id=requester.id,
        ttl_override_seconds=ttl,
    )

    await audit.record_for_org(
        session,
        resolved_org,
        action="auth.impersonate.start",
        resource_type="user",
        resource_id=target.id,
        after={
            "target_user_id": str(target.id),
            "target_email": target.email,
            "organization_id": str(resolved_org) if resolved_org else None,
            "ttl_seconds": ttl,
            "jti": minted.jti,
            "reason": payload.reason,
        },
        # Actor here is the super admin starting the session; record the
        # impersonator field explicitly because the start event itself is
        # NOT made via an impersonated token (the super admin's normal
        # token has no `imp` claim yet). resolved_org=None routes the entry
        # to the platform schema.
        actor_user_id=requester.id,
        impersonator_user_id=requester.id,
        request=request,
    )
    await session.commit()

    expires_at: datetime = minted.expires_at
    expires_in = int((expires_at - datetime.now(tz=expires_at.tzinfo)).total_seconds())

    return ImpersonateResponse(
        access_token=minted.token,
        expires_in=max(expires_in, 0),
        expires_at=expires_at,
        impersonated_user=ImpersonatedUserSummary(
            id=target.id,
            email=target.email,
            full_name=target.full_name,
            active_organization_id=resolved_org,
        ),
    )
