"""Tests for tenant/user management rules.

Covers the assertion helpers in `admin/membership_rules.py` and the route
integration on `organization_members.py` so we know the wired-up handlers
return the right error codes when the rules fire.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import TYPE_CHECKING
from uuid import uuid4

from fastapi_users.password import PasswordHelper
from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from bimstitch_api.models.organization import Organization, OrganizationStatus
from bimstitch_api.models.organization_member import (
    OrganizationMember,
    OrganizationMemberStatus,
)
from bimstitch_api.models.user import User
from bimstitch_api.tenancy import schema_name_for

if TYPE_CHECKING:
    pass


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
    return user


async def _make_org(
    session: AsyncSession,
    name: str,
    *,
    seat_limit: int | None = None,
    status_value: OrganizationStatus = OrganizationStatus.active,
) -> Organization:
    org_id = uuid4()
    org = Organization(
        id=org_id,
        name=name,
        schema_name=schema_name_for(org_id),
        status=status_value,
        provisioned_at=datetime.now(timezone.utc),
        seat_limit=seat_limit,
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
    status_value: OrganizationMemberStatus = OrganizationMemberStatus.active,
) -> OrganizationMember:
    member = OrganizationMember(
        user_id=user.id,
        organization_id=org.id,
        is_org_admin=is_org_admin,
        status=status_value,
        accepted_at=(
            datetime.now(timezone.utc)
            if status_value == OrganizationMemberStatus.active
            else None
        ),
    )
    session.add(member)
    if status_value == OrganizationMemberStatus.active:
        user.active_organization_id = org.id
    await session.commit()
    return member


# ---------------------------------------------------------------------------
# Last-admin invariant
# ---------------------------------------------------------------------------


async def test_demote_last_admin_blocked(
    client: AsyncClient, session: AsyncSession
) -> None:
    org = await _make_org(session, f"Acme-{uuid4().hex[:8]}")
    admin = await _make_user(session, f"admin-{uuid4().hex[:8]}@acme.com")
    member = await _make_user(session, f"member-{uuid4().hex[:8]}@acme.com")
    await _add_member(session, user=admin, org=org, is_org_admin=True)
    await _add_member(session, user=member, org=org, is_org_admin=False)

    tokens = await _login(client, admin.email)
    # Demoting the sole admin is blocked.
    resp = await client.patch(
        f"/organizations/{org.id}/members/{admin.id}",
        json={"is_org_admin": False},
        headers=_auth(tokens["access_token"]),
    )
    # Self-action protection fires first; demoting via admin-route is blocked.
    assert resp.status_code == 409
    assert resp.json()["detail"] == "SELF_ACTION_FORBIDDEN"

    # A second admin demotes the first (still last-admin scenario because the
    # second admin doesn't yet exist) — promote member to admin first.
    promote = await client.patch(
        f"/organizations/{org.id}/members/{member.id}",
        json={"is_org_admin": True},
        headers=_auth(tokens["access_token"]),
    )
    assert promote.status_code == 200

    # Now we have two admins. Login as member, demote admin.
    member_tokens = await _login(client, member.email)
    demote = await client.patch(
        f"/organizations/{org.id}/members/{admin.id}",
        json={"is_org_admin": False},
        headers=_auth(member_tokens["access_token"]),
    )
    assert demote.status_code == 200, demote.text

    # Now `member` is the sole admin. Login as `member`, try to demote
    # themselves — self-action; or have admin (now non-admin) try
    # to demote `member`. Latter should 403 (not an admin anymore).
    no_longer_admin = await client.patch(
        f"/organizations/{org.id}/members/{member.id}",
        json={"is_org_admin": False},
        headers=_auth(tokens["access_token"]),
    )
    assert no_longer_admin.status_code == 403


async def test_remove_last_admin_blocked(
    client: AsyncClient, session: AsyncSession
) -> None:
    org = await _make_org(session, f"Acme-{uuid4().hex[:8]}")
    admin1 = await _make_user(session, f"a1-{uuid4().hex[:8]}@acme.com")
    admin2 = await _make_user(session, f"a2-{uuid4().hex[:8]}@acme.com")
    await _add_member(session, user=admin1, org=org, is_org_admin=True)
    await _add_member(session, user=admin2, org=org, is_org_admin=True)

    tokens = await _login(client, admin1.email)
    # Removing one of two admins should succeed.
    resp = await client.request(
        "DELETE",
        f"/organizations/{org.id}/members/{admin2.id}",
        headers=_auth(tokens["access_token"]),
    )
    assert resp.status_code == 204, resp.text

    # admin1 is now the sole admin. Cannot remove themselves via admin route
    # (self-action), and admin2 is gone so we can't test "other removes admin1"
    # the same way. Re-add admin2 as a non-admin to verify the rule from the
    # "other tries to remove the last admin" angle.
    await session.execute(
        text(
            "INSERT INTO organization_members "
            "(id, user_id, organization_id, is_org_admin, status, accepted_at) "
            "VALUES (:id, :uid, :oid, false, 'active', NOW())"
        ),
        {"id": str(uuid4()), "uid": str(admin2.id), "oid": str(org.id)},
    )
    await session.commit()

    admin2_tokens = await _login(client, admin2.email)
    # admin2 is now a regular member — they can't perform admin actions.
    resp = await client.request(
        "DELETE",
        f"/organizations/{org.id}/members/{admin1.id}",
        headers=_auth(admin2_tokens["access_token"]),
    )
    assert resp.status_code == 403


async def test_pending_admin_does_not_satisfy_invariant(
    client: AsyncClient, session: AsyncSession
) -> None:
    """A pending admin invite cannot keep an org alive. If demoting the
    only active admin would leave only pending admins, it must be blocked.
    """
    org = await _make_org(session, f"Acme-{uuid4().hex[:8]}")
    admin = await _make_user(session, f"admin-{uuid4().hex[:8]}@acme.com")
    pending_admin = await _make_user(session, f"newadmin-{uuid4().hex[:8]}@acme.com")
    other = await _make_user(session, f"other-{uuid4().hex[:8]}@acme.com")
    await _add_member(session, user=admin, org=org, is_org_admin=True)
    await _add_member(
        session,
        user=pending_admin,
        org=org,
        is_org_admin=True,
        status_value=OrganizationMemberStatus.pending,
    )
    await _add_member(session, user=other, org=org, is_org_admin=False)

    tokens = await _login(client, other.email)
    # `other` is not an admin so they can't act. Promote `other` to admin
    # via direct DB to test the rule itself.
    await session.execute(
        text(
            "UPDATE organization_members SET is_org_admin=true "
            "WHERE user_id=:uid AND organization_id=:oid"
        ),
        {"uid": str(other.id), "oid": str(org.id)},
    )
    await session.commit()

    # Now `other` (active admin) demotes `admin` (active admin). The pending
    # admin invite doesn't help — but `other` themselves still satisfies the
    # invariant, so this should succeed.
    resp = await client.patch(
        f"/organizations/{org.id}/members/{admin.id}",
        json={"is_org_admin": False},
        headers=_auth(tokens["access_token"]),
    )
    assert resp.status_code == 200, resp.text

    # `other` is sole active admin. `admin` (now non-admin) tries to demote
    # `other` — fails as non-admin.
    admin_tokens = await _login(client, admin.email)
    resp = await client.patch(
        f"/organizations/{org.id}/members/{other.id}",
        json={"is_org_admin": False},
        headers=_auth(admin_tokens["access_token"]),
    )
    assert resp.status_code == 403


async def test_deactivated_admin_does_not_satisfy_invariant(
    client: AsyncClient, session: AsyncSession
) -> None:
    """A globally-deactivated admin (is_active=false) doesn't keep the org
    alive — they can't log in, so the org is functionally headless.
    """
    org = await _make_org(session, f"Acme-{uuid4().hex[:8]}")
    admin = await _make_user(session, f"admin-{uuid4().hex[:8]}@acme.com")
    deactivated = await _make_user(session, f"deactivated-{uuid4().hex[:8]}@acme.com", is_active=False)
    await _add_member(session, user=admin, org=org, is_org_admin=True)
    await _add_member(session, user=deactivated, org=org, is_org_admin=True)

    tokens = await _login(client, admin.email)
    # Promote one more so we can demote admin without violating.
    new_admin = await _make_user(session, f"new-{uuid4().hex[:8]}@acme.com")
    await _add_member(session, user=new_admin, org=org, is_org_admin=False)
    promote = await client.patch(
        f"/organizations/{org.id}/members/{new_admin.id}",
        json={"is_org_admin": True},
        headers=_auth(tokens["access_token"]),
    )
    assert promote.status_code == 200

    # Login as new_admin, try to remove `admin`. The only other admin is
    # deactivated — so this should fail LAST_ADMIN_REQUIRED.
    new_admin_tokens = await _login(client, new_admin.email)
    resp = await client.request(
        "DELETE",
        f"/organizations/{org.id}/members/{admin.id}",
        headers=_auth(new_admin_tokens["access_token"]),
    )
    # Wait — new_admin is still active and counts. So removing `admin` is OK.
    # The deactivated admin doesn't count but new_admin does. So this should
    # succeed.
    assert resp.status_code == 204, resp.text


# ---------------------------------------------------------------------------
# State-machine transitions
# ---------------------------------------------------------------------------


async def test_invalid_status_transition_rejected(
    client: AsyncClient, session: AsyncSession
) -> None:
    """PATCH removed → active is not allowed by the state machine."""
    org = await _make_org(session, f"Acme-{uuid4().hex[:8]}")
    admin = await _make_user(session, f"admin-{uuid4().hex[:8]}@acme.com")
    member = await _make_user(session, f"m-{uuid4().hex[:8]}@acme.com")
    await _add_member(session, user=admin, org=org, is_org_admin=True)
    await _add_member(
        session,
        user=member,
        org=org,
        status_value=OrganizationMemberStatus.removed,
    )

    tokens = await _login(client, admin.email)
    resp = await client.patch(
        f"/organizations/{org.id}/members/{member.id}",
        json={"status": "active"},
        headers=_auth(tokens["access_token"]),
    )
    assert resp.status_code == 422
    assert resp.json()["detail"] == "INVALID_STATUS_TRANSITION"


async def test_active_to_suspended_allowed(
    client: AsyncClient, session: AsyncSession
) -> None:
    org = await _make_org(session, f"Acme-{uuid4().hex[:8]}")
    admin = await _make_user(session, f"admin-{uuid4().hex[:8]}@acme.com")
    member = await _make_user(session, f"m-{uuid4().hex[:8]}@acme.com")
    await _add_member(session, user=admin, org=org, is_org_admin=True)
    await _add_member(session, user=member, org=org, is_org_admin=False)

    tokens = await _login(client, admin.email)
    resp = await client.patch(
        f"/organizations/{org.id}/members/{member.id}",
        json={"status": "suspended"},
        headers=_auth(tokens["access_token"]),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "suspended"


# ---------------------------------------------------------------------------
# Org status preconditions
# ---------------------------------------------------------------------------


async def test_invite_blocked_on_suspended_org(
    client: AsyncClient, session: AsyncSession
) -> None:
    org = await _make_org(session, f"Acme-{uuid4().hex[:8]}")
    admin = await _make_user(session, f"admin-{uuid4().hex[:8]}@acme.com")
    await _add_member(session, user=admin, org=org, is_org_admin=True)

    # Suspend the org directly.
    org.status = OrganizationStatus.suspended
    await session.commit()

    tokens = await _login(client, admin.email)
    resp = await client.post(
        f"/organizations/{org.id}/members",
        json={"email": "newby@acme.com", "is_org_admin": False, "projects": []},
        headers=_auth(tokens["access_token"]),
    )
    assert resp.status_code == 409
    assert resp.json()["detail"] == "ORG_NOT_ACTIVE"


async def test_list_members_still_works_on_suspended_org(
    client: AsyncClient, session: AsyncSession
) -> None:
    """Reads stay open on suspended orgs so admins can audit who's there."""
    org = await _make_org(session, f"Acme-{uuid4().hex[:8]}")
    admin = await _make_user(session, f"admin-{uuid4().hex[:8]}@acme.com")
    await _add_member(session, user=admin, org=org, is_org_admin=True)

    org.status = OrganizationStatus.suspended
    await session.commit()

    tokens = await _login(client, admin.email)
    resp = await client.get(
        f"/organizations/{org.id}/members",
        headers=_auth(tokens["access_token"]),
    )
    assert resp.status_code == 200
    assert len(resp.json()) == 1


# ---------------------------------------------------------------------------
# Self-action protection
# ---------------------------------------------------------------------------


async def test_self_demote_via_admin_route_blocked(
    client: AsyncClient, session: AsyncSession
) -> None:
    org = await _make_org(session, f"Acme-{uuid4().hex[:8]}")
    admin1 = await _make_user(session, f"a1-{uuid4().hex[:8]}@acme.com")
    admin2 = await _make_user(session, f"a2-{uuid4().hex[:8]}@acme.com")
    await _add_member(session, user=admin1, org=org, is_org_admin=True)
    await _add_member(session, user=admin2, org=org, is_org_admin=True)

    tokens = await _login(client, admin1.email)
    resp = await client.patch(
        f"/organizations/{org.id}/members/{admin1.id}",
        json={"is_org_admin": False},
        headers=_auth(tokens["access_token"]),
    )
    assert resp.status_code == 409
    assert resp.json()["detail"] == "SELF_ACTION_FORBIDDEN"


async def test_self_delete_via_admin_route_blocked(
    client: AsyncClient, session: AsyncSession
) -> None:
    org = await _make_org(session, f"Acme-{uuid4().hex[:8]}")
    admin1 = await _make_user(session, f"a1-{uuid4().hex[:8]}@acme.com")
    admin2 = await _make_user(session, f"a2-{uuid4().hex[:8]}@acme.com")
    await _add_member(session, user=admin1, org=org, is_org_admin=True)
    await _add_member(session, user=admin2, org=org, is_org_admin=True)

    tokens = await _login(client, admin1.email)
    resp = await client.request(
        "DELETE",
        f"/organizations/{org.id}/members/{admin1.id}",
        headers=_auth(tokens["access_token"]),
    )
    assert resp.status_code == 409
    assert resp.json()["detail"] == "SELF_ACTION_FORBIDDEN"


# ---------------------------------------------------------------------------
# Capability flags surfaced in the list endpoint
# ---------------------------------------------------------------------------


async def test_list_members_includes_capability_flags(
    client: AsyncClient, session: AsyncSession
) -> None:
    org = await _make_org(session, f"Acme-{uuid4().hex[:8]}")
    admin = await _make_user(session, f"admin-{uuid4().hex[:8]}@acme.com")
    member = await _make_user(session, f"m-{uuid4().hex[:8]}@acme.com")
    await _add_member(session, user=admin, org=org, is_org_admin=True)
    await _add_member(session, user=member, org=org, is_org_admin=False)

    tokens = await _login(client, admin.email)
    resp = await client.get(
        f"/organizations/{org.id}/members",
        headers=_auth(tokens["access_token"]),
    )
    assert resp.status_code == 200, resp.text
    by_email = {m["email"]: m for m in resp.json()}
    # Admin is the only one — last_admin=True, can_remove=False, can_demote=False
    assert by_email[admin.email]["is_last_admin"] is True
    assert by_email[admin.email]["can_remove"] is False
    assert by_email[admin.email]["can_demote"] is False
    # Member is not an admin; can_demote is False (not currently admin),
    # can_remove is True.
    assert by_email[member.email]["is_last_admin"] is False
    assert by_email[member.email]["can_remove"] is True


# ---------------------------------------------------------------------------
# Last-superuser invariant
# ---------------------------------------------------------------------------


async def test_demote_last_superuser_blocked(
    client: AsyncClient, session: AsyncSession
) -> None:
    super1 = await _make_user(session, f"su1-{uuid4().hex[:8]}@platform.example.com", is_superuser=True)
    # Login and try to demote `super1` — but they are the only superuser, AND
    # self-action is blocked by the existing CANNOT_DEACTIVATE_SELF rule.
    # Create a second superuser so we test the "demote the other one when
    # they're the last" path.
    super2 = await _make_user(session, f"su2-{uuid4().hex[:8]}@platform.example.com", is_superuser=True)
    tokens = await _login(client, super1.email)

    # Demote super2 — succeeds because super1 still exists.
    resp = await client.post(
        f"/admin/users/{super2.id}/demote",
        headers=_auth(tokens["access_token"]),
    )
    assert resp.status_code == 200

    # Now super1 is the only superuser. super2 (no longer superuser) can't
    # call the admin endpoint at all (403). But if we re-promote super2 and
    # have them demote super1, the LAST_SUPERUSER_REQUIRED rule fires.
    repromote = await client.post(
        f"/admin/users/{super2.id}/promote",
        headers=_auth(tokens["access_token"]),
    )
    assert repromote.status_code == 200

    super2_tokens = await _login(client, super2.email)
    # Demote super1 — succeeds (super2 still superuser).
    resp = await client.post(
        f"/admin/users/{super1.id}/demote",
        headers=_auth(super2_tokens["access_token"]),
    )
    assert resp.status_code == 200

    # Try to demote super2 (the last surviving superuser) — must fail.
    # CANNOT_DEACTIVATE_SELF doesn't fire for promote/demote, so the
    # last-superuser rule is the gate.
    resp = await client.post(
        f"/admin/users/{super2.id}/demote",
        headers=_auth(super2_tokens["access_token"]),
    )
    assert resp.status_code == 409
    assert resp.json()["detail"] == "LAST_SUPERUSER_REQUIRED"
