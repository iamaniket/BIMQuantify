"""Notification-producer smoke tests for the invitation flow.

Verifies that ``invitation_sent`` and ``invitation_accepted`` notification
rows are created in the tenant schema when invite/accept endpoints run.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import TYPE_CHECKING
from uuid import uuid4

import pytest
from sqlalchemy import select, text

from bimdossier_api.models.notification import Notification, NotificationEventType
from bimdossier_api.models.organization import Organization, OrganizationStatus
from bimdossier_api.models.organization_member import (
    OrganizationMember,
    OrganizationMemberStatus,
)
from bimdossier_api.tenancy import schema_name_for

if TYPE_CHECKING:

    from httpx import AsyncClient
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _tenant_notifications(
    session_maker: async_sessionmaker[AsyncSession],
    organization_id: str,
    event_type: NotificationEventType,
) -> list[Notification]:
    """Query notification rows from the org's tenant schema.

    Uses the raw session_maker (bim superuser) with an explicit
    ``SET search_path`` so the ORM maps to the correct schema.
    """
    from uuid import UUID as _UUID

    schema = schema_name_for(_UUID(organization_id))
    async with session_maker() as s:
        await s.execute(text(f'SET search_path TO "{schema}", public'))
        rows = (
            await s.execute(
                select(Notification).where(
                    Notification.event_type == event_type,
                )
            )
        ).scalars().all()
    return list(rows)


# ---------------------------------------------------------------------------
# Org-level invite → invitation_sent notification
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_org_invite_creates_invitation_sent_notification(
    client: AsyncClient,
    session_maker: async_sessionmaker[AsyncSession],
    org_user: dict[str, str],
    email_transport: object,
) -> None:
    """POST /organizations/{org_id}/members emits an invitation_sent notification."""
    org_id = org_user["organization_id"]
    resp = await client.post(
        f"/organizations/{org_id}/members",
        json={
            "email": "notify-test@external.com",
            "is_org_admin": False,
        },
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 201, resp.text

    rows = await _tenant_notifications(
        session_maker, org_id, NotificationEventType.invitation_sent
    )
    assert len(rows) == 1
    assert "notify-test@external.com" in rows[0].body


# ---------------------------------------------------------------------------
# Project-level invite → invitation_sent notification with project_id
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_project_invite_creates_invitation_sent_notification(
    client: AsyncClient,
    session_maker: async_sessionmaker[AsyncSession],
    org_user: dict[str, str],
    email_transport: object,
) -> None:
    """POST /projects/{pid}/invitations emits an invitation_sent notification
    that carries the project_id."""
    # Create a project first
    proj_resp = await client.post(
        "/projects",
        json={"name": "NotifTestProject"},
        headers=_auth(org_user["access_token"]),
    )
    assert proj_resp.status_code == 201
    project_id = proj_resp.json()["id"]

    resp = await client.post(
        f"/projects/{project_id}/invitations",
        json={"email": "proj-notif@external.com", "role": "editor"},
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 201, resp.text

    org_id = org_user["organization_id"]
    rows = await _tenant_notifications(
        session_maker, org_id, NotificationEventType.invitation_sent
    )
    # May have more than one if org-level tests ran first, so filter by project
    proj_rows = [r for r in rows if r.project_id is not None and str(r.project_id) == project_id]
    assert len(proj_rows) == 1
    assert "NotifTestProject" in proj_rows[0].body


# ---------------------------------------------------------------------------
# Accept invitation → invitation_accepted notification
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_accept_creates_invitation_accepted_notification(
    client: AsyncClient,
    session_maker: async_sessionmaker[AsyncSession],
    org_user: dict[str, str],
    email_transport: object,
) -> None:
    """POST /me/invitations/{org_id}/accept emits an invitation_accepted notification."""
    from fastapi_users.password import PasswordHelper
    from sqlalchemy import func

    from bimdossier_api.models.user import User

    org_id = org_user["organization_id"]
    password = "test-password-123"

    # Invite a new user to the org
    resp = await client.post(
        f"/organizations/{org_id}/members",
        json={
            "email": "accepter@external.com",
            "is_org_admin": False,
        },
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 201, resp.text

    # The invitee was created by the invite flow. Verify + set a known password.
    async with session_maker() as s:
        invitee = (
            await s.execute(
                select(User).where(func.lower(User.email) == "accepter@external.com")
            )
        ).scalar_one()
        invitee.is_verified = True
        invitee.hashed_password = PasswordHelper().hash(password)
        invitee_id = invitee.id
        await s.commit()

    # Give the invitee an active "home" org so the login bootstrap won't
    # auto-accept the pending invite (auto-accept only fires when the user
    # has zero active memberships and exactly one pending row).
    async with session_maker() as s:
        home_org_id = uuid4()
        home_org = Organization(
            id=home_org_id,
            name="InviteeHomeCo",
            schema_name=schema_name_for(home_org_id),
            status=OrganizationStatus.active,
            provisioned_at=datetime.now(timezone.utc),
        )
        s.add(home_org)
        await s.flush()
        home_member = OrganizationMember(
            user_id=invitee_id,
            organization_id=home_org_id,
            is_org_admin=False,
            status=OrganizationMemberStatus.active,
            accepted_at=datetime.now(timezone.utc),
        )
        s.add(home_member)
        await s.commit()

    login_resp = await client.post(
        "/auth/jwt/login",
        data={"username": "accepter@external.com", "password": password},
    )
    assert login_resp.status_code == 200, login_resp.text
    invitee_token = login_resp.json()["access_token"]

    # Accept the invitation
    accept_resp = await client.post(
        f"/me/invitations/{org_id}/accept",
        headers=_auth(invitee_token),
    )
    assert accept_resp.status_code == 200, accept_resp.text

    rows = await _tenant_notifications(
        session_maker, org_id, NotificationEventType.invitation_accepted
    )
    assert len(rows) == 1
    assert "accepter" in rows[0].body.lower()
