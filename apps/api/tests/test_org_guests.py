"""Cross-org guest membership flow.

Exercises the `is_guest` flag end-to-end: invite -> seat-skip -> accept ->
project visibility -> promotion seat-cap check -> demotion last-admin guard.

Tests bypass the provisioning saga by directly inserting orgs/members
the same way `test_invitations.py` does — the test DB hosts every table
in `public`, so no per-tenant schema is needed for membership-only
checks. Project visibility tests use the `_provision_user_in_org`
fixture path which DOES create a real per-tenant schema, so the host
org's project list resolves correctly.
"""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

from fastapi_users.password import PasswordHelper
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

from bimstitch_api.models.audit_log import AuditLog
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


async def _make_user(
    session: AsyncSession,
    email: str,
    *,
    is_superuser: bool = False,
    is_verified: bool = True,
) -> User:
    user = User(
        email=email,
        hashed_password=PasswordHelper().hash(PASSWORD),
        full_name=email.split("@")[0],
        is_active=True,
        is_verified=is_verified,
        is_superuser=is_superuser,
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user


async def _make_org(
    session: AsyncSession,
    name: str,
    *,
    seat_limit: int | None = None,
) -> Organization:
    org_id = uuid4()
    org = Organization(
        id=org_id,
        name=name,
        schema_name=schema_name_for(org_id),
        status=OrganizationStatus.active,
        provisioned_at=datetime.now(UTC),
        seat_limit=seat_limit,
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
    is_guest: bool = False,
    status: OrganizationMemberStatus = OrganizationMemberStatus.active,
) -> OrganizationMember:
    member = OrganizationMember(
        user_id=user.id,
        organization_id=org.id,
        is_org_admin=is_org_admin,
        is_guest=is_guest,
        status=status,
        accepted_at=(
            datetime.now(UTC)
            if status == OrganizationMemberStatus.active
            else None
        ),
    )
    session.add(member)
    if status == OrganizationMemberStatus.active:
        user.active_organization_id = org.id
    await session.commit()
    return member


# ---------------------------------------------------------------------------
# Validation: guest invite requires non-empty projects + cannot be org admin
# ---------------------------------------------------------------------------


async def test_guest_invite_without_projects_is_rejected(
    client: AsyncClient,
    session: AsyncSession,
) -> None:
    org = await _make_org(session, "HostCo")
    admin = await _make_user(session, "host-admin@example.com")
    await _add_member(session, user=admin, org=org, is_org_admin=True)

    tokens = await _login(client, admin.email)
    resp = await client.post(
        f"/organizations/{org.id}/members",
        json={"email": "guest@external.com", "is_guest": True, "projects": []},
        headers=_auth(tokens["access_token"]),
    )
    # Pydantic model validator raises ValueError("GUEST_REQUIRES_PROJECTS")
    # which FastAPI surfaces as 422.
    assert resp.status_code == 422, resp.text


async def test_guest_invite_with_org_admin_flag_is_rejected(
    client: AsyncClient,
    session: AsyncSession,
) -> None:
    org = await _make_org(session, "HostCo")
    admin = await _make_user(session, "host-admin@example.com")
    await _add_member(session, user=admin, org=org, is_org_admin=True)

    tokens = await _login(client, admin.email)
    resp = await client.post(
        f"/organizations/{org.id}/members",
        json={
            "email": "guest@external.com",
            "is_guest": True,
            "is_org_admin": True,
            "projects": [{"project_id": str(uuid4()), "role": "viewer"}],
        },
        headers=_auth(tokens["access_token"]),
    )
    assert resp.status_code == 422, resp.text


# ---------------------------------------------------------------------------
# Seat cap: guests don't consume seats
# ---------------------------------------------------------------------------


async def test_seat_cap_exhausted_but_guest_invite_succeeds(
    client: AsyncClient,
    session: AsyncSession,
    org_user: dict[str, str],
) -> None:
    """An org at its seat cap can still accept a guest — guests bill against
    their home org, not the host. Uses the real-schema `org_user` fixture so
    the project assignment via the invite path lands cleanly in the tenant
    schema.
    """
    # Cap the org at exactly one seat — `org_user` is already in it.
    org_id = org_user["organization_id"]
    async with session.begin():
        org = await session.get(Organization, org_id)
        assert org is not None
        org.seat_limit = 1

    # Create a project in the host org so the invite has something to attach
    # the guest to (guests require non-empty projects).
    project_resp = await client.post(
        "/projects",
        json={"name": "HostProject"},
        headers=_auth(org_user["access_token"]),
    )
    assert project_resp.status_code == 201, project_resp.text
    project_id = project_resp.json()["id"]

    # Regular invite at the cap → SEAT_LIMIT_EXCEEDED.
    blocked = await client.post(
        f"/organizations/{org_id}/members",
        json={"email": "regular@external.com"},
        headers=_auth(org_user["access_token"]),
    )
    assert blocked.status_code == 409
    assert blocked.json()["detail"] == "SEAT_LIMIT_EXCEEDED"

    # Guest invite at the cap → succeeds.
    guest = await client.post(
        f"/organizations/{org_id}/members",
        json={
            "email": "guest@external.com",
            "is_guest": True,
            "projects": [{"project_id": project_id, "role": "viewer"}],
        },
        headers=_auth(org_user["access_token"]),
    )
    assert guest.status_code == 201, guest.text
    assert guest.json()["is_guest"] is True
    assert guest.json()["status"] == "pending"


# ---------------------------------------------------------------------------
# Owner role refused at invite time (extra: guest-specific code path)
# ---------------------------------------------------------------------------


async def test_guest_invite_with_owner_role_is_rejected(
    client: AsyncClient,
    org_user: dict[str, str],
) -> None:
    project_resp = await client.post(
        "/projects",
        json={"name": "OwnedProject"},
        headers=_auth(org_user["access_token"]),
    )
    assert project_resp.status_code == 201
    project_id = project_resp.json()["id"]

    resp = await client.post(
        f"/organizations/{org_user['organization_id']}/members",
        json={
            "email": "guest@external.com",
            "is_guest": True,
            "projects": [{"project_id": project_id, "role": "owner"}],
        },
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 400
    assert resp.json()["detail"] == "GUEST_CANNOT_BE_OWNER"


# ---------------------------------------------------------------------------
# Guest promotion / demotion via PATCH .../guest
# ---------------------------------------------------------------------------


async def test_promote_guest_to_regular_consumes_seat(
    client: AsyncClient,
    session: AsyncSession,
    org_user: dict[str, str],
) -> None:
    """A guest moving to regular member must respect the seat cap. If the
    host is already at cap (excluding guests) the promotion 409s.
    """
    org_id = org_user["organization_id"]
    # Project + guest invite first.
    project = await client.post(
        "/projects", json={"name": "P"}, headers=_auth(org_user["access_token"])
    )
    project_id = project.json()["id"]
    invite = await client.post(
        f"/organizations/{org_id}/members",
        json={
            "email": "guest@external.com",
            "is_guest": True,
            "projects": [{"project_id": project_id, "role": "viewer"}],
        },
        headers=_auth(org_user["access_token"]),
    )
    guest_id = invite.json()["user_id"]

    # Cap the org at 1 — `org_user` is the only seat-occupying regular member.
    async with session.begin():
        org = await session.get(Organization, org_id)
        assert org is not None
        org.seat_limit = 1

    # Promotion should hit SEAT_LIMIT_EXCEEDED.
    resp = await client.patch(
        f"/organizations/{org_id}/members/{guest_id}/guest",
        json={"is_guest": False},
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 409, resp.text
    assert resp.json()["detail"] == "SEAT_LIMIT_EXCEEDED"

    # Loosen the cap and retry — succeeds.
    async with session.begin():
        org = await session.get(Organization, org_id)
        assert org is not None
        org.seat_limit = 5

    ok = await client.patch(
        f"/organizations/{org_id}/members/{guest_id}/guest",
        json={"is_guest": False},
        headers=_auth(org_user["access_token"]),
    )
    assert ok.status_code == 200, ok.text
    assert ok.json()["is_guest"] is False


async def test_demote_org_admin_to_guest_is_rejected(
    client: AsyncClient,
    session: AsyncSession,
) -> None:
    """Going admin -> guest in one step would skip the last-admin invariant.
    Force a separate admin demotion first.
    """
    org = await _make_org(session, "HostCo")
    admin = await _make_user(session, "host-admin@example.com")
    other_admin = await _make_user(session, "co-admin@example.com")
    await _add_member(session, user=admin, org=org, is_org_admin=True)
    await _add_member(session, user=other_admin, org=org, is_org_admin=True)

    tokens = await _login(client, admin.email)
    resp = await client.patch(
        f"/organizations/{org.id}/members/{other_admin.id}/guest",
        json={"is_guest": True},
        headers=_auth(tokens["access_token"]),
    )
    assert resp.status_code == 409, resp.text
    assert resp.json()["detail"] == "DEMOTE_ADMIN_BEFORE_GUEST"


async def test_demote_regular_to_guest_succeeds(
    client: AsyncClient,
    session: AsyncSession,
) -> None:
    org = await _make_org(session, "HostCo")
    admin = await _make_user(session, "host-admin@example.com")
    regular = await _make_user(session, "regular@example.com")
    await _add_member(session, user=admin, org=org, is_org_admin=True)
    await _add_member(session, user=regular, org=org)

    tokens = await _login(client, admin.email)
    resp = await client.patch(
        f"/organizations/{org.id}/members/{regular.id}/guest",
        json={"is_guest": True},
        headers=_auth(tokens["access_token"]),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["is_guest"] is True

    # And the audit row.
    rows = (
        await session.execute(
            select(AuditLog).where(AuditLog.action == "organization_member.guest_changed")
        )
    ).scalars().all()
    assert len(rows) == 1
    assert rows[0].before == {"is_guest": False}
    assert rows[0].after == {"is_guest": True}


# ---------------------------------------------------------------------------
# Project create / list — guest restrictions
# ---------------------------------------------------------------------------


async def test_guest_cannot_create_project(
    client: AsyncClient,
    session: AsyncSession,
    session_maker: async_sessionmaker[AsyncSession],
    engine: AsyncEngine,
    org_user: dict[str, str],
) -> None:
    """Direct-DB shortcut: flip `org_user` to a guest, then attempt to
    create a project. Mirrors the rejection the server enforces after a
    real cross-org accept flow.
    """
    org_id = org_user["organization_id"]
    user_id = org_user["id"]
    async with session.begin():
        result = await session.execute(
            select(OrganizationMember).where(
                OrganizationMember.user_id == user_id,
                OrganizationMember.organization_id == org_id,
            )
        )
        member = result.scalar_one()
        member.is_guest = True
        member.is_org_admin = False

    resp = await client.post(
        "/projects",
        json={"name": "G"},
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 403, resp.text
    assert resp.json()["detail"] == "GUEST_CANNOT_CREATE_PROJECT"


async def test_guest_sees_only_assigned_projects(
    client: AsyncClient,
    session: AsyncSession,
    org_user: dict[str, str],
) -> None:
    """The host has two projects; the guest is granted access to one. The
    project list endpoint already filters by ProjectMember row for
    non-supers, so the test asserts that filter holds for guests too.
    """
    org_id = org_user["organization_id"]
    visible = await client.post(
        "/projects", json={"name": "Visible"}, headers=_auth(org_user["access_token"])
    )
    invisible = await client.post(
        "/projects", json={"name": "Invisible"}, headers=_auth(org_user["access_token"])
    )
    visible_id = visible.json()["id"]
    invisible_id = invisible.json()["id"]
    assert invisible_id  # silence pyflakes

    # Invite a guest with access to `visible` only.
    invite = await client.post(
        f"/organizations/{org_id}/members",
        json={
            "email": "guest@external.com",
            "is_guest": True,
            "projects": [{"project_id": visible_id, "role": "viewer"}],
        },
        headers=_auth(org_user["access_token"]),
    )
    assert invite.status_code == 201, invite.text
    guest_id = invite.json()["user_id"]

    # Flip the guest's membership to active + verified, then log them in.
    async with session.begin():
        member = (
            await session.execute(
                select(OrganizationMember).where(
                    OrganizationMember.user_id == guest_id,
                    OrganizationMember.organization_id == org_id,
                )
            )
        ).scalar_one()
        member.status = OrganizationMemberStatus.active
        member.accepted_at = datetime.now(UTC)

        user = await session.get(User, guest_id)
        assert user is not None
        user.is_verified = True
        user.hashed_password = PasswordHelper().hash(PASSWORD)
        user.active_organization_id = org_id

    guest_tokens = await _login(client, "guest@external.com")
    resp = await client.get(
        "/projects", headers=_auth(guest_tokens["access_token"])
    )
    assert resp.status_code == 200, resp.text
    items = resp.json()
    assert len(items) == 1
    assert items[0]["id"] == visible_id


# ---------------------------------------------------------------------------
# Cross-org add via /projects/{id}/members still blocked when no membership
# ---------------------------------------------------------------------------


async def test_unaffiliated_user_still_blocked_from_project(
    client: AsyncClient,
    org_user: dict[str, str],
    other_org_user: dict[str, str],
) -> None:
    """Without first inviting the cross-org user as a guest, adding them to
    a project still returns USER_NOT_IN_PROJECT_ORG. The error code now
    literally means 'no membership row at all'.
    """
    project = await client.post(
        "/projects", json={"name": "P"}, headers=_auth(org_user["access_token"])
    )
    resp = await client.post(
        f"/projects/{project.json()['id']}/members",
        json={"user_id": other_org_user["id"], "role": "editor"},
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 400
    assert resp.json()["detail"] == "USER_NOT_IN_PROJECT_ORG"
