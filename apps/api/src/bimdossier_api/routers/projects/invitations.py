import secrets
from datetime import UTC, datetime
from uuid import UUID

from fastapi import (
    Depends,
    HTTPException,
    Request,
    status,
)
from fastapi_users.password import PasswordHelper
from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from bimdossier_api import audit
from bimdossier_api.access import (
    load_project_or_404,
    require_member_manager,
    require_project_writable,
)
from bimdossier_api.auth.fastapi_users import current_verified_user
from bimdossier_api.auth.manager import UserManager, get_user_manager
from bimdossier_api.db import get_session_maker
from bimdossier_api.email.invites import (
    send_project_added_notification,
    send_project_invite_notification,
)
from bimdossier_api.models.organization import Organization
from bimdossier_api.models.organization_member import (
    OrganizationMember,
    OrganizationMemberStatus,
)
from bimdossier_api.models.project_member import ProjectRole
from bimdossier_api.models.user import User
from bimdossier_api.routers.projects._shared import router
from bimdossier_api.schemas.project import (
    ProjectInvitationCreate,
    ProjectInvitationResponse,
)
from bimdossier_api.tenancy import get_tenant_session, require_active_organization


# ---------------------------------------------------------------------------
# Project-scoped invitations
# ---------------------------------------------------------------------------


@router.post(
    "/{project_id}/invitations",
    response_model=ProjectInvitationResponse,
    status_code=status.HTTP_201_CREATED,
)
async def invite_to_project(
    project_id: UUID,
    payload: ProjectInvitationCreate,
    request: Request,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
    user_manager: UserManager = Depends(get_user_manager),
) -> ProjectInvitationResponse:
    project = await load_project_or_404(session, project_id)
    await require_member_manager(session, project.id, user, active_org_id)
    require_project_writable(project)

    if payload.role is ProjectRole.owner:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="OWNER_ROLE_NOT_ASSIGNABLE"
        )

    sm = get_session_maker()
    async with sm() as ms:
        org = await ms.get(Organization, active_org_id)
        if org is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="ORG_NOT_FOUND")
        schema = org.schema_name

        # Find existing user (case-insensitive).
        normalized = payload.email.strip().lower()
        existing_user = (
            await ms.execute(select(User).where(func.lower(User.email) == normalized))
        ).scalar_one_or_none()

        # Check existing org membership.
        existing_member: OrganizationMember | None = None
        if existing_user is not None:
            existing_member = (
                await ms.execute(
                    select(OrganizationMember).where(
                        OrganizationMember.user_id == existing_user.id,
                        OrganizationMember.organization_id == active_org_id,
                    )
                )
            ).scalar_one_or_none()

        # Branch on scenario.
        scenario: str
        target_user: User

        if existing_user is None:
            # Scenario 1: brand-new user.
            target_user = User(
                email=payload.email,
                hashed_password=PasswordHelper().hash(secrets.token_hex(32)),
                full_name=payload.full_name,
                is_active=True,
                is_verified=False,
                is_superuser=False,
            )
            ms.add(target_user)
            await ms.flush()

            member = OrganizationMember(
                user_id=target_user.id,
                organization_id=active_org_id,
                is_org_admin=False,
                is_guest=True,
                status=OrganizationMemberStatus.pending,
                invited_by=user.id,
            )
            ms.add(member)
            await ms.flush()
            scenario = "new_user"

        elif existing_member is None or existing_member.status == OrganizationMemberStatus.removed:
            # Scenario 2: user exists but not in this org (or was removed).
            target_user = existing_user
            if existing_member is not None:
                existing_member.status = OrganizationMemberStatus.pending
                existing_member.is_org_admin = False
                existing_member.is_guest = True
                existing_member.invited_at = datetime.now(UTC)
                existing_member.invited_by = user.id
                existing_member.accepted_at = None
            else:
                member = OrganizationMember(
                    user_id=target_user.id,
                    organization_id=active_org_id,
                    is_org_admin=False,
                    is_guest=True,
                    status=OrganizationMemberStatus.pending,
                    invited_by=user.id,
                )
                ms.add(member)
                await ms.flush()
            scenario = "new_org_member"

        elif existing_member.status == OrganizationMemberStatus.active:
            # Scenario 3: already an active org member.
            target_user = existing_user
            scenario = "existing_org_member"

        elif existing_member.status == OrganizationMemberStatus.pending:
            # Scenario 4: user has an outstanding, un-accepted org invite. Don't
            # duplicate the org invite — keep the membership pending, but still
            # queue the project_members row (it takes effect once they activate)
            # and re-send the invite. Mirrors resend_invite's clock reset so the
            # expiry sweeper doesn't reap a row we're actively re-poking.
            target_user = existing_user
            existing_member.invited_at = datetime.now(UTC)
            existing_member.invited_by = user.id
            scenario = "reinvited_pending"

        else:
            # Suspended — an admin paused this membership; don't silently
            # re-grant access via a project add. Reactivate it first.
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="ORG_MEMBER_SUSPENDED",
            )

        # Insert project_members row in the tenant schema.
        await ms.execute(text(f'SET LOCAL search_path = "{schema}", public'))
        try:
            await ms.execute(
                text(
                    "INSERT INTO project_members (project_id, user_id, role) "
                    "VALUES (:pid, :uid, :role)"
                ),
                {
                    "pid": str(project.id),
                    "uid": str(target_user.id),
                    "role": payload.role.value,
                },
            )
        except IntegrityError as exc:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail="MEMBER_ALREADY_EXISTS"
            ) from exc
        await ms.execute(text("SET LOCAL search_path = public"))

        await audit.record_for_org(
            ms,
            active_org_id,
            action="project_invitation.created",
            resource_type="project_member",
            resource_id=str(project.id),
            after={
                "email": target_user.email,
                "user_id": str(target_user.id),
                "role": payload.role.value,
                "scenario": scenario,
            },
            actor_user_id=user.id,
            project_id=project.id,
            request=request,
        )
        await ms.commit()

    # In-app notification (best-effort, after commit).
    from bimdossier_api.i18n import resolve_org_locale, t
    from bimdossier_api.models.notification import NotificationEventType
    from bimdossier_api.notifications.service import emit_notification_for_org

    # Project-scoped — use the project's jurisdiction default locale.
    locale = resolve_org_locale(project.country)
    await emit_notification_for_org(
        organization_id=active_org_id,
        event_type=NotificationEventType.invitation_sent,
        title=t("notifications.project_member_invited.title", locale),
        body=t(
            "notifications.project_member_invited.body",
            locale,
            invitee_email=target_user.email,
            project_name=project.name,
        ),
        project_id=project.id,
    )

    # Send email AFTER commit so a flaky transport doesn't roll back the invite.
    if scenario == "new_user":
        await user_manager.request_verify(target_user, request)
    elif scenario == "reinvited_pending":
        # Re-send whatever the pending member is still waiting on: an unverified
        # user needs the activation link again; a verified user with a pending
        # membership gets the accept/decline notification.
        if not target_user.is_verified:
            await user_manager.request_verify(target_user, request)
        else:
            await send_project_invite_notification(
                invitee=target_user,
                organization=org,
                project_name=project.name,
                inviter_email=user.email,
            )
    elif scenario == "new_org_member":
        await send_project_invite_notification(
            invitee=target_user,
            organization=org,
            project_name=project.name,
            inviter_email=user.email,
        )
    else:
        await send_project_added_notification(
            member=target_user,
            project_name=project.name,
            inviter_email=user.email,
        )

    return ProjectInvitationResponse(
        email=target_user.email,
        role=payload.role,
        project_id=project.id,
        scenario=scenario,
        user_id=target_user.id,
    )
