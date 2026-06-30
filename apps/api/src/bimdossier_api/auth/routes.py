import secrets
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.security import OAuth2PasswordRequestForm
from fastapi_users import exceptions as fau_exceptions
from fastapi_users.jwt import decode_jwt
from pydantic import BaseModel, EmailStr
from redis.asyncio import Redis
from redis.exceptions import RedisError
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from bimdossier_api import audit
from bimdossier_api.admin.storage import compute_storage_gb_bulk
from bimdossier_api.auth import lockout
from bimdossier_api.auth.dependencies import get_active_organization_id
from bimdossier_api.auth.fastapi_users import current_active_user, fastapi_users
from bimdossier_api.auth.lockout_alert import maybe_alert_on_lockout
from bimdossier_api.auth.logout import router as logout_router
from bimdossier_api.auth.manager import UserManager, get_user_manager
from bimdossier_api.auth.ratelimit import ResilientRateLimiter
from bimdossier_api.auth.refresh import TokenPair
from bimdossier_api.auth.refresh import router as refresh_router
from bimdossier_api.auth.tokens import TokenError, create_token, decode_token_full
from bimdossier_api.cache import get_redis_dep
from bimdossier_api.cache.blocklist import revoke_jti
from bimdossier_api.config import get_settings
from bimdossier_api.db import get_async_session, get_session_maker
from bimdossier_api.entitlements import PLAN_FREE, PLAN_PAID, resolve_plan
from bimdossier_api.i18n import coerce_locale
from bimdossier_api.models.organization import Organization, OrganizationStatus
from bimdossier_api.models.organization_member import (
    OrganizationMember,
    OrganizationMemberStatus,
)
from bimdossier_api.models.user import User
from bimdossier_api.routers.free_access import user_has_free_participation
from bimdossier_api.schemas.user import UserRead, UserUpdate
from bimdossier_api.storage import get_attachments_bucket, get_storage

LOGIN_RATE_LIMITER = ResilientRateLimiter(times=get_settings().rate_limit_login_per_min, seconds=60)
FORGOT_RATE_LIMITER = ResilientRateLimiter(
    times=get_settings().rate_limit_forgot_per_hour, seconds=3600
)
# Per-IP/hour throttle on the resend-activation endpoint. Each call emails an
# activation link, so an unthrottled endpoint is an email-bomb vector.
VERIFY_REQUEST_RATE_LIMITER = ResilientRateLimiter(
    times=get_settings().rate_limit_verify_request_per_hour, seconds=3600
)
# Per-IP/hour throttle on the public free-tier signup endpoint (same email-bomb
# posture as forgot-password / request-verify). Only wired when the route is
# mounted (FREE_TIER_ENABLED).
SIGNUP_RATE_LIMITER = ResilientRateLimiter(
    times=get_settings().rate_limit_signup_per_hour, seconds=3600
)


# ---------------------------------------------------------------------------
# /auth/me — rich profile including memberships
# ---------------------------------------------------------------------------


class OrgMembershipBrief(BaseModel):
    organization_id: UUID
    organization_name: str
    organization_status: str
    is_org_admin: bool
    member_status: str
    seat_limit: int | None
    seat_count_used: int
    active_storage_limit_gb: int | None
    active_storage_used_gb: float
    organization_image_url: str | None = None
    # The org's entitlement/plan (e.g. "paid"). The ENTITLEMENT axis, distinct
    # from ISOLATION — see entitlements.resolve_plan. Defaults so older callers
    # that don't send it still validate.
    plan: str = PLAN_PAID


class AuthMeResponse(BaseModel):
    user: UserRead
    active_organization_id: UUID | None
    memberships: list[OrgMembershipBrief]
    pending_invitations_count: int
    # True when the user owns or is a member of ≥1 free project — drives whether
    # the portal shows a "Free workspace" entry in the org switcher.
    has_free_workspace: bool = False
    # The acting principal's PLAN (entitlement) for the active scope: "free" when
    # org-less (pooled), else the active org's plan. This is the read-only TIER
    # signal the client gates UI on — ORTHOGONAL to the isolation surface
    # (active_organization_id). Re-checked server-side on gated actions.
    plan: str = PLAN_FREE


class SwitchToFreeRequest(BaseModel):
    # Optional current refresh token, revoked alongside the access token so a
    # replayed pre-switch refresh can't keep minting org-scoped access. Mirrors
    # SwitchOrgRequest.
    refresh_token: str | None = None


class SwitchOrgRequest(BaseModel):
    organization_id: UUID
    # Optional: the caller's current refresh token. When provided it is
    # revoked alongside the access token so a replayed pre-switch refresh
    # can't silently mint a new access scoped to the previous org. Omitting
    # it keeps the call backward compatible (soft switch).
    refresh_token: str | None = None


class ActivateRequest(BaseModel):
    token: str
    password: str


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class RequestVerifyTokenRequest(BaseModel):
    email: EmailStr


class SignupRequest(BaseModel):
    """Public free-tier signup body. `locale` is the new account's preferred
    language (coerced to a supported locale, platform default otherwise) so
    later single-locale emails (password reset) and the portal render correctly.
    The activation email itself is bilingual — the recipient has no verified
    locale yet."""

    email: EmailStr
    locale: str | None = None
    # Optional lead enrichment captured on the free-signup form. No validation
    # (both optional); truncated to the column width in the handler so an
    # oversized value can never break the always-202 contract.
    full_name: str | None = None
    company: str | None = None


async def _decode_verify_token_to_user(
    user_manager: UserManager, token: str
) -> User:
    """Decode a verify-audience JWT and resolve it to a User row.

    Re-implements the early half of `BaseUserManager.verify`
    (fastapi_users/manager.py:321-347 in the vendored lib) without the
    is_verified flip. Used by the /auth/activate flow so we can:
      - bounce inactive users BEFORE flipping is_verified, and
      - recover the user on the already-verified replay branch
        without re-decoding through user_manager.verify() (which would
        raise UserAlreadyVerified before returning the user).
    """
    try:
        data = decode_jwt(
            token,
            user_manager.verification_token_secret,
            [user_manager.verification_token_audience],
        )
        user_id = data["sub"]
        email = data["email"]
        parsed_id = user_manager.parse_id(user_id)
    except Exception as exc:  # any JWT decode or shape error is "bad token"
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="ACTIVATION_BAD_TOKEN",
        ) from exc
    try:
        user = await user_manager.get_by_email(email)
    except fau_exceptions.UserNotExists as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="ACTIVATION_BAD_TOKEN",
        ) from exc
    if parsed_id != user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="ACTIVATION_BAD_TOKEN",
        )
    return user


async def _flip_pending_memberships(session: AsyncSession, user: User) -> list[OrganizationMember]:
    """Bootstrap auto-accept on login.

    Existing users — those who already belong to at least one active org —
    must explicitly accept new invites via `/me/invitations`. Otherwise an
    admin could silently add them to a new tenant they didn't agree to.

    The exception is the bootstrap case: a brand-new user who has zero
    active memberships and exactly one pending row. They were created
    BECAUSE of that invite, so auto-accepting it is the only way they
    land logged-in with an active org. If multiple invites arrived before
    they activated, leave them all pending — the user picks via the
    `/me/invitations` UI.

    Expired pending rows are skipped entirely — auto-accepting an invite
    that the sweeper would have already tombstoned would be a silent
    rule-bypass.

    Returns the list of flipped rows so callers can audit them.
    """
    from bimdossier_api.admin.membership_rules import invitation_is_expired

    stmt = select(OrganizationMember).where(
        OrganizationMember.user_id == user.id,
    )
    result = await session.execute(stmt)
    rows = list(result.scalars().all())
    if not rows:
        return []

    settings = get_settings()
    has_non_pending = any(m.status != OrganizationMemberStatus.pending for m in rows)
    pending = [
        m
        for m in rows
        if m.status == OrganizationMemberStatus.pending
        and not invitation_is_expired(m.invited_at, settings.invitation_ttl_days)
    ]
    if has_non_pending or len(pending) != 1:
        return []

    now = datetime.now(UTC)
    sole = pending[0]
    sole.status = OrganizationMemberStatus.active
    sole.accepted_at = now
    return [sole]


async def _ensure_active_organization(
    session: AsyncSession, user: User
) -> UUID | None:
    """If `users.active_organization_id` is unset (or points at a
    no-longer-usable membership), pick the user's earliest active
    membership in a non-suspended, non-deleted org. Returns the chosen id,
    or None when the user has no usable org (all suspended/deleted).
    """
    # Validate the current pointer: membership must be active AND the org
    # must be available (not suspended, not deleted). This is the same
    # check as `_verify_membership` in tenancy.py, kept inline here to
    # avoid a circular import.
    if user.active_organization_id is not None:
        stmt = (
            select(OrganizationMember, Organization)
            .join(Organization, Organization.id == OrganizationMember.organization_id)
            .where(
                OrganizationMember.user_id == user.id,
                OrganizationMember.organization_id == user.active_organization_id,
                OrganizationMember.status == OrganizationMemberStatus.active,
                Organization.status == OrganizationStatus.active,
                Organization.deleted_at.is_(None),
            )
        )
        result = await session.execute(stmt)
        if result.first() is not None:
            return user.active_organization_id

    # Fall back to the earliest membership in an available org.
    stmt = (
        select(OrganizationMember.organization_id)
        .join(Organization, Organization.id == OrganizationMember.organization_id)
        .where(
            OrganizationMember.user_id == user.id,
            OrganizationMember.status == OrganizationMemberStatus.active,
            Organization.status == OrganizationStatus.active,
            Organization.deleted_at.is_(None),
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
        redis: Redis = Depends(get_redis_dep),
    ) -> TokenPair:
        settings = get_settings()
        username = lockout.normalize_username(credentials.username)

        # Per-account lockout gate (H6) — keyed on the account, independent of
        # source IP, so it survives IP rotation (distributed credential stuffing
        # the per-IP LOGIN_RATE_LIMITER can't see). Checked BEFORE authenticate so
        # a locked attacker can't confirm a guessed password and we skip the hash.
        locked, retry_after = await lockout.is_locked(redis, username)
        if locked:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="LOGIN_ACCOUNT_LOCKED",
                headers={"Retry-After": str(retry_after)},
            )

        user = await user_manager.authenticate(credentials)
        if user is None or not user.is_active:
            # Count this failure against the account (Redis; outside the DB
            # transaction). Runs for unknown emails too — the lock behaves
            # identically whether or not the address is a real user, so it can't
            # be used to enumerate accounts.
            result = await lockout.register_failure(redis, username, settings)

            # `user_manager.authenticate` has already issued queries on this
            # session, so SQLAlchemy auto-began a transaction. We append the
            # audit row and commit; the explicit `async with session.begin()`
            # would conflict with the existing implicit transaction.
            await audit.record_for_org(
                session,
                None,
                action="auth.login.failure",
                resource_type="user",
                after={"email": credentials.username},
                request=request,
            )
            await session.commit()

            # On the exact failure that crossed the threshold, alert org admins +
            # super-admins (best-effort; never breaks the login response).
            if result.just_locked:
                await maybe_alert_on_lockout(
                    session, request, username, result.fail_count
                )

            if result.locked:
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail="LOGIN_ACCOUNT_LOCKED",
                    headers={"Retry-After": str(result.retry_after)},
                )
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="LOGIN_BAD_CREDENTIALS",
            )
        if not user.is_verified:
            # A correct password for a real account is not a failed credential
            # attempt — clear the counter so the verify gate can't accrue a lock.
            await lockout.clear_failures(redis, username)
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="LOGIN_USER_NOT_VERIFIED",
            )

        # Successful credential check → reset the account's failure/backoff state.
        await lockout.clear_failures(redis, username)

        # Same session, same auto-begun transaction → flip pending memberships,
        # backfill active org, emit audit, commit once at the end.
        flipped = await _flip_pending_memberships(session, user)
        for m in flipped:
            await audit.record_for_org(
                session,
                m.organization_id,
                action="organization_member.accepted",
                resource_type="organization_member",
                resource_id=m.id,
                after={"organization_id": str(m.organization_id)},
                actor_user_id=user.id,
                request=request,
            )

        active_org_id = await _ensure_active_organization(session, user)

        await audit.record_for_org(
            session,
            active_org_id,
            action="auth.login.success",
            resource_type="user",
            resource_id=user.id,
            actor_user_id=user.id,
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
        rows = result.all()

        # Bulk seat-usage lookup so the sidebar can render "used / limit"
        # without an extra round-trip per membership.
        from sqlalchemy import func as _func

        org_ids = [org.id for _m, org in rows]
        seat_counts: dict[UUID, int] = {}
        if org_ids:
            seat_stmt = (
                select(
                    OrganizationMember.organization_id,
                    _func.count(OrganizationMember.id),
                )
                .where(
                    OrganizationMember.organization_id.in_(org_ids),
                    OrganizationMember.status != OrganizationMemberStatus.removed,
                )
                .group_by(OrganizationMember.organization_id)
            )
            seat_result = await session.execute(seat_stmt)
            seat_counts = {row[0]: int(row[1]) for row in seat_result.all()}

        # Bulk active-storage lookup per org.
        storage_usage: dict[UUID, float] = {}
        active_orgs = [org for _m, org in rows if org.status == OrganizationStatus.active]
        if active_orgs:
            storage_usage = await compute_storage_gb_bulk(get_session_maker(), active_orgs)

        # Resolve org image presigned URLs
        storage = get_storage()
        att_bucket = get_attachments_bucket()
        image_urls: dict[UUID, str] = {}
        for _m, org in rows:
            if org.image_key:
                image_urls[org.id] = await storage.presigned_get_url(
                    org.image_key, "org-logo", bucket=att_bucket,
                )

        memberships: list[OrgMembershipBrief] = []
        for m, org in rows:
            memberships.append(
                OrgMembershipBrief(
                    organization_id=org.id,
                    organization_name=org.name,
                    organization_status=org.status.value,
                    is_org_admin=m.is_org_admin,
                    member_status=m.status.value,
                    seat_limit=org.seat_limit,
                    seat_count_used=seat_counts.get(org.id, 0),
                    active_storage_limit_gb=org.active_storage_limit_gb,
                    active_storage_used_gb=storage_usage.get(org.id, 0.0),
                    organization_image_url=image_urls.get(org.id),
                    plan=org.plan or PLAN_PAID,
                )
            )

        pending_count = sum(
            1 for m, org in rows
            if m.status == OrganizationMemberStatus.pending
        )

        # Free participation (owns or is a member of a free project) — drives the
        # "Free workspace" switcher entry. RLS-bypassed here (superuser session).
        has_free = await user_has_free_participation(session, user.id)

        # ENTITLEMENT (plan) for the active scope — orthogonal to ISOLATION
        # (active_organization_id). Org-less → "free"; otherwise the active org's
        # plan. The active org is the membership matching the JWT's `org` claim;
        # a stale claim with no matching membership falls through to "free".
        active_org = next(
            (org for _m, org in rows if org.id == active_org_id), None
        ) if active_org_id is not None else None
        plan = resolve_plan(active_org)

        return AuthMeResponse(
            user=UserRead.model_validate(user, from_attributes=True),
            active_organization_id=active_org_id,
            memberships=memberships,
            pending_invitations_count=pending_count,
            has_free_workspace=has_free,
            plan=plan,
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
        # an active membership AND the org is in a usable state. Checked
        # inline (rather than via a dependency) because the org id arrives
        # in the body, not the path.
        stmt = (
            select(OrganizationMember, Organization)
            .join(Organization, Organization.id == OrganizationMember.organization_id)
            .where(
                OrganizationMember.user_id == user.id,
                OrganizationMember.organization_id == payload.organization_id,
                OrganizationMember.status == OrganizationMemberStatus.active,
            )
        )
        row = (await session.execute(stmt)).first()
        if row is not None:
            _, target_org = row
            if target_org.status == OrganizationStatus.suspended or target_org.deleted_at is not None:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="ORG_SUSPENDED",
                )
        if row is None:
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
            except TokenError:
                # Bad/expired token — nothing to revoke.
                decoded = None
            if decoded is not None and decoded.jti is not None and decoded.exp is not None:
                ttl = max(decoded.exp - int(datetime.now(UTC).timestamp()), 1)
                try:
                    await revoke_jti(redis, decoded.jti, ttl)
                except RedisError as exc:
                    # Fail CLOSED (mirrors logout): a switch that can't persist the
                    # old-org token's revocation must not report success — the old
                    # access token would keep acting in the previous org. We raise
                    # before the DB write below, so the switch is not persisted.
                    raise HTTPException(
                        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                        detail="SWITCH_REVOCATION_UNAVAILABLE",
                    ) from exc

        # Hard switch: also revoke the old refresh token when the client sends
        # it, so a replayed pre-switch refresh can't mint a fresh access scoped
        # to the previous org. Guard on `sub == user.id` defensively — a caller
        # can only ever revoke their own token, but assert it anyway.
        if payload.refresh_token:
            try:
                old_refresh = decode_token_full(payload.refresh_token, "refresh")
            except TokenError:
                # Bad/expired refresh token — nothing to revoke.
                old_refresh = None
            if (
                old_refresh is not None
                and old_refresh.user_id == user.id
                and old_refresh.jti is not None
            ):
                ttl = max(old_refresh.exp - int(datetime.now(UTC).timestamp()), 1)
                try:
                    await revoke_jti(redis, old_refresh.jti, ttl)
                except RedisError as exc:
                    # Fail CLOSED — same rationale as the access-token revoke above.
                    raise HTTPException(
                        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                        detail="SWITCH_REVOCATION_UNAVAILABLE",
                    ) from exc

        # Persist the choice on the user row so subsequent logins land
        # on the same org. `require_active_org_membership` already issued
        # a query, so the session has an auto-begun transaction — write
        # and commit directly rather than opening a nested one.
        await session.execute(
            update(User)
            .where(User.id == user.id)
            .values(active_organization_id=payload.organization_id)
        )
        await audit.record_for_org(
            session,
            payload.organization_id,
            action="auth.switch_organization",
            resource_type="user",
            resource_id=user.id,
            actor_user_id=user.id,
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

    @me_router.post("/switch-to-free", response_model=TokenPair)
    async def switch_to_free(
        request: Request,
        payload: SwitchToFreeRequest,
        user: User = Depends(current_active_user),
        session: AsyncSession = Depends(get_async_session),
        redis: Any = Depends(get_redis_dep),
    ) -> TokenPair:
        # The free workspace is a selectable context: dropping the active org →
        # the next tokens carry NO `org` claim, so org endpoints 409 and /free/*
        # serves the user's pooled data. Only enter it if there's something
        # there — the user owns or is a member of ≥1 free project.
        if not await user_has_free_participation(session, user.id):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="FREE_WORKSPACE_UNAVAILABLE",
            )
        # Revoke the current org-scoped access token (mirrors switch-organization)
        # so it can't keep acting in the previous org until its natural expiry.
        auth_header = request.headers.get("authorization") or ""
        if auth_header.lower().startswith("bearer "):
            current_access = auth_header.split(" ", 1)[1].strip()
            try:
                decoded = decode_token_full(current_access, "access")
            except TokenError:
                decoded = None
            if decoded is not None and decoded.jti is not None and decoded.exp is not None:
                ttl = max(decoded.exp - int(datetime.now(UTC).timestamp()), 1)
                try:
                    await revoke_jti(redis, decoded.jti, ttl)
                except RedisError as exc:
                    # Fail CLOSED — same rationale as switch-organization.
                    raise HTTPException(
                        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                        detail="SWITCH_REVOCATION_UNAVAILABLE",
                    ) from exc
        if payload.refresh_token:
            try:
                old_refresh = decode_token_full(payload.refresh_token, "refresh")
            except TokenError:
                old_refresh = None
            if (
                old_refresh is not None
                and old_refresh.user_id == user.id
                and old_refresh.jti is not None
            ):
                ttl = max(old_refresh.exp - int(datetime.now(UTC).timestamp()), 1)
                try:
                    await revoke_jti(redis, old_refresh.jti, ttl)
                except RedisError as exc:
                    raise HTTPException(
                        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                        detail="SWITCH_REVOCATION_UNAVAILABLE",
                    ) from exc
        await session.execute(
            update(User).where(User.id == user.id).values(active_organization_id=None)
        )
        await session.commit()
        return TokenPair(
            access_token=create_token(user.id, "access", active_organization_id=None),
            refresh_token=create_token(user.id, "refresh", active_organization_id=None),
        )

    router.include_router(me_router)

    # --- activate: invite-acceptance flow ---------------------------------
    # POST /auth/activate { token, password } — atomically flips
    # is_verified=true AND sets the password using a single verify-audience
    # token (the one in the invite email). Replaces the legacy two-call
    # client flow (verify + reset-password) which always failed at step 2
    # because /auth/reset-password decodes a different JWT audience.
    activate_router = APIRouter(prefix="/auth", tags=["auth"])

    @activate_router.post(
        "/activate",
        status_code=status.HTTP_204_NO_CONTENT,
        response_class=Response,
    )
    async def activate(
        payload: ActivateRequest,
        request: Request,
        user_manager: UserManager = Depends(get_user_manager),
    ) -> Response:
        # Resolve the user from the token first so an inactive user is
        # rejected BEFORE we flip is_verified. Bad/expired/forged tokens
        # raise HTTPException(400, ACTIVATION_BAD_TOKEN) here.
        user = await _decode_verify_token_to_user(user_manager, payload.token)
        if not user.is_active:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="ACTIVATION_USER_INACTIVE",
            )

        # Enforce the password policy BEFORE flipping is_verified (below). The
        # activate flow sets the initial password via `_update`, which bypasses
        # fastapi-users' own validate_password call — so invoke it explicitly
        # here. Doing it up front means a rejected password never leaves the
        # account verified-but-unusable. (SOC2 CC6.1)
        try:
            await user_manager.validate_password(payload.password, user)
        except fau_exceptions.InvalidPasswordException as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "code": "ACTIVATION_INVALID_PASSWORD",
                    "reason": exc.reason,
                },
            ) from exc

        # The activation token sets the password EXACTLY ONCE — on the call that
        # flips is_verified. A replay against an already-verified user is an
        # idempotent no-op that must NOT reset the password: the token is a
        # stateless ~7-day verify JWT with no credential fingerprint, so anyone
        # who later observes the one-time invite link (forwarded mail, proxy/
        # browser logs, a link prefetcher) could otherwise take over an active
        # account by POSTing a new password. See F1.
        if not user.is_verified:
            try:
                user = await user_manager.verify(payload.token, request)
            except fau_exceptions.UserAlreadyVerified:
                # Lost the race to a concurrent activation that already set the
                # password — treat as the no-op replay path.
                return Response(status_code=status.HTTP_204_NO_CONTENT)
            except (
                fau_exceptions.InvalidVerifyToken,
                fau_exceptions.UserNotExists,
            ) as exc:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="ACTIVATION_BAD_TOKEN",
                ) from exc

            try:
                # Stamp the token epoch alongside the initial password so any
                # pre-activation session (there should be none) is invalidated.
                await user_manager._update(
                    user,
                    {
                        "password": payload.password,
                        "tokens_valid_after": datetime.now(UTC),
                    },
                )
            except fau_exceptions.InvalidPasswordException as e:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail={
                        "code": "ACTIVATION_INVALID_PASSWORD",
                        "reason": e.reason,
                    },
                ) from e

            # Forensic trail (H9): account activated (verified + initial password
            # set). Inside the `not user.is_verified` branch so an idempotent
            # replay (which short-circuits above without re-setting the password)
            # does not double-record. Org-less event → platform schema.
            # Best-effort, in the route (not on_after_verify, which also fires on
            # the legacy plain-verify path and lacks the request).
            await audit.record_event_independent(
                None,
                action="auth.activate",
                resource_type="user",
                resource_id=user.id,
                actor_user_id=user.id,
                request=request,
            )

        return Response(status_code=status.HTTP_204_NO_CONTENT)

    router.include_router(activate_router)

    # --- forgot-password shadow with rate limiting ------------------------
    # FastAPI Users' get_reset_password_router() bundles forgot+reset; we
    # need the limiter on forgot only — reset is already gated by a single
    # signed JWT, so adding a 3/hour bucket there just locks users out after
    # a few mistypes. Register this BEFORE the bundled router so Starlette's
    # first-match-wins picks ours for /auth/forgot-password.
    forgot_router = APIRouter(prefix="/auth", tags=["auth"])

    @forgot_router.post(
        "/forgot-password",
        status_code=status.HTTP_202_ACCEPTED,
        dependencies=[Depends(FORGOT_RATE_LIMITER)],
    )
    async def forgot_password(
        request: Request,
        payload: ForgotPasswordRequest,
        user_manager: UserManager = Depends(get_user_manager),
    ) -> None:
        try:
            user = await user_manager.get_by_email(payload.email)
        except fau_exceptions.UserNotExists:
            return
        try:
            await user_manager.forgot_password(user, request)
        except fau_exceptions.UserInactive:
            return

    router.include_router(forgot_router)

    # --- public free-tier signup (mounted only when FREE_TIER_ENABLED) ----
    # We are invite-only by default: there is no /auth/register, and org /
    # founding-partner onboarding stays invite-only and unchanged. The free
    # wedge needs ONE public door — a real, email-verified, ORG-LESS account.
    #
    # Threat model: reintroducing public signup reopens (a) email-bomb via the
    # activation mail, (b) account enumeration, (c) mass fake signups.
    # Mitigations: per-IP ResilientRateLimiter (SIGNUP_RATE_LIMITER), an
    # always-202 enumeration-safe response, email-verify-before-upload (free
    # uploads require a verified session), and this FREE_TIER_ENABLED
    # kill-switch — the route is not even mounted when the flag is off, so the
    # attack surface is physically closed, not merely guarded.
    #
    # The created user is deliberately ORG-LESS: signup MUST NOT insert an
    # OrganizationMember. Admin invites do; a stray pending membership would let
    # `_flip_pending_memberships` auto-accept it on first login and silently turn
    # a free user into an org member (defeating the pooled-tenant design).
    if get_settings().free_tier_enabled:
        signup_router = APIRouter(prefix="/auth", tags=["auth"])

        @signup_router.post(
            "/signup",
            status_code=status.HTTP_202_ACCEPTED,
            dependencies=[Depends(SIGNUP_RATE_LIMITER)],
        )
        async def signup(
            request: Request,
            payload: SignupRequest,
            user_manager: UserManager = Depends(get_user_manager),
            session: AsyncSession = Depends(get_async_session),
        ) -> None:
            # Enumeration-safe: identical 202 whether or not the email exists.
            # `get_async_session` is dependency-cached within the request, so this
            # is the same master session `user_manager.user_db` writes through.
            normalized = payload.email.strip().lower()
            existing = await session.scalar(
                select(User).where(func.lower(User.email) == normalized)
            )
            if existing is not None:
                # Already a user (free or paid, verified or not). Resending an
                # activation link is the dedicated /auth/request-verify-token
                # endpoint's job; here we stay silent so we leak no signal.
                return
            # Mirror the admin-invite `_find_or_create_user` pattern: insert with
            # an unguessable pre-hashed password (the activation flow sets the
            # real one) so we never trip `validate_password`, then send the
            # activation email via the same request_verify hook.
            user = User(
                email=payload.email,
                hashed_password=user_manager.password_helper.hash(secrets.token_hex(32)),
                is_active=True,
                is_verified=False,
                is_superuser=False,
                locale=coerce_locale(payload.locale),
                full_name=(payload.full_name or "").strip()[:255] or None,
                company=(payload.company or "").strip()[:255] or None,
            )
            session.add(user)
            await session.commit()
            # Best-effort email (send failures are swallowed in
            # on_after_request_verify); the account already persists.
            await user_manager.request_verify(user, request)

        router.include_router(signup_router)

    # --- request-verify-token shadow with rate limiting -------------------
    # FastAPI Users' get_verify_router() bundles /auth/request-verify-token AND
    # a bare /auth/verify. We deliberately do NOT mount that bundle:
    #   * /auth/verify is dropped entirely. Activation goes through /auth/activate
    #     (which sets the password atomically with the is_verified flip). A bare
    #     verify route is an onboarding-griefing vector: anyone who observes an
    #     invite token could POST it to /auth/verify to flip is_verified WITHOUT
    #     setting a password, after which the legit invitee's /auth/activate
    #     short-circuits to a no-op and they can never set their password.
    #   * /auth/request-verify-token is re-implemented here WITH a per-IP limiter
    #     (it emails an activation link, so an unthrottled route is an email-bomb
    #     vector). Behaviour is unchanged: always 202, never reveals whether the
    #     address exists (account-enumeration-safe).
    verify_request_router = APIRouter(prefix="/auth", tags=["auth"])

    @verify_request_router.post(
        "/request-verify-token",
        status_code=status.HTTP_202_ACCEPTED,
        dependencies=[Depends(VERIFY_REQUEST_RATE_LIMITER)],
    )
    async def request_verify_token(
        request: Request,
        payload: RequestVerifyTokenRequest,
        user_manager: UserManager = Depends(get_user_manager),
    ) -> None:
        try:
            user = await user_manager.get_by_email(payload.email)
            await user_manager.request_verify(user, request)
        except (
            fau_exceptions.UserNotExists,
            fau_exceptions.UserInactive,
            fau_exceptions.UserAlreadyVerified,
        ):
            # Swallow all three so the response is identical regardless of
            # account state — no enumeration signal.
            pass

    router.include_router(verify_request_router)

    # --- FastAPI Users built-in routers -----------------------------------
    # NOTE: /auth/register is intentionally NOT included. All user creation
    # goes through admin invite endpoints.
    router.include_router(
        fastapi_users.get_reset_password_router(),
        prefix="/auth",
        tags=["auth"],
        # No dependencies — rate limiting lives on the shadow forgot-password
        # route above; reset-password is gated by the single-use JWT.
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
