"""Alert org admins + platform super-admins when an account locks (H6).

Fired from the login handler on the exact failure that crosses the lockout
threshold (``FailureResult.just_locked``). Writes an audit trail and delivers a
targeted in-app notification + email to:
  * the active org admins of every org the locked user belongs to, and
  * every active platform super-admin.

Runs on the master login session AFTER its failure-path ``commit()`` (the
session has no open transaction at that point). Fully best-effort — any failure
is logged and swallowed so the caller still raises the lockout error to the
client.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from sqlalchemy import func, select

from bimdossier_api import audit
from bimdossier_api.email.transport import get_email_transport
from bimdossier_api.i18n import resolve_user_locale, t
from bimdossier_api.models.notification import NotificationEventType
from bimdossier_api.models.organization import Organization
from bimdossier_api.models.organization_member import (
    OrganizationMember,
    OrganizationMemberStatus,
)
from bimdossier_api.models.user import User
from bimdossier_api.notifications.service import emit_notification_for_org
from bimdossier_api.tenancy import PLATFORM_ORG_NAME

if TYPE_CHECKING:
    from uuid import UUID

    from fastapi import Request
    from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)


async def maybe_alert_on_lockout(
    session: AsyncSession,
    request: Request,
    normalized_email: str,
    fail_count: int,
) -> None:
    """Best-effort entry point — never raises into the login flow."""
    try:
        await _alert_on_lockout(session, request, normalized_email, fail_count)
    except Exception:
        logger.warning(
            "Failed to alert admins on account lockout for %s",
            normalized_email,
            exc_info=True,
        )


async def _alert_on_lockout(
    session: AsyncSession,
    request: Request,
    normalized_email: str,
    fail_count: int,
) -> None:
    # Resolve the real user. Unknown email → silent return: nothing to alert,
    # and no side effects that could leak whether the address exists.
    user = (
        await session.execute(select(User).where(func.lower(User.email) == normalized_email))
    ).scalar_one_or_none()
    if user is None:
        return

    ip = request.client.host if request.client else None
    after = {
        "email": user.email,
        "attempts": fail_count,
        "ip": ip,
        "reason": "too_many_failed_attempts",
    }

    # --- org admins: audit per org + collect (org_id, admin) targets ---------
    org_ids = list(
        (
            await session.execute(
                select(OrganizationMember.organization_id).where(
                    OrganizationMember.user_id == user.id,
                    OrganizationMember.status == OrganizationMemberStatus.active,
                )
            )
        )
        .scalars()
        .all()
    )

    org_admin_targets: list[tuple[UUID, User]] = []
    for org_id in org_ids:
        await audit.record_for_org(
            session,
            org_id,
            action="auth.account_locked",
            resource_type="user",
            resource_id=user.id,
            after=after,
            actor_user_id=user.id,
            request=request,
        )
        admins = (
            (
                await session.execute(
                    select(User)
                    .join(OrganizationMember, OrganizationMember.user_id == User.id)
                    .where(
                        OrganizationMember.organization_id == org_id,
                        OrganizationMember.status == OrganizationMemberStatus.active,
                        OrganizationMember.is_org_admin.is_(True),
                    )
                )
            )
            .scalars()
            .all()
        )
        for admin in admins:
            org_admin_targets.append((org_id, admin))

    # --- platform super-admins ----------------------------------------------
    super_admins = list(
        (
            await session.execute(
                select(User).where(User.is_superuser.is_(True), User.is_active.is_(True))
            )
        )
        .scalars()
        .all()
    )
    platform_org_id = (
        await session.execute(select(Organization.id).where(Organization.name == PLATFORM_ORG_NAME))
    ).scalar_one_or_none()

    # Always record into the platform schema too — super-admins read their audit
    # trail there, and it captures locks for users with no org.
    await audit.record_for_org(
        session,
        None,
        action="auth.account_locked",
        resource_type="user",
        resource_id=user.id,
        after=after,
        actor_user_id=user.id,
        request=request,
    )

    await session.commit()

    # --- post-commit delivery (best-effort) ---------------------------------
    seen_emails: set[str] = set()

    async def _send_email(recipient: User) -> None:
        # De-dupe by address: one person who admins several of the locked user's
        # orgs (or is both an org admin and a super-admin) gets a single email.
        if recipient.email in seen_emails:
            return
        seen_emails.add(recipient.email)
        locale = resolve_user_locale(recipient)
        try:
            await get_email_transport().send(
                to=recipient.email,
                subject=t("notifications.account_locked_email.subject", locale),
                body=t(
                    "notifications.account_locked_email.body",
                    locale,
                    admin_name=recipient.full_name or recipient.email,
                    email=user.email,
                    attempts=fail_count,
                ),
            )
        except Exception:
            logger.warning(
                "Failed to send lockout alert email to %s", recipient.email, exc_info=True
            )

    for org_id, admin in org_admin_targets:
        locale = resolve_user_locale(admin)
        await emit_notification_for_org(
            organization_id=org_id,
            event_type=NotificationEventType.account_locked,
            title=t("notifications.account_locked.title", locale),
            body=t(
                "notifications.account_locked.body",
                locale,
                email=user.email,
                attempts=fail_count,
            ),
            recipient_user_id=admin.id,
        )
        await _send_email(admin)

    for super_admin in super_admins:
        if platform_org_id is not None:
            locale = resolve_user_locale(super_admin)
            await emit_notification_for_org(
                organization_id=platform_org_id,
                event_type=NotificationEventType.account_locked,
                title=t("notifications.account_locked.title", locale),
                body=t(
                    "notifications.account_locked.body",
                    locale,
                    email=user.email,
                    attempts=fail_count,
                ),
                recipient_user_id=super_admin.id,
            )
        await _send_email(super_admin)
