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
from bimstitch_api.models.organization import Organization
from bimstitch_api.models.user import User


async def send_invite_notification(
    *,
    invitee: User,
    organization: Organization,
    inviter_email: str | None,
) -> None:
    settings = get_settings()
    url = settings.frontend_invitations_url
    inviter_label = inviter_email or "A BIMstitch admin"
    body = (
        f"Hi {invitee.full_name or invitee.email},\n\n"
        f'{inviter_label} has invited you to join "{organization.name}" on BIMstitch.\n\n'
        f"Sign in and visit {url} to accept or decline the invitation.\n"
    )
    await get_email_transport().send(
        to=invitee.email,
        subject=f'Invitation to join "{organization.name}" on BIMstitch',
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
    url = settings.frontend_invitations_url
    inviter_label = inviter_email or "A BIMstitch team member"
    body = (
        f"Hi {invitee.full_name or invitee.email},\n\n"
        f"{inviter_label} has invited you to collaborate on the project "
        f'"{project_name}" in "{organization.name}" on BIMstitch.\n\n'
        f"Sign in and visit {url} to accept the invitation.\n"
    )
    await get_email_transport().send(
        to=invitee.email,
        subject=f'Invitation to project "{project_name}" on BIMstitch',
        body=body,
    )


async def send_project_added_notification(
    *,
    member: User,
    project_name: str,
    inviter_email: str | None,
) -> None:
    """Notify an existing org member they were added to a project."""
    inviter_label = inviter_email or "A team member"
    body = (
        f"Hi {member.full_name or member.email},\n\n"
        f"{inviter_label} has added you to the project "
        f'"{project_name}" on BIMstitch.\n\n'
        f"Sign in to start collaborating.\n"
    )
    await get_email_transport().send(
        to=member.email,
        subject=f'You\'ve been added to "{project_name}" on BIMstitch',
        body=body,
    )
