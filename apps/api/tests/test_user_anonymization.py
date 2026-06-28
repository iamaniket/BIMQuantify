"""M-db1 — superuser DELETE /users/{id} anonymizes instead of hard-deleting.

~12 tenant tables FK ``public.users`` with ON DELETE RESTRICT (project, finding,
certificate, …), so the fastapi-users default hard delete raised an unhandled 500
for any user who had authored a row, and such users were effectively
un-deletable. ``UserManager.delete`` now scrubs PII, disables auth, drops org
memberships, and stamps ``anonymized_at`` — the row survives so every RESTRICT FK
stays valid and the audit/authorship trail is preserved.
"""

from __future__ import annotations

from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import func, select, text

from tests.conftest import (
    _auth,
    _create_project,
    _provision_user_in_org,
    _schema_for_project,
)

if TYPE_CHECKING:
    from httpx import AsyncClient
    from sqlalchemy.ext.asyncio import AsyncEngine, async_sessionmaker


async def test_delete_user_anonymizes_and_preserves_restrict_references(
    client: AsyncClient,
    session_maker: async_sessionmaker,
    engine: AsyncEngine,
) -> None:
    from bimdossier_api.models.user import User

    admin = await _provision_user_in_org(
        client,
        session_maker,
        engine,
        email="admin@platform.test",
        organization_name="AdminOrg",
        is_superuser=True,
    )
    # Target OWNS a project — projects.created_by_user_id is a RESTRICT FK to
    # public.users, the exact reference a hard delete would 500 on.
    target = await _provision_user_in_org(
        client,
        session_maker,
        engine,
        email="target@example.com",
        organization_name="TargetOrg",
    )
    project = await _create_project(client, target["access_token"], name="Owned")

    resp = await client.delete(f"/users/{target['id']}", headers=_auth(admin["access_token"]))
    assert resp.status_code == 204, resp.text

    # The user row SURVIVES (no hard delete) and is scrubbed + disabled.
    async with session_maker() as s:
        row = await s.get(User, UUID(target["id"]))
        assert row is not None
        assert row.is_active is False
        assert row.is_superuser is False
        assert row.is_verified is False
        assert row.anonymized_at is not None
        assert row.tokens_valid_after is not None
        assert row.full_name is None
        assert row.email != "target@example.com"
        assert "target@example.com" not in (row.email or "")

    # The RESTRICT-referencing project is intact — anonymize never touched it,
    # and the user it points at still exists.
    async with session_maker() as s:
        schema = await _schema_for_project(s, project["id"])
        still_there = await s.scalar(
            text(f'SELECT 1 FROM "{schema}".projects WHERE id = :pid'),
            {"pid": project["id"]},
        )
        assert still_there == 1


async def test_delete_user_revokes_org_memberships(
    client: AsyncClient,
    session_maker: async_sessionmaker,
    engine: AsyncEngine,
) -> None:
    from bimdossier_api.models.organization_member import OrganizationMember

    admin = await _provision_user_in_org(
        client,
        session_maker,
        engine,
        email="admin2@platform.test",
        organization_name="AdminOrg2",
        is_superuser=True,
    )
    target = await _provision_user_in_org(
        client,
        session_maker,
        engine,
        email="member@example.com",
        organization_name="MemberOrg",
    )

    resp = await client.delete(f"/users/{target['id']}", headers=_auth(admin["access_token"]))
    assert resp.status_code == 204, resp.text

    async with session_maker() as s:
        count = await s.scalar(
            select(func.count())
            .select_from(OrganizationMember)
            .where(OrganizationMember.user_id == UUID(target["id"]))
        )
        assert count == 0


async def test_delete_user_is_idempotent(
    client: AsyncClient,
    session_maker: async_sessionmaker,
    engine: AsyncEngine,
) -> None:
    admin = await _provision_user_in_org(
        client,
        session_maker,
        engine,
        email="admin3@platform.test",
        organization_name="AdminOrg3",
        is_superuser=True,
    )
    target = await _provision_user_in_org(
        client,
        session_maker,
        engine,
        email="twice@example.com",
        organization_name="TwiceOrg",
    )

    first = await client.delete(f"/users/{target['id']}", headers=_auth(admin["access_token"]))
    assert first.status_code == 204, first.text
    second = await client.delete(f"/users/{target['id']}", headers=_auth(admin["access_token"]))
    assert second.status_code == 204, second.text


async def test_cannot_anonymize_last_active_superuser(
    client: AsyncClient,
    session_maker: async_sessionmaker,
    engine: AsyncEngine,
) -> None:
    from bimdossier_api.models.user import User

    # The only active superuser in the (truncated) DB. Anonymizing it would
    # brick the platform, so the guard returns 409 and leaves the row intact.
    admin = await _provision_user_in_org(
        client,
        session_maker,
        engine,
        email="solo@platform.test",
        organization_name="SoloOrg",
        is_superuser=True,
    )

    resp = await client.delete(f"/users/{admin['id']}", headers=_auth(admin["access_token"]))
    assert resp.status_code == 409, resp.text
    body = resp.json()
    assert body["code"] == "LAST_SUPERUSER_REQUIRED"
    assert body["detail"] == "LAST_SUPERUSER_REQUIRED"

    async with session_maker() as s:
        row = await s.get(User, UUID(admin["id"]))
        assert row is not None
        assert row.is_active is True
        assert row.is_superuser is True
        assert row.anonymized_at is None
