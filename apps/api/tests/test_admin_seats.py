"""Seat allocation: cap is enforced at invite time, audit-logged on change.

These tests intentionally bypass `POST /admin/organizations` (which runs the
full provisioning saga including a per-tenant Postgres schema + Alembic chain)
because the test conftest uses `Base.metadata.create_all` for the public
schema and that interferes with the saga's per-schema table creation. The
seat logic we care about lives in `assert_seat_available`, the invite path,
and the PATCH/list endpoints — none of which need a real tenant schema.
"""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

import pytest
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


async def _login(client: AsyncClient, email: str) -> str:
    response = await client.post(
        "/auth/jwt/login",
        data={"username": email, "password": PASSWORD},
    )
    assert response.status_code == 200, response.text
    return response.json()["access_token"]


async def _make_superuser(session: AsyncSession, email: str) -> User:
    user = User(
        email=email,
        hashed_password=PasswordHelper().hash(PASSWORD),
        full_name="Root",
        is_active=True,
        is_verified=True,
        is_superuser=True,
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user


async def _make_org(
    session: AsyncSession,
    *,
    name: str,
    seat_limit: int | None = None,
) -> Organization:
    """Insert an Organization row directly — same shape the saga would
    produce, but without the schema/grants. Tests in this file never touch
    the tenant schema, so this is enough.
    """
    org_id = uuid4()
    org = Organization(
        id=org_id,
        name=name,
        schema_name=schema_name_for(org_id),
        status=OrganizationStatus.active,
        seat_limit=seat_limit,
        provisioned_at=datetime.now(timezone.utc),
    )
    session.add(org)
    await session.commit()
    await session.refresh(org)
    return org


async def _add_member(
    session: AsyncSession,
    *,
    org: Organization,
    email: str,
    is_org_admin: bool = False,
    status: OrganizationMemberStatus = OrganizationMemberStatus.active,
) -> tuple[User, OrganizationMember]:
    user = User(
        email=email,
        hashed_password=PasswordHelper().hash(PASSWORD),
        full_name=email.split("@")[0],
        is_active=True,
        is_verified=True,
        is_superuser=False,
    )
    session.add(user)
    await session.flush()
    member = OrganizationMember(
        user_id=user.id,
        organization_id=org.id,
        is_org_admin=is_org_admin,
        status=status,
        accepted_at=datetime.now(timezone.utc) if status == OrganizationMemberStatus.active else None,
    )
    session.add(member)
    await session.commit()
    return user, member


@pytest.fixture
async def superadmin(client: AsyncClient, session: AsyncSession) -> dict[str, str]:
    user = await _make_superuser(session, "root@example.com")
    token = await _login(client, user.email)
    return {"token": token, "user_id": str(user.id), "email": user.email}


# ---------------------------------------------------------------------------
# count_consumed_seats / assert_seat_available helpers
# ---------------------------------------------------------------------------


async def test_count_consumed_seats_counts_non_removed(
    session: AsyncSession,
) -> None:
    from bimstitch_api.admin.seats import count_consumed_seats

    org = await _make_org(session, name="HelperOrg", seat_limit=10)
    await _add_member(session, org=org, email="active@helper.example", status=OrganizationMemberStatus.active)
    await _add_member(session, org=org, email="pending@helper.example", status=OrganizationMemberStatus.pending)
    await _add_member(session, org=org, email="susp@helper.example", status=OrganizationMemberStatus.suspended)
    await _add_member(session, org=org, email="removed@helper.example", status=OrganizationMemberStatus.removed)

    used = await count_consumed_seats(session, org.id)
    # active + pending + suspended count; removed does not.
    assert used == 3


async def test_assert_seat_available_passes_when_unlimited(
    session: AsyncSession,
) -> None:
    from bimstitch_api.admin.seats import assert_seat_available

    org = await _make_org(session, name="Unlimited", seat_limit=None)
    # Fill up some seats; no cap means no exception.
    for i in range(10):
        await _add_member(session, org=org, email=f"u{i}@unlimited.example")
    await assert_seat_available(session, org)


async def test_assert_seat_available_raises_when_full(
    session: AsyncSession,
) -> None:
    from fastapi import HTTPException

    from bimstitch_api.admin.seats import assert_seat_available

    org = await _make_org(session, name="Full", seat_limit=2)
    await _add_member(session, org=org, email="a@full.example")
    await _add_member(session, org=org, email="b@full.example")

    with pytest.raises(HTTPException) as exc_info:
        await assert_seat_available(session, org)
    assert exc_info.value.status_code == 409
    assert exc_info.value.detail == "SEAT_LIMIT_EXCEEDED"


# ---------------------------------------------------------------------------
# GET endpoints — seat_count_used in responses
# ---------------------------------------------------------------------------


async def test_list_orgs_includes_seat_fields(
    client: AsyncClient, session: AsyncSession, superadmin: dict[str, str]
) -> None:
    a = await _make_org(session, name="ListA", seat_limit=5)
    await _add_member(session, org=a, email="alice@lista.example")
    await _make_org(session, name="ListB", seat_limit=None)

    response = await client.get(
        "/admin/organizations", headers=_auth(superadmin["token"])
    )
    assert response.status_code == 200, response.text
    rows = response.json()
    by_name = {r["name"]: r for r in rows}
    assert by_name["ListA"]["seat_limit"] == 5
    assert by_name["ListA"]["seat_count_used"] == 1
    assert by_name["ListB"]["seat_limit"] is None
    assert by_name["ListB"]["seat_count_used"] == 0


async def test_get_org_includes_seat_fields(
    client: AsyncClient, session: AsyncSession, superadmin: dict[str, str]
) -> None:
    org = await _make_org(session, name="OneOrg", seat_limit=3)
    await _add_member(session, org=org, email="x@oneorg.example")

    response = await client.get(
        f"/admin/organizations/{org.id}", headers=_auth(superadmin["token"])
    )
    assert response.status_code == 200
    body = response.json()
    assert body["seat_limit"] == 3
    assert body["seat_count_used"] == 1


# ---------------------------------------------------------------------------
# PATCH /admin/organizations — seat_limit changes
# ---------------------------------------------------------------------------


async def test_patch_seat_limit_audited(
    client: AsyncClient,
    session: AsyncSession,
    session_maker: async_sessionmaker[AsyncSession],
    superadmin: dict[str, str],
) -> None:
    org = await _make_org(session, name="AuditCo", seat_limit=5)

    patch = await client.patch(
        f"/admin/organizations/{org.id}",
        json={"seat_limit": 10},
        headers=_auth(superadmin["token"]),
    )
    assert patch.status_code == 200, patch.text
    assert patch.json()["seat_limit"] == 10

    entries = await _audit_rows(session_maker, "organization.seat_limit_changed")
    assert len(entries) == 1
    # The audit row carries a full snapshot of the org before/after (matches
    # how `organization.updated` records changes). We only need to confirm
    # the seat_limit dimension moved.
    assert entries[0].before is not None and entries[0].before["seat_limit"] == 5
    assert entries[0].after is not None and entries[0].after["seat_limit"] == 10


async def test_patch_seat_limit_below_usage_rejected(
    client: AsyncClient, session: AsyncSession, superadmin: dict[str, str]
) -> None:
    org = await _make_org(session, name="ShrinkCo", seat_limit=5)
    for i in range(3):
        await _add_member(session, org=org, email=f"u{i}@shrink.example")

    patch = await client.patch(
        f"/admin/organizations/{org.id}",
        json={"seat_limit": 1},
        headers=_auth(superadmin["token"]),
    )
    assert patch.status_code == 409
    assert patch.json()["detail"] == "SEAT_LIMIT_BELOW_USAGE"


async def test_patch_seat_limit_to_null_clears_cap(
    client: AsyncClient, session: AsyncSession, superadmin: dict[str, str]
) -> None:
    org = await _make_org(session, name="UncapCo", seat_limit=1)
    await _add_member(session, org=org, email="solo@uncap.example")

    patch = await client.patch(
        f"/admin/organizations/{org.id}",
        json={"seat_limit": None},
        headers=_auth(superadmin["token"]),
    )
    assert patch.status_code == 200
    assert patch.json()["seat_limit"] is None


async def test_patch_only_name_does_not_touch_seat_limit(
    client: AsyncClient, session: AsyncSession, superadmin: dict[str, str]
) -> None:
    """Regression: omitting `seat_limit` must leave the cap untouched."""
    org = await _make_org(session, name="StableCo", seat_limit=7)

    patch = await client.patch(
        f"/admin/organizations/{org.id}",
        json={"name": "StableCo Renamed"},
        headers=_auth(superadmin["token"]),
    )
    assert patch.status_code == 200, patch.text
    body = patch.json()
    assert body["name"] == "StableCo Renamed"
    assert body["seat_limit"] == 7


# ---------------------------------------------------------------------------
# POST /organizations/{id}/members — invite seat enforcement
#
# These need a real tenant schema only when `projects=[...]` is passed.
# We invite without project assignments so no `SET LOCAL search_path` runs
# against a non-existent schema.
# ---------------------------------------------------------------------------


async def test_invite_blocked_when_cap_reached(
    client: AsyncClient, session: AsyncSession, superadmin: dict[str, str]
) -> None:
    org = await _make_org(session, name="TightCo", seat_limit=1)
    await _add_member(session, org=org, email="existing@tight.example")

    response = await client.post(
        f"/organizations/{org.id}/members",
        json={"email": "newcomer@tight.example", "is_org_admin": False},
        headers=_auth(superadmin["token"]),
    )
    assert response.status_code == 409
    assert response.json()["detail"] == "SEAT_LIMIT_EXCEEDED"


async def test_invite_succeeds_under_cap(
    client: AsyncClient, session: AsyncSession, superadmin: dict[str, str]
) -> None:
    org = await _make_org(session, name="RoomyCo", seat_limit=5)
    await _add_member(session, org=org, email="first@roomy.example")

    response = await client.post(
        f"/organizations/{org.id}/members",
        json={"email": "second@roomy.example", "is_org_admin": False},
        headers=_auth(superadmin["token"]),
    )
    assert response.status_code == 201, response.text
    assert response.json()["status"] == "pending"


async def test_invite_unlimited_succeeds_many_times(
    client: AsyncClient, session: AsyncSession, superadmin: dict[str, str]
) -> None:
    org = await _make_org(session, name="FreeCo", seat_limit=None)

    for i in range(4):
        response = await client.post(
            f"/organizations/{org.id}/members",
            json={"email": f"u{i}@free.example", "is_org_admin": False},
            headers=_auth(superadmin["token"]),
        )
        assert response.status_code == 201, response.text


async def test_duplicate_invite_returns_member_already_exists_not_seat_error(
    client: AsyncClient, session: AsyncSession, superadmin: dict[str, str]
) -> None:
    """Re-inviting an existing non-removed member at the cap should report
    MEMBER_ALREADY_EXISTS rather than SEAT_LIMIT_EXCEEDED — they don't take a
    new seat."""
    org = await _make_org(session, name="DupCo", seat_limit=1)
    await _add_member(session, org=org, email="solo@dup.example")

    response = await client.post(
        f"/organizations/{org.id}/members",
        json={"email": "solo@dup.example", "is_org_admin": False},
        headers=_auth(superadmin["token"]),
    )
    assert response.status_code == 409
    assert response.json()["detail"] == "ORG_MEMBER_ALREADY_EXISTS"


async def test_removed_member_can_be_reinvited_under_cap(
    client: AsyncClient, session: AsyncSession, superadmin: dict[str, str]
) -> None:
    """A removed member doesn't count toward seats; re-inviting them when the
    cap has room should succeed."""
    org = await _make_org(session, name="ReclaimCo", seat_limit=2)
    await _add_member(session, org=org, email="stayer@reclaim.example")
    await _add_member(
        session, org=org, email="leaver@reclaim.example",
        status=OrganizationMemberStatus.removed,
    )

    response = await client.post(
        f"/organizations/{org.id}/members",
        json={"email": "leaver@reclaim.example", "is_org_admin": False},
        headers=_auth(superadmin["token"]),
    )
    assert response.status_code == 201, response.text


async def test_delete_member_frees_seat(
    client: AsyncClient, session: AsyncSession, superadmin: dict[str, str]
) -> None:
    """Hard-deleting a member via DELETE clears their row and frees the seat
    for a new invite. The router does SET search_path against the tenant
    schema for project_members; we can't run that without a real schema, so
    instead we delete the row directly and check the seat count moves."""
    from bimstitch_api.admin.seats import count_consumed_seats

    org = await _make_org(session, name="FreeUpCo", seat_limit=2)
    user, member = await _add_member(session, org=org, email="goner@freeup.example")
    await _add_member(session, org=org, email="stayer@freeup.example")
    assert await count_consumed_seats(session, org.id) == 2

    # Direct delete (sidesteps the search_path concern).
    await session.delete(member)
    await session.commit()
    assert await count_consumed_seats(session, org.id) == 1


# ---------------------------------------------------------------------------
# Gating
# ---------------------------------------------------------------------------


async def test_non_superuser_cannot_list_orgs(
    client: AsyncClient, session: AsyncSession
) -> None:
    plain = User(
        email="plain@example.com",
        hashed_password=PasswordHelper().hash(PASSWORD),
        full_name="Plain",
        is_active=True,
        is_verified=True,
        is_superuser=False,
    )
    session.add(plain)
    await session.commit()

    token = await _login(client, plain.email)
    response = await client.get("/admin/organizations", headers=_auth(token))
    assert response.status_code == 403


# ---------------------------------------------------------------------------
# /auth/me surfaces seats so the sidebar can render usage
# ---------------------------------------------------------------------------


async def test_me_includes_seat_fields(
    client: AsyncClient, session: AsyncSession
) -> None:
    org = await _make_org(session, name="MeSeatCo", seat_limit=4)
    user, _ = await _add_member(session, org=org, email="alice@meseat.example")

    token = await _login(client, user.email)
    response = await client.get("/auth/me", headers=_auth(token))
    assert response.status_code == 200
    body = response.json()
    memberships = body["memberships"]
    assert len(memberships) == 1
    assert memberships[0]["seat_limit"] == 4
    assert memberships[0]["seat_count_used"] == 1
