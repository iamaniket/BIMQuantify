import logging
import secrets
from collections.abc import AsyncGenerator
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from fastapi import Depends, Request
from fastapi_users import BaseUserManager, UUIDIDMixin
from fastapi_users import exceptions as fau_exceptions
from fastapi_users import schemas as fau_schemas
from fastapi_users.db import SQLAlchemyUserDatabase
from sqlalchemy import delete as sql_delete
from sqlalchemy import select

from bimdossier_api import audit
from bimdossier_api.auth import lockout
from bimdossier_api.cache import get_redis
from bimdossier_api.config import get_settings
from bimdossier_api.db import get_user_db
from bimdossier_api.email.transport import send_email_best_effort
from bimdossier_api.i18n import (
    PLATFORM_DEFAULT_LOCALE,
    resolve_user_locale,
    t,
    t_bilingual,
)
from bimdossier_api.models.organization_member import (
    OrganizationMember,
    OrganizationMemberStatus,
)
from bimdossier_api.models.user import User

logger = logging.getLogger(__name__)

# Minimum password length enforced by `UserManager.validate_password`. fastapi-users
# ships a no-op validator (any password — even a single char — is accepted); this is
# the SOC2 CC6.1 credential-strength control. NIST 800-63B floors at 8; we use 12.
MIN_PASSWORD_LENGTH = 12


class UserManager(UUIDIDMixin, BaseUserManager[User, UUID]):
    """User manager hooks.

    Public signup is gone — `on_after_register` is no longer wired to
    `/auth/register` (the route is removed). It is still used by the
    admin invite flow, which calls `user_manager.create(...)` directly:
    when a fresh user is created via invite, we trigger
    `request_verify()` so they receive an activation email.
    """

    reset_password_token_secret = ""
    verification_token_secret = ""

    def __init__(self, user_db: SQLAlchemyUserDatabase) -> None:
        super().__init__(user_db)
        settings = get_settings()
        self.reset_password_token_secret = settings.jwt_secret
        self.verification_token_secret = settings.jwt_secret
        # Bump verify-token lifetime for admin invites — the default 1h
        # is too short when an admin invites a colleague.
        self.verification_token_lifetime_seconds = settings.invite_token_ttl_seconds

    async def validate_password(
        self,
        password: str,
        user: "fau_schemas.UC | User",
    ) -> None:
        """Enforce the minimum password policy (SOC2 CC6.1).

        fastapi-users' base implementation is a no-op, which accepted
        single-character passwords. fastapi-users invokes this from `create`,
        `reset_password`, and `update`; the `/auth/activate` handler calls it
        explicitly too, since it sets the initial password via `_update`
        (which would otherwise bypass validation). Invite/seed flows insert a
        pre-hashed random password directly and never reach here.
        """
        if len(password) < MIN_PASSWORD_LENGTH:
            raise fau_exceptions.InvalidPasswordException(
                reason=f"Password must be at least {MIN_PASSWORD_LENGTH} characters long."
            )
        email = getattr(user, "email", None)
        if email:
            local_part = email.split("@", 1)[0].strip().lower()
            if local_part and local_part in password.lower():
                raise fau_exceptions.InvalidPasswordException(
                    reason="Password must not contain your email address."
                )

    async def on_after_register(self, user: User, request: Request | None = None) -> None:
        # Admin-invite flow: send activation email so the invited user can
        # set a password. The /auth/register HTTP route is gone, so this
        # only fires from explicit user_manager.create() calls inside
        # admin endpoints.
        await self.request_verify(user, request)

    async def on_after_request_verify(
        self, user: User, token: str, request: Request | None = None
    ) -> None:
        settings = get_settings()
        # Admin invites go to the activate URL (set-password page); the
        # legacy verify URL is kept as a fallback for the existing email
        # template when the user already had a verified account.
        activate_url = f"{settings.frontend_activate_url}?token={token}"
        # New user — `user.locale` is NULL at this point. Send a bilingual
        # body and the platform-default subject so neither EN nor NL
        # recipients are caught off guard.
        name = user.full_name or user.email
        body = t_bilingual(
            "auth.activate_email.body",
            name=name,
            url=activate_url,
            token=token,
        )
        subject = t("auth.activate_email.subject", PLATFORM_DEFAULT_LOCALE)
        # Best-effort: the user row is already committed by the time we get here
        # (fastapi-users commits before on_after_register). A dead SMTP server must
        # not 500 the invite — the admin can resend. See send_email_best_effort.
        await send_email_best_effort(
            to=user.email,
            subject=subject,
            body=body,
        )

    async def on_after_verify(self, user: User, request: Request | None = None) -> None:
        """Bootstrap auto-accept.

        A freshly-activated user with no active memberships and exactly
        one pending invite was created BECAUSE of that invite — there is
        no choice for them to make. Flip the row to `active` here so they
        don't see a misleading "sign in and accept" prompt on top of the
        password they just set. This mirrors the same narrow rule applied
        at login (see `auth.routes._flip_pending_memberships`).
        """
        # `self.user_db` wraps the same AsyncSession the verify endpoint
        # used; safe to query/mutate. fastapi-users does NOT commit here
        # (it commits on the `update` that flipped `is_verified`); we
        # commit ourselves below.
        from bimdossier_api.admin.membership_rules import invitation_is_expired

        session = self.user_db.session
        stmt = select(OrganizationMember).where(
            OrganizationMember.user_id == user.id,
        )
        rows = list((await session.execute(stmt)).scalars().all())
        if not rows:
            return
        settings = get_settings()
        has_non_pending = any(m.status != OrganizationMemberStatus.pending for m in rows)
        pending = [
            m
            for m in rows
            if m.status == OrganizationMemberStatus.pending
            and not invitation_is_expired(m.invited_at, settings.invitation_ttl_days)
        ]
        if has_non_pending or len(pending) != 1:
            return

        pending[0].status = OrganizationMemberStatus.active
        pending[0].accepted_at = datetime.now(UTC)
        await session.commit()

    async def on_after_forgot_password(
        self, user: User, token: str, request: Request | None = None
    ) -> None:
        settings = get_settings()
        reset_url = f"{settings.frontend_reset_password_url}?token={token}"
        # Existing user — use their `User.locale` (resolves to platform
        # default if unset).
        locale = resolve_user_locale(user)
        body = t(
            "auth.reset_password_email.body",
            locale,
            email=user.email,
            url=reset_url,
            token=token,
        )
        subject = t("auth.reset_password_email.subject", locale)
        # Best-effort — see send_email_best_effort. forgot-password always returns
        # 202 regardless of delivery (and regardless of whether the account exists),
        # so a transport failure must be logged, not raised.
        await send_email_best_effort(
            to=user.email,
            subject=subject,
            body=body,
        )
        # Forensic trail (H9): a reset link was requested for this account.
        # Org-less event → platform schema, same as auth.login.* . Best-effort.
        await audit.record_event_independent(
            None,
            action="auth.password.forgot",
            resource_type="user",
            resource_id=user.id,
            actor_user_id=user.id,
            request=request,
        )

    async def on_after_update(
        self,
        user: User,
        update_dict: dict[str, Any],
        request: Request | None = None,
    ) -> None:
        # A password change (authenticated /users/me edit, or an admin update)
        # rotates the credential — invalidate every existing session by stamping
        # the token epoch. Other field edits (name, avatar, locale) are left
        # alone. Note the invite/activate flow sets the initial password via
        # `_update` directly, which does NOT call this hook — correct, since no
        # tokens exist before first login.
        if "password" in update_dict:
            await self._bump_token_epoch(user)
            # Forensic trail (H9): credential rotated via an authenticated edit
            # (/users/me) or an admin update. The hook only sees the subject
            # user, not the actor, so an admin-initiated change is attributed to
            # the subject; impersonation is still captured via
            # request.state.impersonator_user_id. Best-effort, platform schema.
            await audit.record_event_independent(
                None,
                action="auth.password.changed",
                resource_type="user",
                resource_id=user.id,
                actor_user_id=user.id,
                request=request,
            )

    async def on_after_reset_password(self, user: User, request: Request | None = None) -> None:
        # Forgot-password → reset rotates the credential; kill existing sessions.
        await self._bump_token_epoch(user)
        # H6: a completed reset clears any active account lockout so a locked-out
        # legitimate user has a self-service recovery path (reset → sign in
        # immediately) without waiting out the lock or pinging a super-admin.
        # Best-effort — clear_failures swallows RedisError.
        await lockout.clear_failures(get_redis(), user.email)
        # Forensic trail (H9): credential rotated via the forgot→reset flow.
        # Org-less event → platform schema. Best-effort (the reset already
        # committed; a failed audit write must not 500 the reset).
        await audit.record_event_independent(
            None,
            action="auth.password.reset",
            resource_type="user",
            resource_id=user.id,
            actor_user_id=user.id,
            request=request,
        )

    async def _bump_token_epoch(self, user: User) -> None:
        """Stamp `tokens_valid_after = now()` so every previously-issued
        access/refresh token is rejected on next use (see
        `auth.tokens.token_predates_epoch`)."""
        await self.user_db.update(user, {"tokens_valid_after": datetime.now(UTC)})

    async def delete(self, user: User, request: Request | None = None) -> None:
        """Anonymize in place instead of hard-deleting (M-db1).

        ~12 tenant tables FK `public.users` with ON DELETE RESTRICT (finding,
        project, certificate, capture_link, …), so the fastapi-users default —
        a real `DELETE FROM users` — raises a ForeignKeyViolation → unhandled
        500 for any user who ever authored a row, and the audit/authorship
        trail would be lost even if it succeeded. Instead we scrub PII, disable
        authentication, drop org memberships, and stamp `anonymized_at`. The row
        survives so every RESTRICT FK stays valid; GDPR erasure is satisfied by
        anonymization. The superuser `DELETE /users/{id}` route is unchanged —
        it now returns 204 with the account anonymized rather than 500.
        """
        # Lazy import (mirrors on_after_verify) to avoid an auth↔admin import cycle.
        from bimdossier_api.admin.membership_rules import (
            ProposedUserChange,
            assert_last_superuser_invariant,
        )

        session = self.user_db.session

        # Never brick the platform by anonymizing its last active super-admin.
        # Only relevant when the target IS a superuser; for everyone else the
        # superuser count is unchanged, so skip the lock entirely. The canonical
        # invariant locks the surviving-superuser rows (so two concurrent deletes
        # can't both believe another admin remains) and raises 409
        # LAST_SUPERUSER_REQUIRED. `deleted=True` — the account is going away.
        if user.is_superuser:
            await assert_last_superuser_invariant(
                session,
                user.id,
                ProposedUserChange(
                    is_superuser=user.is_superuser,
                    is_active=user.is_active,
                    deleted=True,
                ),
            )

        # Revoke workspace access. `organization_members` lives in `public`, so
        # this is a single statement (the model is schema-qualified). Per-org
        # `project_members` rows are left as-is — they're in tenant schemas
        # (cross-schema fan-out) and harmless once the account can't authenticate.
        await session.execute(
            sql_delete(OrganizationMember).where(OrganizationMember.user_id == user.id)
        )

        # Free-tier data (GDPR): anonymize does NOT hard-delete the user row, so
        # the `ON DELETE CASCADE` from public.users never fires and the user's
        # pooled free models/snags + their S3 objects would leak. Delete them
        # explicitly. The DB delete cascades free_snags; the object cleanup is
        # best-effort (the idle reaper is the backstop for any leftover prefix).
        from bimdossier_api.models.free_model import FreeModel

        await session.execute(
            sql_delete(FreeModel).where(FreeModel.owner_user_id == user.id)
        )
        try:
            from bimdossier_api.storage import get_storage

            await get_storage().delete_prefix(f"free/{user.id}/")
        except Exception:
            logger.warning(
                "free-tier object cleanup failed for anonymized user %s "
                "(idle reaper will backstop)",
                user.id,
            )

        now = datetime.now(UTC)
        # `update` persists + commits via the user_db session, which also commits
        # the membership delete above (same transaction).
        await self.user_db.update(
            user,
            {
                "email": f"deleted+{user.id}@users.invalid",
                "full_name": None,
                "avatar_url": None,
                "locale": None,
                "is_active": False,
                "is_verified": False,
                "is_superuser": False,
                "active_organization_id": None,
                "hashed_password": self.password_helper.hash(secrets.token_urlsafe(32)),
                "tokens_valid_after": now,
                "anonymized_at": now,
            },
        )

        # Forensic trail: the account was anonymized. Org-less event → platform
        # schema. Best-effort, same pattern as the password-rotation events.
        await audit.record_event_independent(
            None,
            action="user.anonymized",
            resource_type="user",
            resource_id=user.id,
            actor_user_id=user.id,
            request=request,
        )


async def get_user_manager(
    user_db: SQLAlchemyUserDatabase = Depends(get_user_db),
) -> AsyncGenerator[UserManager, None]:
    yield UserManager(user_db)
