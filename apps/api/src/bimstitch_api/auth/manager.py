from collections.abc import AsyncGenerator
from datetime import UTC, datetime
from uuid import UUID

from fastapi import Depends, Request
from fastapi_users import BaseUserManager, UUIDIDMixin
from fastapi_users.db import SQLAlchemyUserDatabase
from sqlalchemy import select

from bimstitch_api.config import get_settings
from bimstitch_api.db import get_user_db
from bimstitch_api.email.transport import get_email_transport
from bimstitch_api.models.organization_member import (
    OrganizationMember,
    OrganizationMemberStatus,
)
from bimstitch_api.models.user import User


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
        body = (
            f"Hi {user.full_name or user.email},\n\n"
            f"Activate your BIMstitch account and set your password: {activate_url}\n\n"
            f"Token: {token}\n"
        )
        await get_email_transport().send(
            to=user.email,
            subject="Activate your BIMstitch account",
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
        from bimstitch_api.admin.membership_rules import invitation_is_expired

        session = self.user_db.session
        stmt = select(OrganizationMember).where(
            OrganizationMember.user_id == user.id,
            OrganizationMember.status != OrganizationMemberStatus.removed,
        )
        rows = list((await session.execute(stmt)).scalars().all())
        if not rows:
            return
        settings = get_settings()
        has_active = any(m.status == OrganizationMemberStatus.active for m in rows)
        pending = [
            m
            for m in rows
            if m.status == OrganizationMemberStatus.pending
            and not invitation_is_expired(m.invited_at, settings.invitation_ttl_days)
        ]
        if has_active or len(pending) != 1:
            return

        pending[0].status = OrganizationMemberStatus.active
        pending[0].accepted_at = datetime.now(UTC)
        await session.commit()

    async def on_after_forgot_password(
        self, user: User, token: str, request: Request | None = None
    ) -> None:
        settings = get_settings()
        reset_url = f"{settings.frontend_reset_password_url}?token={token}"
        body = (
            f"Password reset requested for {user.email}.\n\n"
            f"Reset link: {reset_url}\n\nToken: {token}\n"
        )
        await get_email_transport().send(
            to=user.email,
            subject="Reset your BIMstitch password",
            body=body,
        )


async def get_user_manager(
    user_db: SQLAlchemyUserDatabase = Depends(get_user_db),
) -> AsyncGenerator[UserManager, None]:
    yield UserManager(user_db)
