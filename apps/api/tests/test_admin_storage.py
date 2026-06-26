"""Active-storage tracking: computation, API fields, limit enforcement.

The test conftest places ALL tables (master + tenant) in the ``public``
schema. ``compute_active_storage_gb`` does
``SET LOCAL search_path = "<org_schema>", public`` — the non-existent
org schema is silently skipped and tables resolve to ``public``.  This
means every org in a test run "sees" the same public tables, so we
test one org at a time and rely on per-test truncation for isolation.
"""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

import pytest
from fastapi_users.password import PasswordHelper
from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from bimdossier_api.models.organization import Organization, OrganizationStatus
from bimdossier_api.models.organization_member import (
    OrganizationMember,
    OrganizationMemberStatus,
)
from bimdossier_api.models.user import User
from bimdossier_api.tenancy import schema_name_for
from tests.conftest import _audit_rows

PASSWORD = "correct-horse-battery"
_GB = 1024**3


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _login(client: AsyncClient, email: str) -> str:
    resp = await client.post(
        "/auth/jwt/login",
        data={"username": email, "password": PASSWORD},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["access_token"]


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
    active_storage_limit_gb: int | None = None,
) -> Organization:
    org_id = uuid4()
    org = Organization(
        id=org_id,
        name=name,
        schema_name=schema_name_for(org_id),
        status=OrganizationStatus.active,
        seat_limit=seat_limit,
        active_storage_limit_gb=active_storage_limit_gb,
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
        status=OrganizationMemberStatus.active,
        accepted_at=datetime.now(timezone.utc),
    )
    session.add(member)
    await session.commit()
    return user, member


async def _make_project(session: AsyncSession, owner_id) -> str:
    """Insert a minimal project row and return its id as string."""
    pid = str(uuid4())
    await session.execute(
        text(
            "INSERT INTO projects (id, name, owner_id) VALUES (:id, :name, :owner)"
        ),
        {"id": pid, "name": "TestProject", "owner": str(owner_id)},
    )
    await session.commit()
    return pid


async def _insert_project_file(
    session: AsyncSession, *, project_id: str, size_bytes: int,
    status: str = "ready", deleted: bool = False,
) -> None:
    await session.execute(
        text(
            "INSERT INTO project_files "
            "(id, project_id, role, file_type, status, extraction_status, "
            " storage_key, original_filename, size_bytes, content_type, deleted_at) "
            "VALUES (:id, :pid, 'attachment', 'pdf', :status, 'not_started', "
            " :key, 'test.pdf', :sz, 'application/pdf', :del)"
        ),
        {
            "id": str(uuid4()),
            "pid": project_id,
            "status": status,
            "key": f"files/{uuid4()}",
            "sz": size_bytes,
            "del": datetime.now(timezone.utc) if deleted else None,
        },
    )
    await session.commit()


async def _insert_certificate(
    session: AsyncSession, *, project_id: str, size_bytes: int,
    status: str = "ready", deleted: bool = False,
) -> None:
    await session.execute(
        text(
            "INSERT INTO certificates "
            "(id, project_id, certificate_type, status, "
            " storage_key, original_filename, size_bytes, content_type, deleted_at) "
            "VALUES (:id, :pid, 'product', :status, "
            " :key, 'cert.pdf', :sz, 'application/pdf', :del)"
        ),
        {
            "id": str(uuid4()),
            "pid": project_id,
            "status": status,
            "key": f"certs/{uuid4()}",
            "sz": size_bytes,
            "del": datetime.now(timezone.utc) if deleted else None,
        },
    )
    await session.commit()


async def _insert_org_certificate(
    session: AsyncSession, *, size_bytes: int,
    status: str = "ready", deleted: bool = False,
) -> None:
    await session.execute(
        text(
            "INSERT INTO org_certificates "
            "(id, certificate_type, status, "
            " storage_key, original_filename, size_bytes, content_type, deleted_at) "
            "VALUES (:id, 'product', :status, "
            " :key, 'org_cert.pdf', :sz, 'application/pdf', :del)"
        ),
        {
            "id": str(uuid4()),
            "status": status,
            "key": f"org_certs/{uuid4()}",
            "sz": size_bytes,
            "del": datetime.now(timezone.utc) if deleted else None,
        },
    )
    await session.commit()


async def _insert_report(
    session: AsyncSession, *, project_id: str, byte_size: int | None,
    status: str = "ready",
) -> None:
    await session.execute(
        text(
            "INSERT INTO reports "
            "(id, project_id, report_type, status, title, locale, params, byte_size) "
            "VALUES (:id, :pid, 'compliance_report', :status, 'Report', 'en', '{}', :sz)"
        ),
        {
            "id": str(uuid4()),
            "pid": project_id,
            "status": status,
            "sz": byte_size,
        },
    )
    await session.commit()


# ── Fixtures ──────────────────────────────────────────────────────────

@pytest.fixture
async def superadmin(client: AsyncClient, session: AsyncSession) -> dict[str, str]:
    user = await _make_superuser(session, "storage-root@example.com")
    token = await _login(client, user.email)
    return {"token": token, "user_id": str(user.id), "email": user.email}


@pytest.fixture
async def owner(session: AsyncSession) -> User:
    """A plain verified user to own projects."""
    user = User(
        email="owner@storage-test.example",
        hashed_password=PasswordHelper().hash(PASSWORD),
        full_name="Owner",
        is_active=True,
        is_verified=True,
        is_superuser=False,
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user


# ── compute_active_storage_gb ─────────────────────────────────────────


async def test_compute_empty_returns_zero(
    session: AsyncSession,
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    from bimdossier_api.admin.storage import compute_active_storage_gb

    org = await _make_org(session, name="EmptyOrg")
    result = await compute_active_storage_gb(session_maker, org.schema_name)
    assert result == 0.0


async def test_compute_sums_ready_files(
    session: AsyncSession,
    session_maker: async_sessionmaker[AsyncSession],
    owner: User,
) -> None:
    from bimdossier_api.admin.storage import compute_active_storage_gb

    org = await _make_org(session, name="SumOrg")
    pid = await _make_project(session, owner.id)

    await _insert_project_file(session, project_id=pid, size_bytes=2 * _GB)
    await _insert_certificate(session, project_id=pid, size_bytes=1 * _GB)
    await _insert_org_certificate(session, size_bytes=_GB // 2)
    await _insert_report(session, project_id=pid, byte_size=_GB // 2)

    result = await compute_active_storage_gb(session_maker, org.schema_name)
    assert result == 4.0


async def test_compute_excludes_deleted_files(
    session: AsyncSession,
    session_maker: async_sessionmaker[AsyncSession],
    owner: User,
) -> None:
    from bimdossier_api.admin.storage import compute_active_storage_gb

    org = await _make_org(session, name="DelOrg")
    pid = await _make_project(session, owner.id)

    await _insert_project_file(session, project_id=pid, size_bytes=_GB, deleted=True)
    await _insert_certificate(session, project_id=pid, size_bytes=_GB, deleted=True)
    await _insert_org_certificate(session, size_bytes=_GB, deleted=True)

    result = await compute_active_storage_gb(session_maker, org.schema_name)
    assert result == 0.0


async def test_compute_excludes_non_ready_files(
    session: AsyncSession,
    session_maker: async_sessionmaker[AsyncSession],
    owner: User,
) -> None:
    from bimdossier_api.admin.storage import compute_active_storage_gb

    org = await _make_org(session, name="PendingOrg")
    pid = await _make_project(session, owner.id)

    await _insert_project_file(session, project_id=pid, size_bytes=_GB, status="pending")
    await _insert_project_file(session, project_id=pid, size_bytes=_GB, status="rejected")
    await _insert_certificate(session, project_id=pid, size_bytes=_GB, status="pending")
    await _insert_report(session, project_id=pid, byte_size=_GB, status="queued")
    await _insert_report(session, project_id=pid, byte_size=_GB, status="failed")

    result = await compute_active_storage_gb(session_maker, org.schema_name)
    assert result == 0.0


async def test_compute_reports_with_null_byte_size_ignored(
    session: AsyncSession,
    session_maker: async_sessionmaker[AsyncSession],
    owner: User,
) -> None:
    from bimdossier_api.admin.storage import compute_active_storage_gb

    org = await _make_org(session, name="NullReportOrg")
    pid = await _make_project(session, owner.id)

    await _insert_report(session, project_id=pid, byte_size=None, status="ready")
    await _insert_project_file(session, project_id=pid, size_bytes=_GB)

    result = await compute_active_storage_gb(session_maker, org.schema_name)
    assert result == 1.0


# ── assert_storage_limit_not_below_usage ──────────────────────────────


async def test_assert_storage_limit_raises_when_below_usage(
    session: AsyncSession,
    session_maker: async_sessionmaker[AsyncSession],
    owner: User,
) -> None:
    from fastapi import HTTPException

    from bimdossier_api.admin.storage import assert_storage_limit_not_below_usage

    org = await _make_org(session, name="OverOrg", active_storage_limit_gb=10)
    pid = await _make_project(session, owner.id)
    await _insert_project_file(session, project_id=pid, size_bytes=5 * _GB)

    with pytest.raises(HTTPException) as exc_info:
        await assert_storage_limit_not_below_usage(session_maker, org, 2)
    assert exc_info.value.status_code == 409
    assert exc_info.value.detail == "STORAGE_LIMIT_BELOW_USAGE"


async def test_assert_storage_limit_passes_when_above_usage(
    session: AsyncSession,
    session_maker: async_sessionmaker[AsyncSession],
    owner: User,
) -> None:
    from bimdossier_api.admin.storage import assert_storage_limit_not_below_usage

    org = await _make_org(session, name="OkOrg", active_storage_limit_gb=10)
    pid = await _make_project(session, owner.id)
    await _insert_project_file(session, project_id=pid, size_bytes=2 * _GB)

    await assert_storage_limit_not_below_usage(session_maker, org, 5)


# ── API endpoints — storage fields in responses ──────────────────────


async def test_list_orgs_includes_storage_fields(
    client: AsyncClient, session: AsyncSession, superadmin: dict[str, str],
) -> None:
    await _make_org(session, name="ListStorageA", active_storage_limit_gb=10)
    await _make_org(session, name="ListStorageB", active_storage_limit_gb=None)

    resp = await client.get(
        "/admin/organizations", headers=_auth(superadmin["token"]),
    )
    assert resp.status_code == 200, resp.text
    by_name = {r["name"]: r for r in resp.json()}
    assert by_name["ListStorageA"]["active_storage_limit_gb"] == 10
    assert isinstance(by_name["ListStorageA"]["active_storage_used_gb"], (int, float))
    assert by_name["ListStorageB"]["active_storage_limit_gb"] is None
    assert isinstance(by_name["ListStorageB"]["active_storage_used_gb"], (int, float))


async def test_get_org_includes_storage_fields(
    client: AsyncClient, session: AsyncSession, superadmin: dict[str, str],
) -> None:
    org = await _make_org(session, name="GetStorageOrg", active_storage_limit_gb=5)

    resp = await client.get(
        f"/admin/organizations/{org.id}", headers=_auth(superadmin["token"]),
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["active_storage_limit_gb"] == 5
    assert isinstance(body["active_storage_used_gb"], (int, float))


# ── PATCH /admin/organizations — storage_limit changes ────────────────


async def test_patch_storage_limit_audited(
    client: AsyncClient,
    session: AsyncSession,
    session_maker: async_sessionmaker[AsyncSession],
    superadmin: dict[str, str],
) -> None:
    org = await _make_org(session, name="AuditStorageCo", active_storage_limit_gb=5)

    patch = await client.patch(
        f"/admin/organizations/{org.id}",
        json={"active_storage_limit_gb": 20},
        headers=_auth(superadmin["token"]),
    )
    assert patch.status_code == 200, patch.text
    assert patch.json()["active_storage_limit_gb"] == 20

    entries = await _audit_rows(session_maker, "organization.storage_limit_changed")
    assert len(entries) == 1
    assert entries[0].before is not None and entries[0].before["active_storage_limit_gb"] == 5
    assert entries[0].after is not None and entries[0].after["active_storage_limit_gb"] == 20


async def test_patch_storage_limit_to_null_clears_cap(
    client: AsyncClient, session: AsyncSession, superadmin: dict[str, str],
) -> None:
    org = await _make_org(session, name="UncapStorageCo", active_storage_limit_gb=10)

    patch = await client.patch(
        f"/admin/organizations/{org.id}",
        json={"active_storage_limit_gb": None},
        headers=_auth(superadmin["token"]),
    )
    assert patch.status_code == 200
    assert patch.json()["active_storage_limit_gb"] is None


async def test_patch_storage_limit_below_usage_rejected(
    client: AsyncClient,
    session: AsyncSession,
    superadmin: dict[str, str],
    owner: User,
) -> None:
    org = await _make_org(session, name="ShrinkStorageCo", active_storage_limit_gb=10)
    pid = await _make_project(session, owner.id)
    await _insert_project_file(session, project_id=pid, size_bytes=5 * _GB)

    patch = await client.patch(
        f"/admin/organizations/{org.id}",
        json={"active_storage_limit_gb": 1},
        headers=_auth(superadmin["token"]),
    )
    assert patch.status_code == 409
    assert patch.json()["detail"] == "STORAGE_LIMIT_BELOW_USAGE"


async def test_patch_only_name_does_not_touch_storage_limit(
    client: AsyncClient, session: AsyncSession, superadmin: dict[str, str],
) -> None:
    org = await _make_org(session, name="StableStorageCo", active_storage_limit_gb=15)

    patch = await client.patch(
        f"/admin/organizations/{org.id}",
        json={"name": "StableStorageCo Renamed"},
        headers=_auth(superadmin["token"]),
    )
    assert patch.status_code == 200, patch.text
    assert patch.json()["active_storage_limit_gb"] == 15


# ── /auth/me — storage fields for sidebar ─────────────────────────────


async def test_me_includes_storage_fields(
    client: AsyncClient, session: AsyncSession,
) -> None:
    org = await _make_org(session, name="MeStorageCo", active_storage_limit_gb=8)
    user, _ = await _add_member(
        session, org=org, email="alice@mestorage.example",
    )

    token = await _login(client, user.email)
    resp = await client.get("/auth/me", headers=_auth(token))
    assert resp.status_code == 200
    memberships = resp.json()["memberships"]
    assert len(memberships) == 1
    assert memberships[0]["active_storage_limit_gb"] == 8
    assert isinstance(memberships[0]["active_storage_used_gb"], (int, float))
