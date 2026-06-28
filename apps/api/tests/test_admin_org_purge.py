"""Admin org purge endpoint + two-phase delete lifecycle (HTTP surface).

Covers:
  * `DELETE /admin/organizations/{id}` is now SOFT-only (marks the row, retains
    schema + storage) — phase 1.
  * `POST /admin/organizations/{id}/purge` — phase 2 hard teardown, super-admin
    only, with the retention gate and its HTTP status mapping.
  * `GET /admin/organizations?include_deleted=true` exposes the retention fields.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from bimdossier_api.models.organization import Organization, OrganizationStatus
from bimdossier_api.tenancy import schema_name_for
from tests.conftest import FakeStorage, _audit_rows
from tests.test_admin_access_control import _auth, _login, _make_user


async def _seed_org(
    session: AsyncSession,
    name: str,
    *,
    status: OrganizationStatus = OrganizationStatus.active,
    deleted_days_ago: float | None = None,
    image_key: str | None = None,
) -> Organization:
    org_id = uuid4()
    org = Organization(
        id=org_id,
        name=name,
        schema_name=schema_name_for(org_id),
        status=status,
        image_key=image_key,
        deleted_at=(
            None if deleted_days_ago is None
            else datetime.now(UTC) - timedelta(days=deleted_days_ago)
        ),
    )
    session.add(org)
    await session.commit()
    return org


async def _superadmin_token(client: AsyncClient, session: AsyncSession) -> str:
    user = await _make_user(session, f"root-{uuid4().hex[:8]}@example.com", is_superuser=True)
    tokens = await _login(client, user.email)
    return tokens["access_token"]


async def _get_org(
    session_maker: async_sessionmaker[AsyncSession], org_id: UUID
) -> Organization:
    async with session_maker() as s:
        return (
            await s.execute(select(Organization).where(Organization.id == org_id))
        ).scalar_one()


# ── phase 1: soft delete is mark-only ────────────────────────────────────────


async def test_delete_org_is_soft_only(
    fake_storage_client: tuple[AsyncClient, FakeStorage],
    session: AsyncSession,
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    client, fake = fake_storage_client
    token = await _superadmin_token(client, session)
    org = await _seed_org(session, "ToDelete")

    resp = await client.delete(f"/admin/organizations/{org.id}", headers=_auth(token))
    assert resp.status_code == 204, resp.text

    row = await _get_org(session_maker, org.id)
    assert row.status == OrganizationStatus.deleted
    assert row.deleted_at is not None
    assert row.purged_at is None  # NOT purged — schema + storage retained
    assert fake.deleted == []  # phase 1 touches no storage

    assert len(await _audit_rows(session_maker, "organization.deleted")) == 1

    # Idempotent.
    resp2 = await client.delete(f"/admin/organizations/{org.id}", headers=_auth(token))
    assert resp2.status_code == 204, resp2.text


# ── phase 2: purge endpoint ──────────────────────────────────────────────────


async def test_purge_requires_superuser(
    fake_storage_client: tuple[AsyncClient, FakeStorage],
    session: AsyncSession,
) -> None:
    client, _ = fake_storage_client
    normal = await _make_user(session, f"user-{uuid4().hex[:8]}@example.com")
    tokens = await _login(client, normal.email)
    org = await _seed_org(session, "Locked", status=OrganizationStatus.deleted, deleted_days_ago=40)

    resp = await client.post(
        f"/admin/organizations/{org.id}/purge", headers=_auth(tokens["access_token"])
    )
    assert resp.status_code == 403
    assert resp.json()["detail"] == "SUPERUSER_REQUIRED"


async def test_purge_live_org_409_not_deleted(
    fake_storage_client: tuple[AsyncClient, FakeStorage],
    session: AsyncSession,
) -> None:
    client, _ = fake_storage_client
    token = await _superadmin_token(client, session)
    org = await _seed_org(session, "Alive")

    resp = await client.post(f"/admin/organizations/{org.id}/purge", headers=_auth(token))
    assert resp.status_code == 409
    assert resp.json()["detail"] == "ORG_NOT_DELETED"


async def test_purge_within_window_409_not_due(
    fake_storage_client: tuple[AsyncClient, FakeStorage],
    session: AsyncSession,
) -> None:
    client, _ = fake_storage_client
    token = await _superadmin_token(client, session)
    org = await _seed_org(
        session, "Recent", status=OrganizationStatus.deleted, deleted_days_ago=1
    )

    resp = await client.post(f"/admin/organizations/{org.id}/purge", headers=_auth(token))
    assert resp.status_code == 409
    assert resp.json()["detail"] == "ORG_PURGE_NOT_DUE"


async def test_purge_due_org_200_and_wipes_storage(
    fake_storage_client: tuple[AsyncClient, FakeStorage],
    session: AsyncSession,
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    client, fake = fake_storage_client
    token = await _superadmin_token(client, session)
    org = await _seed_org(
        session, "Due", status=OrganizationStatus.deleted, deleted_days_ago=40,
        image_key="org-images/due.png",
    )
    fake.objects["org-images/due.png"] = b"logo"

    resp = await client.post(f"/admin/organizations/{org.id}/purge", headers=_auth(token))
    assert resp.status_code == 200, resp.text
    assert resp.json()["purged_at"] is not None

    assert "org-images/due.png" in fake.deleted
    assert (await _get_org(session_maker, org.id)).purged_at is not None


async def test_purge_skip_retention_200_within_window(
    fake_storage_client: tuple[AsyncClient, FakeStorage],
    session: AsyncSession,
) -> None:
    client, _ = fake_storage_client
    token = await _superadmin_token(client, session)
    org = await _seed_org(
        session, "Erase", status=OrganizationStatus.deleted, deleted_days_ago=1
    )

    resp = await client.post(
        f"/admin/organizations/{org.id}/purge",
        headers=_auth(token),
        json={"skip_retention": True},
    )
    assert resp.status_code == 200, resp.text


async def test_purge_is_idempotent(
    fake_storage_client: tuple[AsyncClient, FakeStorage],
    session: AsyncSession,
) -> None:
    client, _ = fake_storage_client
    token = await _superadmin_token(client, session)
    org = await _seed_org(
        session, "Twice", status=OrganizationStatus.deleted, deleted_days_ago=40
    )

    first = await client.post(f"/admin/organizations/{org.id}/purge", headers=_auth(token))
    assert first.status_code == 200, first.text
    second = await client.post(f"/admin/organizations/{org.id}/purge", headers=_auth(token))
    assert second.status_code == 200, second.text  # idempotent no-op


async def test_concurrent_purge_is_single_flight(
    fake_storage_client: tuple[AsyncClient, FakeStorage],
    session: AsyncSession,
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """M-con5: two concurrent purges of the same org must not both tear it down.

    The per-org advisory run-lock makes purge single-flight: exactly one writes
    the `organization.purged` audit row (and wipes storage); the other either
    409s (lock held) or 200-no-ops (already purged). Never a 500, never a double
    purge.
    """
    import asyncio

    client, fake = fake_storage_client
    token = await _superadmin_token(client, session)
    org = await _seed_org(
        session, "Race", status=OrganizationStatus.deleted, deleted_days_ago=40,
        image_key="org-images/race.png",
    )
    fake.objects["org-images/race.png"] = b"logo"

    async def _purge() -> object:
        return await client.post(
            f"/admin/organizations/{org.id}/purge", headers=_auth(token)
        )

    r1, r2 = await asyncio.gather(_purge(), _purge())

    # No 500s; the loser is a clean 409 (lock held) or a 200 idempotent no-op.
    assert {r1.status_code, r2.status_code} <= {200, 409}, (r1.text, r2.text)
    assert 200 in {r1.status_code, r2.status_code}

    # The run-lock held: exactly ONE purge happened, not two.
    rows = await _audit_rows(session_maker, "organization.purged")
    assert len(rows) == 1
    assert (await _get_org(session_maker, org.id)).purged_at is not None


# ── list view exposes retention metadata ─────────────────────────────────────


async def test_list_deleted_orgs_exposes_retention_fields(
    fake_storage_client: tuple[AsyncClient, FakeStorage],
    session: AsyncSession,
) -> None:
    client, _ = fake_storage_client
    token = await _superadmin_token(client, session)
    eligible = await _seed_org(
        session, "Eligible", status=OrganizationStatus.deleted, deleted_days_ago=40
    )
    retained = await _seed_org(
        session, "Retained", status=OrganizationStatus.deleted, deleted_days_ago=1
    )

    resp = await client.get(
        "/admin/organizations?include_deleted=true&status=deleted", headers=_auth(token)
    )
    assert resp.status_code == 200, resp.text
    by_id = {o["id"]: o for o in resp.json()}

    assert by_id[str(eligible.id)]["is_purge_eligible"] is True
    assert by_id[str(eligible.id)]["purge_eligible_at"] is not None
    assert by_id[str(retained.id)]["is_purge_eligible"] is False
