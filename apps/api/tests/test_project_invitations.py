"""Tests for POST /projects/{project_id}/invitations — project-scoped email invitations."""

from __future__ import annotations

from uuid import uuid4

from httpx import AsyncClient
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _create_project(
    client: AsyncClient, owner: dict[str, str], name: str = "TestProject"
) -> dict:
    resp = await client.post("/projects", json={"name": name}, headers=_auth(owner["access_token"]))
    assert resp.status_code == 201, resp.text
    return resp.json()


INVITE_URL = "/projects/{pid}/invitations"


# ---------------------------------------------------------------------------
# Authorization
# ---------------------------------------------------------------------------


async def test_owner_can_invite_by_email(
    client: AsyncClient,
    org_user: dict[str, str],
    email_transport: object,
) -> None:
    project = await _create_project(client, org_user)
    resp = await client.post(
        INVITE_URL.format(pid=project["id"]),
        json={"email": "newperson@external.com", "role": "inspector"},
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["scenario"] == "new_user"
    assert body["role"] == "inspector"
    assert body["email"] == "newperson@external.com"


async def test_org_admin_can_invite(
    client: AsyncClient,
    org_user: dict[str, str],
    same_org_admin_user: dict[str, str],
    email_transport: object,
) -> None:
    project = await _create_project(client, org_user)
    resp = await client.post(
        INVITE_URL.format(pid=project["id"]),
        json={"email": "admin-invite@external.com"},
        headers=_auth(same_org_admin_user["access_token"]),
    )
    assert resp.status_code == 201, resp.text


async def test_superuser_can_invite(
    client: AsyncClient,
    org_user: dict[str, str],
    superuser_in_org: dict[str, str],
    email_transport: object,
) -> None:
    project = await _create_project(client, org_user)
    resp = await client.post(
        INVITE_URL.format(pid=project["id"]),
        json={"email": "super-invite@external.com"},
        headers=_auth(superuser_in_org["access_token"]),
    )
    assert resp.status_code == 201, resp.text


async def test_editor_cannot_invite(
    client: AsyncClient,
    org_user: dict[str, str],
    same_org_non_admin_user: dict[str, str],
) -> None:
    project = await _create_project(client, org_user)
    # Add the non-admin as editor.
    await client.post(
        f"/projects/{project['id']}/members",
        json={"user_id": same_org_non_admin_user["id"], "role": "editor"},
        headers=_auth(org_user["access_token"]),
    )
    resp = await client.post(
        INVITE_URL.format(pid=project["id"]),
        json={"email": "should-fail@external.com"},
        headers=_auth(same_org_non_admin_user["access_token"]),
    )
    assert resp.status_code == 403


async def test_non_member_gets_404(
    client: AsyncClient,
    org_user: dict[str, str],
    other_org_user: dict[str, str],
) -> None:
    project = await _create_project(client, org_user)
    resp = await client.post(
        INVITE_URL.format(pid=project["id"]),
        json={"email": "should-fail@external.com"},
        headers=_auth(other_org_user["access_token"]),
    )
    assert resp.status_code in (403, 404)


# ---------------------------------------------------------------------------
# Scenario 1: New user (no account exists)
# ---------------------------------------------------------------------------


async def test_new_user_creates_account_and_guest_membership(
    client: AsyncClient,
    org_user: dict[str, str],
    session_maker: async_sessionmaker[AsyncSession],
    email_transport: object,
) -> None:
    project = await _create_project(client, org_user)
    email = "brand-new@company.nl"
    resp = await client.post(
        INVITE_URL.format(pid=project["id"]),
        json={"email": email, "role": "contractor", "full_name": "Jan de Vries"},
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["scenario"] == "new_user"
    assert body["role"] == "contractor"

    # Verify user was created.
    from bimstitch_api.models.user import User

    async with session_maker() as session:
        user = (await session.execute(select(User).where(User.email == email))).scalar_one()
        assert user.is_verified is False
        assert user.full_name == "Jan de Vries"

    # Verify guest org membership.
    from bimstitch_api.models.organization_member import (
        OrganizationMember,
        OrganizationMemberStatus,
    )

    async with session_maker() as session:
        member = (
            await session.execute(
                select(OrganizationMember).where(
                    OrganizationMember.user_id == user.id,
                    OrganizationMember.organization_id == org_user["organization_id"],
                )
            )
        ).scalar_one()
        assert member.is_guest is True
        assert member.status == OrganizationMemberStatus.pending

    # The new user's org membership is still pending, so RLS on the users
    # table hides them from GET /members. Verify the project_members row
    # directly via a raw query (no RLS).
    from bimstitch_api.models.organization import Organization

    async with session_maker() as session:
        org = await session.get(Organization, org_user["organization_id"])
        assert org is not None
        row = (
            await session.execute(
                text(
                    f'SELECT role FROM "{org.schema_name}".project_members '
                    "WHERE project_id = :pid AND user_id = :uid"
                ),
                {"pid": project["id"], "uid": str(user.id)},
            )
        ).one()
        assert row[0] == "contractor"


async def test_new_user_receives_activation_email(
    client: AsyncClient,
    org_user: dict[str, str],
    email_transport: object,
) -> None:
    project = await _create_project(client, org_user)
    email = "activate-me@company.nl"
    resp = await client.post(
        INVITE_URL.format(pid=project["id"]),
        json={"email": email},
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 201, resp.text

    sent = email_transport.last_for(email)
    assert sent is not None
    assert "Activate" in sent.subject or "activate" in sent.body.lower()


# ---------------------------------------------------------------------------
# Scenario 2: Existing user, not in this org
# ---------------------------------------------------------------------------


async def test_existing_user_not_in_org_gets_guest_membership(
    client: AsyncClient,
    org_user: dict[str, str],
    other_org_user: dict[str, str],
    session_maker: async_sessionmaker[AsyncSession],
    email_transport: object,
) -> None:
    project = await _create_project(client, org_user)
    resp = await client.post(
        INVITE_URL.format(pid=project["id"]),
        json={"email": other_org_user["email"], "role": "inspector"},
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["scenario"] == "new_org_member"
    assert body["user_id"] == other_org_user["id"]

    # Verify guest org membership in AlphaCo.
    from bimstitch_api.models.organization_member import (
        OrganizationMember,
        OrganizationMemberStatus,
    )

    async with session_maker() as session:
        member = (
            await session.execute(
                select(OrganizationMember).where(
                    OrganizationMember.user_id == other_org_user["id"],
                    OrganizationMember.organization_id == org_user["organization_id"],
                )
            )
        ).scalar_one()
        assert member.is_guest is True
        assert member.status == OrganizationMemberStatus.pending


async def test_existing_user_not_in_org_receives_project_invite_email(
    client: AsyncClient,
    org_user: dict[str, str],
    other_org_user: dict[str, str],
    email_transport: object,
) -> None:
    project = await _create_project(client, org_user, name="Bouwproject Delft")
    resp = await client.post(
        INVITE_URL.format(pid=project["id"]),
        json={"email": other_org_user["email"]},
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 201, resp.text

    sent = email_transport.last_for(other_org_user["email"])
    assert sent is not None
    assert "Bouwproject Delft" in sent.subject
    assert "Bouwproject Delft" in sent.body


# ---------------------------------------------------------------------------
# Scenario 3: Existing active org member
# ---------------------------------------------------------------------------


async def test_existing_org_member_added_directly(
    client: AsyncClient,
    org_user: dict[str, str],
    same_org_non_admin_user: dict[str, str],
    email_transport: object,
) -> None:
    project = await _create_project(client, org_user)
    resp = await client.post(
        INVITE_URL.format(pid=project["id"]),
        json={"email": same_org_non_admin_user["email"], "role": "editor"},
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["scenario"] == "existing_org_member"
    assert body["user_id"] == same_org_non_admin_user["id"]
    assert body["role"] == "editor"


async def test_existing_org_member_receives_added_notification(
    client: AsyncClient,
    org_user: dict[str, str],
    same_org_non_admin_user: dict[str, str],
    email_transport: object,
) -> None:
    project = await _create_project(client, org_user, name="Kantoor Utrecht")
    resp = await client.post(
        INVITE_URL.format(pid=project["id"]),
        json={"email": same_org_non_admin_user["email"]},
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 201, resp.text

    sent = email_transport.last_for(same_org_non_admin_user["email"])
    assert sent is not None
    assert "Kantoor Utrecht" in sent.subject


# ---------------------------------------------------------------------------
# Error cases
# ---------------------------------------------------------------------------


async def test_owner_role_not_assignable(
    client: AsyncClient,
    org_user: dict[str, str],
) -> None:
    project = await _create_project(client, org_user)
    resp = await client.post(
        INVITE_URL.format(pid=project["id"]),
        json={"email": "owner-attempt@test.com", "role": "owner"},
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 400
    assert resp.json()["detail"] == "OWNER_ROLE_NOT_ASSIGNABLE"


async def test_duplicate_invite_returns_409(
    client: AsyncClient,
    org_user: dict[str, str],
    same_org_non_admin_user: dict[str, str],
    email_transport: object,
) -> None:
    project = await _create_project(client, org_user)
    # First invite succeeds.
    resp1 = await client.post(
        INVITE_URL.format(pid=project["id"]),
        json={"email": same_org_non_admin_user["email"]},
        headers=_auth(org_user["access_token"]),
    )
    assert resp1.status_code == 201, resp1.text
    # Second invite for the same user → 409.
    resp2 = await client.post(
        INVITE_URL.format(pid=project["id"]),
        json={"email": same_org_non_admin_user["email"]},
        headers=_auth(org_user["access_token"]),
    )
    assert resp2.status_code == 409
    assert resp2.json()["detail"] == "MEMBER_ALREADY_EXISTS"


async def test_invite_to_archived_project(
    client: AsyncClient,
    org_user: dict[str, str],
) -> None:
    project = await _create_project(client, org_user)
    # Archive the project via the dedicated endpoint.
    archive_resp = await client.post(
        f"/projects/{project['id']}/archive",
        headers=_auth(org_user["access_token"]),
    )
    assert archive_resp.status_code == 200
    resp = await client.post(
        INVITE_URL.format(pid=project["id"]),
        json={"email": "archive-test@test.com"},
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 409
    assert resp.json()["detail"] == "PROJECT_ARCHIVED"


async def test_invite_to_nonexistent_project(
    client: AsyncClient,
    org_user: dict[str, str],
) -> None:
    fake_id = str(uuid4())
    resp = await client.post(
        INVITE_URL.format(pid=fake_id),
        json={"email": "noproject@test.com"},
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Audit log
# ---------------------------------------------------------------------------


async def test_invite_records_audit_entry(
    client: AsyncClient,
    org_user: dict[str, str],
    session_maker: async_sessionmaker[AsyncSession],
    email_transport: object,
) -> None:
    project = await _create_project(client, org_user)
    resp = await client.post(
        INVITE_URL.format(pid=project["id"]),
        json={"email": "audit-check@external.com"},
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 201, resp.text

    from bimstitch_api.models.audit_log import AuditLog

    async with session_maker() as session:
        entry = (
            await session.execute(
                select(AuditLog).where(AuditLog.action == "project_invitation.created")
            )
        ).scalar_one()
        assert entry.resource_id == project["id"]
        assert entry.after["email"] == "audit-check@external.com"
        assert entry.after["scenario"] == "new_user"
