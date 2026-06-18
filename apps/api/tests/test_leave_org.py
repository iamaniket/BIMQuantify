"""Tests for `POST /me/memberships/{org_id}/leave`.

Self-departure path. Same last-admin and owned-projects checks as the
admin DELETE, but it's the requester's own row that's tombstoned.
"""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from fastapi_users.password import PasswordHelper
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from bimstitch_api.models.organization import Organization, OrganizationStatus
from bimstitch_api.models.organization_member import (
    OrganizationMember,
    OrganizationMemberStatus,
)
from bimstitch_api.models.user import User
from bimstitch_api.tenancy import schema_name_for


PASSWORD = "correct-horse-battery"


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _login(client: AsyncClient, email: str) -> dict[str, str]:
    resp = await client.post(
        "/auth/jwt/login",
        data={"username": email, "password": PASSWORD},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


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


async def _add_member(
    session: AsyncSession,
    *,
    user: User,
    org: Organization,
    is_org_admin: bool = False,
) -> OrganizationMember:
    m = OrganizationMember(
        user_id=user.id,
        organization_id=org.id,
        is_org_admin=is_org_admin,
        status=OrganizationMemberStatus.active,
        accepted_at=datetime.now(timezone.utc),
    )
    session.add(m)
    user.active_organization_id = org.id
    await session.commit()
    return m


async def test_member_can_leave_org(
    client: AsyncClient, session: AsyncSession
) -> None:
    org = await _make_org(session, f"Acme-{uuid4().hex[:8]}")
    admin = await _make_user(session, f"admin-{uuid4().hex[:8]}@acme.com")
    member = await _make_user(session, f"m-{uuid4().hex[:8]}@acme.com")
    await _add_member(session, user=admin, org=org, is_org_admin=True)
    await _add_member(session, user=member, org=org, is_org_admin=False)

    tokens = await _login(client, member.email)
    resp = await client.post(
        f"/me/memberships/{org.id}/leave",
        headers=_auth(tokens["access_token"]),
    )
    assert resp.status_code == 204, resp.text

    m_q = await session.execute(
        select(OrganizationMember).where(
            OrganizationMember.user_id == member.id,
            OrganizationMember.organization_id == org.id,
        )
    )
    m = m_q.scalar_one()
    assert m.status == OrganizationMemberStatus.removed


async def test_last_admin_cannot_leave(
    client: AsyncClient, session: AsyncSession
) -> None:
    org = await _make_org(session, f"Acme-{uuid4().hex[:8]}")
    admin = await _make_user(session, f"admin-{uuid4().hex[:8]}@acme.com")
    await _add_member(session, user=admin, org=org, is_org_admin=True)

    tokens = await _login(client, admin.email)
    resp = await client.post(
        f"/me/memberships/{org.id}/leave",
        headers=_auth(tokens["access_token"]),
    )
    assert resp.status_code == 409
    assert resp.json()["detail"] == "LAST_ADMIN_REQUIRED"


async def test_leave_blocked_on_suspended_org(
    client: AsyncClient, session: AsyncSession
) -> None:
    org = await _make_org(session, f"Acme-{uuid4().hex[:8]}")
    admin = await _make_user(session, f"admin-{uuid4().hex[:8]}@acme.com")
    member = await _make_user(session, f"m-{uuid4().hex[:8]}@acme.com")
    await _add_member(session, user=admin, org=org, is_org_admin=True)
    await _add_member(session, user=member, org=org, is_org_admin=False)

    org.status = OrganizationStatus.suspended
    await session.commit()

    tokens = await _login(client, member.email)
    resp = await client.post(
        f"/me/memberships/{org.id}/leave",
        headers=_auth(tokens["access_token"]),
    )
    assert resp.status_code == 409
    assert resp.json()["detail"] == "ORG_NOT_ACTIVE"
