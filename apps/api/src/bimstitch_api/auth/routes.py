from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordRequestForm
from fastapi_limiter.depends import RateLimiter
from pydantic import BaseModel
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from bimstitch_api import audit
from bimstitch_api.auth.dependencies import get_active_organization_id
from bimstitch_api.auth.fastapi_users import current_active_user, fastapi_users
from bimstitch_api.auth.logout import router as logout_router
from bimstitch_api.auth.manager import UserManager, get_user_manager
from bimstitch_api.auth.refresh import TokenPair
from bimstitch_api.auth.refresh import router as refresh_router
from bimstitch_api.auth.tokens import create_token, decode_token_full
from bimstitch_api.cache import get_redis_dep
from bimstitch_api.cache.blocklist import revoke_jti
from bimstitch_api.config import get_settings
from bimstitch_api.db import get_async_session
from bimstitch_api.models.organization import Organization
from bimstitch_api.models.organization_member import (
    OrganizationMember,
    OrganizationMemberStatus,
)
from bimstitch_api.models.user import User
from bimstitch_api.schemas.user import UserRead, UserUpdate

LOGIN_RATE_LIMITER = RateLimiter(times=get_settings().rate_limit_login_per_min, seconds=60)
FORGOT_RATE_LIMITER = RateLimiter(times=get_settings().rate_limit_forgot_per_hour, seconds=3600)


# ---------------------------------------------------------------------------
# /auth/me — rich profile including memberships
# ---------------------------------------------------------------------------


class OrgMembershipBrief(BaseModel):
    organization_id: UUID
    organization_name: str
    organization_status: str
    is_org_admin: bool
    member_status: str


class AuthMeResponse(BaseModel):
    user: UserRead
    active_organization_id: UUID | None
    memberships: list[OrgMembershipBrief]


class SwitchOrgRequest(BaseModel):
    organization_id: UUID


async def _flip_pending_memberships(session: AsyncSession, user: User) -> list[OrganizationMember]:
    """On first verified login, flip every pending membership to active
    and stamp `accepted_at`. Returns the list of flipped rows so callers
    can audit them.
    """
    stmt = select(OrganizationMember).where(
        OrganizationMember.user_id == user.id,
        OrganizationMember.status == OrganizationMemberStatus.pending,
    )
    result = await session.execute(stmt)
    pending = list(result.scalars().all())
    if not pending:
        return []

    now = datetime.now(timezone.utc)
    for m in pending:
        m.status = OrganizationMemberStatus.active
        m.accepted_at = now
    return pending


async def _ensure_active_organization(
    session: AsyncSession, user: User
) -> UUID | None:
    """If `users.active_organization_id` is unset (or points at a
    no-longer-active membership), pick the user's earliest active
    membership and set it as the default. Returns the chosen id.
    """
    if user.active_organization_id is not None:
        # Verify the link is still valid.
        stmt = select(OrganizationMember).where(
            OrganizationMember.user_id == user.id,
            OrganizationMember.organization_id == user.active_organization_id,
            OrganizationMember.status == OrganizationMemberStatus.active,
        )
        result = await session.execute(stmt)
        if result.scalar_one_or_none() is not None:
            return user.active_organization_id

    # Fall back to the earliest active membership.
    stmt = (
        select(OrganizationMember.organization_id)
        .where(
            OrganizationMember.user_id == user.id,
            OrganizationMember.status == OrganizationMemberStatus.active,
        )
        .order_by(OrganizationMember.accepted_at.asc().nulls_last())
        .limit(1)
    )
    result = await session.execute(stmt)
    org_id = result.scalar_one_or_none()
    if org_id is None:
        return None

    await session.execute(
        update(User).where(User.id == user.id).values(active_organization_id=org_id)
    )
    return org_id


def build_auth_router() -> APIRouter:
    router = APIRouter()

    # --- login returning access + refresh ---------------------------------
    login_router = APIRouter(prefix="/auth/jwt", tags=["auth"])

    @login_router.post(
        "/login",
        response_model=TokenPair,
        dependencies=[Depends(LOGIN_RATE_LIMITER)],
    )
    async def login(
        request: Request,
        credentials: OAuth2PasswordRequestForm = Depends(),
        user_manager: UserManager = Depends(get_user_manager),
        session: AsyncSession = Depends(get_async_session),
    ) -> TokenPair:
        user = await user_manager.authenticate(credentials)
        if user is None or not user.is_active:
            # `user_manager.authenticate` has already issued queries on this
            # session, so SQLAlchemy auto-began a transaction. We append the
            # audit row and commit; the explicit `async with session.begin()`
            # would conflict with the existing implicit transaction.
            await audit.record(
                session,
                action="auth.login.failure",
                resource_type="user",
                after={"email": credentials.username},
                request=request,
            )
            await session.commit()
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="LOGIN_BAD_CREDENTIALS",
            )
        if not user.is_verified:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="LOGIN_USER_NOT_VERIFIED",
            )

        # Same session, same auto-begun transaction → flip pending memberships,
        # backfill active org, emit audit, commit once at the end.
        flipped = await _flip_pending_memberships(session, user)
        for m in flipped:
            await audit.record(
                session,
                action="organization_member.accepted",
                resource_type="organization_member",
                resource_id=m.id,
                after={"organization_id": str(m.organization_id)},
                actor_user_id=user.id,
                organization_id=m.organization_id,
                request=request,
            )

        active_org_id = await _ensure_active_organization(session, user)

        await audit.record(
            session,
            action="auth.login.success",
            resource_type="user",
            resource_id=user.id,
            actor_user_id=user.id,
            organization_id=active_org_id,
            request=request,
        )
        await session.commit()

        return TokenPair(
            access_token=create_token(
                user.id, "access", active_organization_id=active_org_id
            ),
            refresh_token=create_token(
                user.id, "refresh", active_organization_id=active_org_id
            ),
        )

    router.include_router(login_router)

    # --- /auth/me + /auth/switch-organization -----------------------------
    me_router = APIRouter(prefix="/auth", tags=["auth"])

    @me_router.get("/me", response_model=AuthMeResponse)
    async def auth_me(
        user: User = Depends(current_active_user),
        active_org_id: UUID | None = Depends(get_active_organization_id),
        session: AsyncSession = Depends(get_async_session),
    ) -> AuthMeResponse:
        stmt = (
            select(OrganizationMember, Organization)
            .join(Organization, Organization.id == OrganizationMember.organization_id)
            .where(
                OrganizationMember.user_id == user.id,
                OrganizationMember.status != OrganizationMemberStatus.removed,
                Organization.deleted_at.is_(None),
            )
            .order_by(Organization.name.asc())
        )
        result = await session.execute(stmt)
        memberships: list[OrgMembershipBrief] = []
        for m, org in result.all():
            memberships.append(
                OrgMembershipBrief(
                    organization_id=org.id,
                    organization_name=org.name,
                    organization_status=org.status.value,
                    is_org_admin=m.is_org_admin,
                    member_status=m.status.value,
                )
            )

        return AuthMeResponse(
            user=UserRead.model_validate(user, from_attributes=True),
            active_organization_id=active_org_id,
            memberships=memberships,
        )

    @me_router.post("/switch-organization", response_model=TokenPair)
    async def switch_organization(
        request: Request,
        payload: SwitchOrgRequest,
        user: User = Depends(current_active_user),
        session: AsyncSession = Depends(get_async_session),
        redis: Any = Depends(get_redis_dep),
    ) -> TokenPair:
        # Verify the requested org is one the user actually belongs to with
        # an active membership. Checked inline (rather than via a
        # dependency) because the org id arrives in the body, not the path.
        stmt = select(OrganizationMember).where(
            OrganizationMember.user_id == user.id,
            OrganizationMember.organization_id == payload.organization_id,
            OrganizationMember.status == OrganizationMemberStatus.active,
        )
        if (await session.execute(stmt)).scalar_one_or_none() is None:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="ORG_MEMBERSHIP_REQUIRED",
            )
        # Revoke the current access token if we can decode it from the
        # request headers — keeps a switched-from token from continuing
        # to act in the old org until its natural expiry.
        auth_header = request.headers.get("authorization") or ""
        if auth_header.lower().startswith("bearer "):
            current_access = auth_header.split(" ", 1)[1].strip()
            try:
                decoded = decode_token_full(current_access, "access")
                if decoded.jti is not None and decoded.exp is not None:
                    ttl = max(decoded.exp - int(datetime.now(timezone.utc).timestamp()), 1)
                    await revoke_jti(redis, decoded.jti, ttl)
            except Exception:
                # Bad/expired token — nothing to revoke.
                pass

        # Persist the choice on the user row so subsequent logins land
        # on the same org. `require_active_org_membership` already issued
        # a query, so the session has an auto-begun transaction — write
        # and commit directly rather than opening a nested one.
        await session.execute(
            update(User)
            .where(User.id == user.id)
            .values(active_organization_id=payload.organization_id)
        )
        await audit.record(
            session,
            action="auth.switch_organization",
            resource_type="user",
            resource_id=user.id,
            actor_user_id=user.id,
            organization_id=payload.organization_id,
            request=request,
        )
        await session.commit()

        return TokenPair(
            access_token=create_token(
                user.id, "access", active_organization_id=payload.organization_id
            ),
            refresh_token=create_token(
                user.id, "refresh", active_organization_id=payload.organization_id
            ),
        )

    router.include_router(me_router)

    # --- FastAPI Users built-in routers -----------------------------------
    # NOTE: /auth/register is intentionally NOT included. All user creation
    # goes through admin invite endpoints.
    router.include_router(fastapi_users.get_verify_router(UserRead), prefix="/auth", tags=["auth"])
    router.include_router(
        fastapi_users.get_reset_password_router(),
        prefix="/auth",
        tags=["auth"],
        dependencies=[Depends(FORGOT_RATE_LIMITER)],
    )
    router.include_router(
        fastapi_users.get_users_router(UserRead, UserUpdate),
        prefix="/users",
        tags=["users"],
    )

    # --- custom refresh + logout endpoints --------------------------------
    router.include_router(refresh_router)
    router.include_router(logout_router)

    return router
