"""Suspension + user-deactivation tests.

Covers:
  * Org suspension blocks tenant-scoped requests (via /projects since
    that's the simplest tenant-scoped endpoint).
  * Suspended org is skipped when picking a user's default active org at
    login; the user gets active_organization_id=None if all their orgs
    are suspended.
  * /auth/switch-organization rejects a suspended org with 403 ORG_SUSPENDED.
  * /admin/users/{id}/deactivate sets is_active=false and audit-logs it;
    login then fails with LOGIN_BAD_CREDENTIALS.
  * A super-admin cannot deactivate themselves.

These bypass the provisioning saga the same way test_admin_seats.py does —
direct DB inserts so the test DB doesn't need real per-tenant schemas.
"""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID, uuid4

import pytest
from fastapi_users.password import PasswordHelper
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

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
    response = await client.post(
        "/auth/jwt/login",
        data={"username": email, "password": PASSWORD},
    )
    assert response.status_code == 200, response.text
    return response.json()


async def _make_user(
    session: AsyncSession,
    email: str,
    *,
    is_superuser: bool = False,
    is_active: bool = True,
) -> User:
    user = User(
        email=email,
        hashed_password=PasswordHelper().hash(PASSWORD),
        full_name=email.split("@")[0],
        is_active=is_active,
        is_verified=True,
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
    status_val: OrganizationStatus = OrganizationStatus.active,
) -> Organization:
    org_id = uuid4()
    org = Organization(
        id=org_id,
        name=name,
        schema_name=schema_name_for(org_id),
        status=status_val,
        provisioned_at=datetime.now(timezone.utc),
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
        accepted_at=datetime.now(timezone.utc),
    )
    session.add(member)
    # Pre-set user.active_organization_id so login picks this org.
    user.active_organization_id = org.id
    await session.commit()
    return member


@pytest.fixture
async def superadmin(client: AsyncClient, session: AsyncSession) -> dict[str, str]:
    user = await _make_user(session, "root@example.com", is_superuser=True)
    tokens = await _login(client, user.email)
    return {"token": tokens["access_token"], "user_id": str(user.id)}


# ---------------------------------------------------------------------------
# Tenant suspension blocks tenant access
# ---------------------------------------------------------------------------


async def test_suspended_org_blocks_tenant_endpoints(
    client: AsyncClient, session: AsyncSession
) -> None:
    """Suspending an org via PATCH must immediately stop its members from
    hitting tenant-scoped endpoints (any of them — /projects is a stand-in)."""
    org = await _make_org(session, "BlockedCo")
    user = await _make_user(session, "alice@blocked.example")
    await _add_member(session, user=user, org=org)

    tokens = await _login(client, user.email)
    token = tokens["access_token"]

    # Sanity: while active, the user can reach /projects (an empty list).
    ok = await client.get("/projects", headers=_auth(token))
    assert ok.status_code == 200, ok.text

    # Now suspend the org directly in the DB.
    org.status = OrganizationStatus.suspended
    await session.commit()

    blocked = await client.get("/projects", headers=_auth(token))
    assert blocked.status_code == 403
    assert blocked.json()["detail"] == "ORG_SUSPENDED"


async def test_login_skips_suspended_active_org(
    client: AsyncClient, session: AsyncSession
) -> None:
    """If the user's preferred active org is suspended but another active
    one exists, login should pick the active one rather than land them on
    the suspended one."""
    suspended = await _make_org(session, "SuspendedOrg", status_val=OrganizationStatus.suspended)
    active = await _make_org(session, "ActiveOrg")
    user = await _make_user(session, "multi@org.example")
    # User has both; default points at the suspended one.
    await _add_member(session, user=user, org=suspended)
    await _add_member(session, user=user, org=active)
    # _add_member overwrote active_organization_id; force it back to suspended.
    user.active_organization_id = suspended.id
    await session.commit()

    tokens = await _login(client, user.email)
    me = await client.get("/auth/me", headers=_auth(tokens["access_token"]))
    assert me.status_code == 200
    body = me.json()
    assert body["active_organization_id"] == str(active.id)


async def test_login_returns_no_active_org_when_all_suspended(
    client: AsyncClient, session: AsyncSession
) -> None:
    """If every membership is in a suspended org, login still succeeds but
    the user has no active_organization_id. The portal then treats that
    as a 'no workspace' state."""
    suspended = await _make_org(session, "OnlySuspended", status_val=OrganizationStatus.suspended)
    user = await _make_user(session, "alone@suspended.example")
    await _add_member(session, user=user, org=suspended)

    tokens = await _login(client, user.email)
    me = await client.get("/auth/me", headers=_auth(tokens["access_token"]))
    assert me.status_code == 200
    assert me.json()["active_organization_id"] is None


async def test_switch_organization_rejects_suspended(
    client: AsyncClient, session: AsyncSession
) -> None:
    suspended = await _make_org(session, "ToSwitchInto", status_val=OrganizationStatus.suspended)
    active = await _make_org(session, "Home")
    user = await _make_user(session, "switcher@example.com")
    await _add_member(session, user=user, org=active)
    await _add_member(session, user=user, org=suspended)
    user.active_organization_id = active.id
    await session.commit()

    tokens = await _login(client, user.email)
    response = await client.post(
        "/auth/switch-organization",
        json={"organization_id": str(suspended.id)},
        headers=_auth(tokens["access_token"]),
    )
    assert response.status_code == 403
    assert response.json()["detail"] == "ORG_SUSPENDED"


async def test_patch_status_suspended_records_audit(
    client: AsyncClient, session: AsyncSession, superadmin: dict[str, str]
) -> None:
    """The audit action when status flips to suspended is 'organization.suspended'
    (not just 'organization.updated'), so the audit-log view surfaces it
    distinctly."""
    org = await _make_org(session, "AuditMe")

    response = await client.patch(
        f"/admin/organizations/{org.id}",
        json={"status": "suspended"},
        headers=_auth(superadmin["token"]),
    )
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "suspended"

    entries = (
        await session.execute(
            select(AuditLog).where(AuditLog.action == "organization.suspended")
        )
    ).scalars().all()
    assert len(entries) == 1
    assert entries[0].resource_id == str(org.id)


# ---------------------------------------------------------------------------
# User-level deactivation
# ---------------------------------------------------------------------------


async def test_deactivate_user_blocks_subsequent_login(
    client: AsyncClient, session: AsyncSession, superadmin: dict[str, str]
) -> None:
    org = await _make_org(session, "AnyOrg")
    user = await _make_user(session, "kicked@example.com")
    await _add_member(session, user=user, org=org)

    # Login works while active.
    await _login(client, user.email)

    # Super-admin deactivates the user.
    resp = await client.post(
        f"/admin/users/{user.id}/deactivate",
        headers=_auth(superadmin["token"]),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["is_active"] is False

    # Re-login now fails with the standard bad-credentials code — the
    # FastAPI Users authenticate() returns None for inactive users, so
    # the route gives back LOGIN_BAD_CREDENTIALS rather than a more
    # specific message. That matches the existing inactive-user behaviour.
    failed = await client.post(
        "/auth/jwt/login",
        data={"username": user.email, "password": PASSWORD},
    )
    assert failed.status_code == 400
    assert failed.json()["detail"] == "LOGIN_BAD_CREDENTIALS"


async def test_deactivate_user_audited(
    client: AsyncClient, session: AsyncSession, superadmin: dict[str, str]
) -> None:
    user = await _make_user(session, "audit-deactivate@example.com")

    resp = await client.post(
        f"/admin/users/{user.id}/deactivate",
        headers=_auth(superadmin["token"]),
    )
    assert resp.status_code == 200

    entries = (
        await session.execute(
            select(AuditLog).where(AuditLog.action == "user.deactivated")
        )
    ).scalars().all()
    assert len(entries) == 1
    assert entries[0].resource_id == str(user.id)


async def test_reactivate_user_restores_login(
    client: AsyncClient, session: AsyncSession, superadmin: dict[str, str]
) -> None:
    user = await _make_user(session, "phoenix@example.com", is_active=False)

    resp = await client.post(
        f"/admin/users/{user.id}/activate",
        headers=_auth(superadmin["token"]),
    )
    assert resp.status_code == 200
    assert resp.json()["is_active"] is True

    tokens = await _login(client, user.email)
    assert "access_token" in tokens


async def test_deactivate_self_blocked(
    client: AsyncClient, session: AsyncSession, superadmin: dict[str, str]
) -> None:
    """A super-admin trying to deactivate their own account would lock the
    platform out of admin tooling. Block the action."""
    resp = await client.post(
        f"/admin/users/{superadmin['user_id']}/deactivate",
        headers=_auth(superadmin["token"]),
    )
    assert resp.status_code == 400
    assert resp.json()["detail"] == "CANNOT_DEACTIVATE_SELF"


async def test_non_superuser_cannot_toggle_activation(
    client: AsyncClient, session: AsyncSession
) -> None:
    target = await _make_user(session, "target@example.com")
    plain = await _make_user(session, "plain@example.com")

    tokens = await _login(client, plain.email)
    resp = await client.post(
        f"/admin/users/{target.id}/deactivate",
        headers=_auth(tokens["access_token"]),
    )
    assert resp.status_code == 403


# ---------------------------------------------------------------------------
# Member-level suspension (already supported by PATCH; smoke-test here)
# ---------------------------------------------------------------------------


async def test_member_suspension_does_not_remove_seat(
    client: AsyncClient, session: AsyncSession, superadmin: dict[str, str]
) -> None:
    """Suspended members still occupy a seat — confirms the seat helper
    matches `count_consumed_seats` semantics."""
    from bimstitch_api.admin.seats import count_consumed_seats

    org = await _make_org(session, "SeatHoldCo")
    user = await _make_user(session, "held@example.com")
    # The member must be an admin so a *second* admin can be added to satisfy
    # the LAST_ADMIN_REQUIRED guard when we suspend them below.
    admin2 = await _make_user(session, "admin2@seatholdco.com")
    await _add_member(session, user=user, org=org, is_org_admin=True)
    await _add_member(session, user=admin2, org=org, is_org_admin=True)

    assert await count_consumed_seats(session, org.id) == 2

    resp = await client.patch(
        f"/organizations/{org.id}/members/{user.id}",
        json={"status": "suspended"},
        headers=_auth(superadmin["token"]),
    )
    assert resp.status_code == 200, resp.text

    # Still 2 seats — suspended is not removed.
    assert await count_consumed_seats(session, org.id) == 2
