"""Org-admin organization settings endpoint tests.

Covers PATCH /organizations/{id} gated by ``require_org_admin``:
rename happy path, non-admin 403, duplicate name 409, validation 422.
"""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

from fastapi_users.password import PasswordHelper
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from bimstitch_api.models.organization import Organization, OrganizationStatus
from bimstitch_api.models.organization_member import (
    OrganizationMember,
    OrganizationMemberStatus,
)
from bimstitch_api.models.user import User
from bimstitch_api.tenancy import schema_name_for
from tests.conftest import _audit_rows

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


async def _make_user(
    session: AsyncSession,
    email: str,
    *,
    is_superuser: bool = False,
) -> User:
    user = User(
        email=email,
        hashed_password=PasswordHelper().hash(PASSWORD),
        full_name=email.split("@")[0],
        is_active=True,
        is_verified=True,
        is_superuser=is_superuser,
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user


async def _make_org(session: AsyncSession, name: str) -> Organization:
    org_id = uuid4()
    org = Organization(
        id=org_id,
        name=name,
        schema_name=schema_name_for(org_id),
        status=OrganizationStatus.active,
        provisioned_at=datetime.now(UTC),
    )
    session.add(org)
    await session.commit()
    await session.refresh(org)
    return org


async def _add_member(
    session: AsyncSession,
    *,
    user: User,
    org: Organization,
    is_org_admin: bool = False,
) -> OrganizationMember:
    member = OrganizationMember(
        user_id=user.id,
        organization_id=org.id,
        is_org_admin=is_org_admin,
        status=OrganizationMemberStatus.active,
        accepted_at=datetime.now(UTC),
    )
    session.add(member)
    user.active_organization_id = org.id
    await session.commit()
    return member


# ---------------------------------------------------------------------------
# Happy path
# ---------------------------------------------------------------------------


async def test_org_admin_can_rename_organization(
    client: AsyncClient,
    session: AsyncSession,
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    org = await _make_org(session, "OldName Inc")
    admin = await _make_user(session, "org-admin@example.com")
    await _add_member(session, user=admin, org=org, is_org_admin=True)

    tokens = await _login(client, admin.email)
    resp = await client.patch(
        f"/organizations/{org.id}",
        json={"name": "NewName Inc"},
        headers=_auth(tokens["access_token"]),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["name"] == "NewName Inc"
    assert body["id"] == str(org.id)

    rows = await _audit_rows(session_maker, "organization.updated")
    assert len(rows) >= 1
    latest = rows[0]
    assert latest.before == {"name": "OldName Inc"}
    assert latest.after == {"name": "NewName Inc"}


async def test_noop_rename_returns_current_name(
    client: AsyncClient,
    session: AsyncSession,
) -> None:
    org = await _make_org(session, "SameName")
    admin = await _make_user(session, "noop-admin@example.com")
    await _add_member(session, user=admin, org=org, is_org_admin=True)

    tokens = await _login(client, admin.email)
    resp = await client.patch(
        f"/organizations/{org.id}",
        json={"name": "SameName"},
        headers=_auth(tokens["access_token"]),
    )
    assert resp.status_code == 200
    assert resp.json()["name"] == "SameName"


# ---------------------------------------------------------------------------
# Authorization
# ---------------------------------------------------------------------------


async def test_non_admin_member_cannot_rename(
    client: AsyncClient,
    session: AsyncSession,
) -> None:
    org = await _make_org(session, "GuardedOrg")
    member = await _make_user(session, "regular@example.com")
    await _add_member(session, user=member, org=org, is_org_admin=False)

    tokens = await _login(client, member.email)
    resp = await client.patch(
        f"/organizations/{org.id}",
        json={"name": "Hacked"},
        headers=_auth(tokens["access_token"]),
    )
    assert resp.status_code == 403


async def test_unauthenticated_gets_401(client: AsyncClient) -> None:
    fake_id = uuid4()
    resp = await client.patch(
        f"/organizations/{fake_id}",
        json={"name": "Nope"},
    )
    assert resp.status_code == 401


async def test_superuser_can_also_use_org_endpoint(
    client: AsyncClient,
    session: AsyncSession,
) -> None:
    org = await _make_org(session, "SuperTarget")
    su = await _make_user(session, "super@example.com", is_superuser=True)

    tokens = await _login(client, su.email)
    resp = await client.patch(
        f"/organizations/{org.id}",
        json={"name": "SuperRenamed"},
        headers=_auth(tokens["access_token"]),
    )
    assert resp.status_code == 200
    assert resp.json()["name"] == "SuperRenamed"


# ---------------------------------------------------------------------------
# Validation and conflicts
# ---------------------------------------------------------------------------


async def test_empty_name_rejected(
    client: AsyncClient,
    session: AsyncSession,
) -> None:
    org = await _make_org(session, "ValidOrg")
    admin = await _make_user(session, "empty-admin@example.com")
    await _add_member(session, user=admin, org=org, is_org_admin=True)

    tokens = await _login(client, admin.email)
    resp = await client.patch(
        f"/organizations/{org.id}",
        json={"name": ""},
        headers=_auth(tokens["access_token"]),
    )
    assert resp.status_code == 422


async def test_duplicate_name_returns_409(
    client: AsyncClient,
    session: AsyncSession,
) -> None:
    await _make_org(session, "TakenName")
    org = await _make_org(session, "OriginalName")
    admin = await _make_user(session, "dup-admin@example.com")
    await _add_member(session, user=admin, org=org, is_org_admin=True)

    tokens = await _login(client, admin.email)
    resp = await client.patch(
        f"/organizations/{org.id}",
        json={"name": "TakenName"},
        headers=_auth(tokens["access_token"]),
    )
    assert resp.status_code == 409
    assert resp.json()["detail"] == "ORG_NAME_TAKEN"
