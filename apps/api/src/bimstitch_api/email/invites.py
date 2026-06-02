"""Email composer for the invite-notification flow.

Distinct from the activation email (in `auth/manager.py`):

- Activation email goes to brand-new users whose `is_verified=False`. It
  carries a token they use to set their password, after which they land
  logged in.
- Invite-notification email goes to existing verified users when an org
  admin or super-admin adds them to a NEW org. There is no token — the
  recipient already has an account; they sign in and explicitly accept
  the invite via the `/me/invitations` endpoints.
"""

from __future__ import annotations

from bimstitch_api.config import get_settings
from bimstitch_api.email.transport import get_email_transport
from bimstitch_api.i18n import resolve_user_locale, t
from bimstitch_api.models.organization import Organization
from bimstitch_api.models.user import User


async def send_invite_notification(
    *,
    invitee: User,
    organization: Organization,
    inviter_email: str | None,
) -> None:
    settings = get_settings()
    locale = resolve_user_locale(invitee)
    inviter_label = inviter_email or t("invites.fallback_inviter.org", locale)
    name = invitee.full_name or invitee.email
    subject = t("invites.org_invite.subject", locale, org_name=organization.name)
    body = t(
        "invites.org_invite.body",
        locale,
        name=name,
        inviter_label=inviter_label,
        org_name=organization.name,
        url=settings.frontend_invitations_url,
    )
    await get_email_transport().send(
        to=invitee.email,
        subject=subject,
        body=body,
    )


async def send_project_invite_notification(
    *,
    invitee: User,
    organization: Organization,
    project_name: str,
    inviter_email: str | None,
) -> None:
    """Invite notification mentioning the specific project.

    Used by project-scoped invitations where the user is joining
    an org as a guest to collaborate on a named project.
    """
    settings = get_settings()
    locale = resolve_user_locale(invitee)
    inviter_label = inviter_email or t("invites.fallback_inviter.project", locale)
    name = invitee.full_name or invitee.email
    subject = t("invites.project_invite.subject", locale, project_name=project_name)
    body = t(
        "invites.project_invite.body",
        locale,
        name=name,
        inviter_label=inviter_label,
        project_name=project_name,
        org_name=organization.name,
        url=settings.frontend_invitations_url,
    )
    await get_email_transport().send(
        to=invitee.email,
        subject=subject,
        body=body,
    )


async def send_project_added_notification(
    *,
    member: User,
    project_name: str,
    inviter_email: str | None,
) -> None:
    """Notify an existing org member they were added to a project."""
    locale = resolve_user_locale(member)
    inviter_label = inviter_email or t("invites.fallback_inviter.team", locale)
    name = member.full_name or member.email
    subject = t("invites.project_added.subject", locale, project_name=project_name)
    body = t(
        "invites.project_added.body",
        locale,
        name=name,
        inviter_label=inviter_label,
        project_name=project_name,
    )
    await get_email_transport().send(
        to=member.email,
        subject=subject,
        body=body,
    )
