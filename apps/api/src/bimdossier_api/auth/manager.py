from collections.abc import AsyncGenerator
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from fastapi import Depends, Request
from fastapi_users import BaseUserManager, UUIDIDMixin
from fastapi_users.db import SQLAlchemyUserDatabase
from sqlalchemy import select

from bimdossier_api.config import get_settings
from bimdossier_api.db import get_user_db
from bimdossier_api.email.transport import get_email_transport
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
        await get_email_transport().send(
            to=user.email,
            subject=subject,
            body=body,
        )

    async def on_after_verify(
        self, user: User, request: Request | None = None
    ) -> None:
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
        await get_email_transport().send(
            to=user.email,
            subject=subject,
            body=body,
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

    async def on_after_reset_password(self, user: User, request: Request | None = None) -> None:
        # Forgot-password → reset rotates the credential; kill existing sessions.
        await self._bump_token_epoch(user)

    async def _bump_token_epoch(self, user: User) -> None:
        """Stamp `tokens_valid_after = now()` so every previously-issued
        access/refresh token is rejected on next use (see
        `auth.tokens.token_predates_epoch`)."""
        await self.user_db.update(user, {"tokens_valid_after": datetime.now(UTC)})


async def get_user_manager(
    user_db: SQLAlchemyUserDatabase = Depends(get_user_db),
) -> AsyncGenerator[UserManager, None]:
    yield UserManager(user_db)
