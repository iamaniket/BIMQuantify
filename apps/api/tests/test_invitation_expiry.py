"""Tests for the pending-invitation expiry sweeper.

Pending OrganizationMember rows count toward the org's seat_limit. If
they never expire, an admin who invites and walks away locks seats
forever. The sweeper flips any pending row older than
INVITATION_TTL_DAYS to `removed` and writes an audit entry.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import uuid4

from fastapi_users.password import PasswordHelper
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from bimdossier_api.admin.invitation_expiry import sweep_expired_invitations
from bimdossier_api.models.organization import Organization, OrganizationStatus
from bimdossier_api.models.organization_member import (
    OrganizationMember,
    OrganizationMemberStatus,
)
from bimdossier_api.models.user import User
from bimdossier_api.tenancy import schema_name_for
from tests.conftest import _audit_rows

PASSWORD = "correct-horse-battery"


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _make_user(session: AsyncSession, email: str) -> User:
    user = User(
        email=email,
        hashed_password=PasswordHelper().hash(PASSWORD),
        full_name=email.split("@")[0],
        is_active=True,
        is_verified=True,
        is_superuser=False,
    )
    session.add(user)
    await session.commit()
    return user


async def _make_org(session: AsyncSession, name: str) -> Organization:
    org_id = uuid4()
    org = Organization(
        id=org_id,
        name=name,
        schema_name=schema_name_for(org_id),
        status=OrganizationStatus.active,
        provisioned_at=datetime.now(timezone.utc),
    )
    session.add(org)
    await session.commit()
    return org


async def _get_member_status(
    session: AsyncSession, member_id
) -> OrganizationMemberStatus:
    row = await session.execute(
        select(OrganizationMember.status).where(OrganizationMember.id == member_id)
    )
    return row.scalar_one()


async def test_sweep_expires_old_pending_rows(
    session: AsyncSession,
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    org = await _make_org(session, f"Acme-{uuid4().hex[:8]}")
    invitee = await _make_user(session, f"stale-{uuid4().hex[:8]}@acme.com")
    old_invited_at = datetime.now(timezone.utc) - timedelta(days=20)
    member = OrganizationMember(
        user_id=invitee.id,
        organization_id=org.id,
        is_org_admin=False,
        status=OrganizationMemberStatus.pending,
        invited_at=old_invited_at,
    )
    session.add(member)
    await session.commit()
    member_id = member.id

    count = await sweep_expired_invitations(session, ttl_days=14)
    await session.commit()
    assert count == 1

    assert await _get_member_status(session, member_id) == OrganizationMemberStatus.removed

    entries = await _audit_rows(
        session_maker,
        "organization_member.invitation_expired",
        resource_id=member_id,
    )
    assert len(entries) == 1


async def test_sweep_leaves_fresh_pending_rows(session: AsyncSession) -> None:
    org = await _make_org(session, f"Acme-{uuid4().hex[:8]}")
    invitee = await _make_user(session, f"fresh-{uuid4().hex[:8]}@acme.com")
    member = OrganizationMember(
        user_id=invitee.id,
        organization_id=org.id,
        is_org_admin=False,
        status=OrganizationMemberStatus.pending,
        invited_at=datetime.now(timezone.utc) - timedelta(days=2),
    )
    session.add(member)
    await session.commit()
    member_id = member.id

    count = await sweep_expired_invitations(session, ttl_days=14)
    await session.commit()
    assert count == 0

    assert await _get_member_status(session, member_id) == OrganizationMemberStatus.pending


async def test_accept_expired_invite_rejected(
    client: AsyncClient, session: AsyncSession
) -> None:
    """The accept endpoint also blocks expired invites — needed for the
    window between TTL elapse and the next sweep tick.
    """
    org = await _make_org(session, f"Acme-{uuid4().hex[:8]}")
    invitee = await _make_user(session, f"invitee-{uuid4().hex[:8]}@acme.com")
    member = OrganizationMember(
        user_id=invitee.id,
        organization_id=org.id,
        is_org_admin=False,
        status=OrganizationMemberStatus.pending,
        invited_at=datetime.now(timezone.utc) - timedelta(days=30),
    )
    session.add(member)
    await session.commit()

    resp = await client.post(
        "/auth/jwt/login",
        data={"username": invitee.email, "password": PASSWORD},
    )
    assert resp.status_code == 200, resp.text
    tokens = resp.json()
    resp = await client.post(
        f"/me/invitations/{org.id}/accept",
        headers=_auth(tokens["access_token"]),
    )
    assert resp.status_code == 409
    assert resp.json()["detail"] == "INVITATION_EXPIRED"
