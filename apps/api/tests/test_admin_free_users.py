"""Super-admin free-tier account management.

Covers GET /admin/users/free (list + usage), GET /admin/users/free/{id}
(drill-down), and the account-recovery endpoints
(/admin/users/{id}/send-password-reset, /resend-activation).

Free content is the paid-mirror stack: PooledProject -> PooledDocument (container)
-> PooledProjectFile (versions), plus PooledFinding. Usage mirrors the authoritative
quota in routers/pooled_documents.py (storage = active file bytes; containers =
active pooled_documents). Rows are inserted directly via the `session` fixture
(the master, RLS-bypassing session) — the shortcut the other admin tests use.
"""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

import pytest
from fastapi_users.password import PasswordHelper
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from bimdossier_api.models.pooled_document import PooledDocument
from bimdossier_api.models.pooled_finding import PooledFinding
from bimdossier_api.models.pooled_project import PooledProject
from bimdossier_api.models.pooled_project_file import PooledProjectFile
from bimdossier_api.models.pooled_project_member import PooledProjectMember
from bimdossier_api.models.organization import Organization, OrganizationStatus
from bimdossier_api.models.organization_member import (
    OrganizationMember,
    OrganizationMemberStatus,
)
from bimdossier_api.models.user import User
from bimdossier_api.tenancy import schema_name_for
from tests.conftest import _audit_rows

PASSWORD = "correct-horse-battery"


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _login(client: AsyncClient, email: str) -> dict[str, str]:
    resp = await client.post(
        "/auth/jwt/login", data={"username": email, "password": PASSWORD}
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


async def _make_user(
    session: AsyncSession,
    email: str,
    *,
    is_superuser: bool = False,
    is_active: bool = True,
    is_verified: bool = True,
    anonymized: bool = False,
) -> User:
    user = User(
        email=email,
        hashed_password=PasswordHelper().hash(PASSWORD),
        full_name=email.split("@")[0],
        is_active=is_active,
        is_verified=is_verified,
        is_superuser=is_superuser,
        anonymized_at=datetime.now(UTC) if anonymized else None,
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user


async def _add_org_membership(
    session: AsyncSession,
    user: User,
    *,
    status_val: OrganizationMemberStatus = OrganizationMemberStatus.active,
) -> Organization:
    org_id = uuid4()
    org = Organization(
        id=org_id,
        name=f"Org-{org_id.hex[:8]}",
        schema_name=schema_name_for(org_id),
        status=OrganizationStatus.active,
        provisioned_at=datetime.now(UTC),
    )
    session.add(org)
    await session.flush()
    session.add(
        OrganizationMember(
            user_id=user.id,
            organization_id=org.id,
            status=status_val,
            accepted_at=datetime.now(UTC),
        )
    )
    await session.commit()
    return org


async def _make_free_project(session: AsyncSession, owner: User, name: str) -> PooledProject:
    project = PooledProject(owner_user_id=owner.id, name=name)
    session.add(project)
    await session.commit()
    await session.refresh(project)
    return project


async def _make_free_document(
    session: AsyncSession, owner: User, project: PooledProject, name: str = "Container"
) -> PooledDocument:
    doc = PooledDocument(owner_user_id=owner.id, pooled_project_id=project.id, name=name)
    session.add(doc)
    await session.commit()
    await session.refresh(doc)
    return doc


async def _make_free_file(
    session: AsyncSession,
    owner: User,
    document: PooledDocument,
    *,
    size_bytes: int,
    version_number: int = 1,
    deleted: bool = False,
) -> PooledProjectFile:
    f = PooledProjectFile(
        owner_user_id=owner.id,
        pooled_document_id=document.id,
        version_number=version_number,
        storage_key=f"free/{owner.id}/{document.id}/{uuid4()}.ifc",
        original_filename="model.ifc",
        size_bytes=size_bytes,
        status="ready",
        deleted_at=datetime.now(UTC) if deleted else None,
    )
    session.add(f)
    await session.commit()
    await session.refresh(f)
    return f


async def _make_free_finding(
    session: AsyncSession, owner: User, doc: PooledDocument, title: str
) -> PooledFinding:
    snag = PooledFinding(pooled_document_id=doc.id, owner_user_id=owner.id, title=title)
    session.add(snag)
    await session.commit()
    return snag


async def _add_free_member(
    session: AsyncSession, project: PooledProject, user: User, role: str = "viewer"
) -> None:
    session.add(
        PooledProjectMember(pooled_project_id=project.id, user_id=user.id, role=role)
    )
    await session.commit()


@pytest.fixture
async def superadmin(client: AsyncClient, session: AsyncSession) -> dict[str, str]:
    user = await _make_user(session, "root@example.com", is_superuser=True)
    tokens = await _login(client, user.email)
    return {"token": tokens["access_token"], "user_id": str(user.id)}


# ---------------------------------------------------------------------------
# Listing — who is a free user
# ---------------------------------------------------------------------------


async def test_lists_only_org_less_users(
    client: AsyncClient, session: AsyncSession, superadmin: dict[str, str]
) -> None:
    await _make_user(session, "free@example.com")
    paid = await _make_user(session, "paid@example.com")
    await _add_org_membership(session, paid)
    # A user whose only membership is `removed` is still free.
    formerly = await _make_user(session, "formerly@example.com")
    await _add_org_membership(
        session, formerly, status_val=OrganizationMemberStatus.removed
    )

    resp = await client.get("/admin/users/free", headers=_auth(superadmin["token"]))
    assert resp.status_code == 200, resp.text
    emails = {row["email"] for row in resp.json()}
    assert "free@example.com" in emails
    assert "formerly@example.com" in emails
    assert "paid@example.com" not in emails
    # The superadmin itself is org-less, so it's also a "free" account here.
    assert "root@example.com" in emails


async def test_excludes_anonymized_users(
    client: AsyncClient, session: AsyncSession, superadmin: dict[str, str]
) -> None:
    await _make_user(session, "ghost@example.com", anonymized=True)
    resp = await client.get("/admin/users/free", headers=_auth(superadmin["token"]))
    assert resp.status_code == 200
    assert "ghost@example.com" not in {row["email"] for row in resp.json()}


async def test_usage_numbers_correct_no_fanout(
    client: AsyncClient, session: AsyncSession, superadmin: dict[str, str]
) -> None:
    """Owner with 2 projects, 2 containers, 3 active files (100/200/300), 4
    snags, member of 1 other project, plus a SOFT-DELETED file (999) that must
    be excluded. The multi-relation case must NOT inflate (storage stays 600)."""
    owner = await _make_user(session, "owner@example.com")
    p1 = await _make_free_project(session, owner, "P1")
    await _make_free_project(session, owner, "P2")
    d1 = await _make_free_document(session, owner, p1, "D1")
    d2 = await _make_free_document(session, owner, p1, "D2")
    await _make_free_file(session, owner, d1, size_bytes=100, version_number=1)
    await _make_free_file(session, owner, d1, size_bytes=200, version_number=2)
    await _make_free_file(session, owner, d2, size_bytes=300, version_number=1)
    # Soft-deleted version must not count toward storage.
    await _make_free_file(
        session, owner, d1, size_bytes=999, version_number=3, deleted=True
    )
    for i in range(4):
        await _make_free_finding(session, owner, d1, f"snag {i}")

    other = await _make_user(session, "other@example.com")
    other_proj = await _make_free_project(session, other, "Shared")
    await _add_free_member(session, other_proj, owner)

    resp = await client.get(
        "/admin/users/free?q=owner@example.com", headers=_auth(superadmin["token"])
    )
    assert resp.status_code == 200, resp.text
    rows = {row["email"]: row for row in resp.json()}
    usage = rows["owner@example.com"]["usage"]
    assert usage["project_count"] == 2
    assert usage["document_count"] == 2
    assert usage["storage_bytes_used"] == 600
    assert usage["snag_count"] == 4
    assert usage["member_of_count"] == 1
    assert usage["storage_bytes_cap"] > 0
    assert usage["project_cap"] == 3
    assert usage["document_cap"] >= 1


async def test_member_only_user_owns_nothing(
    client: AsyncClient, session: AsyncSession, superadmin: dict[str, str]
) -> None:
    owner = await _make_user(session, "host@example.com")
    proj = await _make_free_project(session, owner, "Hosted")
    guest = await _make_user(session, "guest@example.com")
    await _add_free_member(session, proj, guest)

    resp = await client.get(
        "/admin/users/free?q=guest@example.com", headers=_auth(superadmin["token"])
    )
    assert resp.status_code == 200
    row = next(r for r in resp.json() if r["email"] == "guest@example.com")
    assert row["usage"]["project_count"] == 0
    assert row["usage"]["document_count"] == 0
    assert row["usage"]["member_of_count"] == 1


async def test_pagination_and_total_count(
    client: AsyncClient, session: AsyncSession, superadmin: dict[str, str]
) -> None:
    for i in range(4):
        await _make_user(session, f"page{i}@example.com")

    resp = await client.get(
        "/admin/users/free?limit=2&offset=0", headers=_auth(superadmin["token"])
    )
    assert resp.status_code == 200
    # root + 4 page users = 5 free accounts total.
    assert resp.headers["X-Total-Count"] == "5"
    assert len(resp.json()) == 2


async def test_invalid_sort_key_422(
    client: AsyncClient, session: AsyncSession, superadmin: dict[str, str]
) -> None:
    resp = await client.get(
        "/admin/users/free?order_by=bogus", headers=_auth(superadmin["token"])
    )
    assert resp.status_code == 422
    assert resp.json()["detail"].startswith("INVALID_SORT_KEY")


async def test_non_superuser_forbidden(
    client: AsyncClient, session: AsyncSession
) -> None:
    plain = await _make_user(session, "plain@example.com")
    tokens = await _login(client, plain.email)
    resp = await client.get(
        "/admin/users/free", headers=_auth(tokens["access_token"])
    )
    assert resp.status_code == 403


async def test_created_at_present_and_sortable(
    client: AsyncClient, session: AsyncSession, superadmin: dict[str, str]
) -> None:
    await _make_user(session, "fresh@example.com")
    resp = await client.get("/admin/users/free", headers=_auth(superadmin["token"]))
    assert resp.status_code == 200, resp.text
    row = next(r for r in resp.json() if r["email"] == "fresh@example.com")
    assert row["created_at"] is not None

    # `created_at` is an accepted sort key (Created column is server-sortable).
    sorted_resp = await client.get(
        "/admin/users/free?order_by=created_at&order_dir=desc",
        headers=_auth(superadmin["token"]),
    )
    assert sorted_resp.status_code == 200, sorted_resp.text


async def test_last_activity_tracks_content(
    client: AsyncClient, session: AsyncSession, superadmin: dict[str, str]
) -> None:
    """`last_activity_at` is null for an account with no content, and set once
    the account owns content (here: a snag's `updated_at`)."""
    await _make_user(session, "bare@example.com")
    owner = await _make_user(session, "active@example.com")
    p1 = await _make_free_project(session, owner, "P1")
    d1 = await _make_free_document(session, owner, p1, "D1")
    await _make_free_finding(session, owner, d1, "snag")

    resp = await client.get("/admin/users/free", headers=_auth(superadmin["token"]))
    assert resp.status_code == 200, resp.text
    rows = {r["email"]: r for r in resp.json()}
    assert rows["bare@example.com"]["usage"]["last_activity_at"] is None
    assert rows["active@example.com"]["usage"]["last_activity_at"] is not None


# ---------------------------------------------------------------------------
# Detail drill-down
# ---------------------------------------------------------------------------


async def test_detail_returns_content(
    client: AsyncClient, session: AsyncSession, superadmin: dict[str, str]
) -> None:
    owner = await _make_user(session, "detail@example.com")
    p1 = await _make_free_project(session, owner, "Alpha")
    d1 = await _make_free_document(session, owner, p1, "Alpha-Container")
    await _make_free_file(session, owner, d1, size_bytes=100, version_number=1)
    await _make_free_file(session, owner, d1, size_bytes=300, version_number=2)
    await _make_free_finding(session, owner, d1, "leaky pipe")
    host = await _make_user(session, "host2@example.com")
    hosted = await _make_free_project(session, host, "HostProj")
    await _add_free_member(session, hosted, owner, role="editor")

    resp = await client.get(
        f"/admin/users/free/{owner.id}", headers=_auth(superadmin["token"])
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["user"]["email"] == "detail@example.com"
    assert body["user"]["created_at"] is not None
    assert body["user"]["usage"]["document_count"] == 1
    assert len(body["projects"]) == 1
    assert body["projects"][0]["document_count"] == 1
    assert body["projects"][0]["snag_count"] == 1
    assert body["projects"][0]["storage_bytes"] == 400
    assert len(body["documents"]) == 1
    assert body["documents"][0]["file_count"] == 2
    assert body["documents"][0]["size_bytes"] == 400
    assert len(body["snags"]) == 1
    assert len(body["shared_projects"]) == 1
    assert body["shared_projects"][0]["owner_email"] == "host2@example.com"
    assert body["shared_projects"][0]["role"] == "editor"


async def test_detail_404_for_paid_or_unknown(
    client: AsyncClient, session: AsyncSession, superadmin: dict[str, str]
) -> None:
    paid = await _make_user(session, "paiddetail@example.com")
    await _add_org_membership(session, paid)

    paid_resp = await client.get(
        f"/admin/users/free/{paid.id}", headers=_auth(superadmin["token"])
    )
    assert paid_resp.status_code == 404
    assert paid_resp.json()["detail"] == "USER_NOT_FOUND"

    unknown = await client.get(
        f"/admin/users/free/{uuid4()}", headers=_auth(superadmin["token"])
    )
    assert unknown.status_code == 404


# ---------------------------------------------------------------------------
# Account recovery
# ---------------------------------------------------------------------------


async def test_send_password_reset_emails_and_audits(
    client: AsyncClient,
    session: AsyncSession,
    session_maker: async_sessionmaker[AsyncSession],
    superadmin: dict[str, str],
    email_transport: object,
) -> None:
    user = await _make_user(session, "reset@example.com")
    resp = await client.post(
        f"/admin/users/{user.id}/send-password-reset",
        headers=_auth(superadmin["token"]),
    )
    assert resp.status_code == 202, resp.text
    assert email_transport.last_for("reset@example.com") is not None  # type: ignore[attr-defined]
    entries = await _audit_rows(session_maker, "user.password_reset_sent")
    assert any(e.resource_id == str(user.id) for e in entries)


async def test_send_password_reset_rejects_suspended(
    client: AsyncClient, session: AsyncSession, superadmin: dict[str, str]
) -> None:
    user = await _make_user(session, "suspended@example.com", is_active=False)
    resp = await client.post(
        f"/admin/users/{user.id}/send-password-reset",
        headers=_auth(superadmin["token"]),
    )
    assert resp.status_code == 409
    assert resp.json()["detail"] == "USER_INACTIVE"


async def test_resend_activation_for_unverified(
    client: AsyncClient,
    session: AsyncSession,
    session_maker: async_sessionmaker[AsyncSession],
    superadmin: dict[str, str],
    email_transport: object,
) -> None:
    user = await _make_user(session, "pending@example.com", is_verified=False)
    resp = await client.post(
        f"/admin/users/{user.id}/resend-activation",
        headers=_auth(superadmin["token"]),
    )
    assert resp.status_code == 202, resp.text
    assert email_transport.last_for("pending@example.com") is not None  # type: ignore[attr-defined]
    entries = await _audit_rows(session_maker, "user.activation_resent")
    assert any(e.resource_id == str(user.id) for e in entries)


async def test_resend_activation_409_when_verified(
    client: AsyncClient, session: AsyncSession, superadmin: dict[str, str]
) -> None:
    user = await _make_user(session, "alreadyverified@example.com", is_verified=True)
    resp = await client.post(
        f"/admin/users/{user.id}/resend-activation",
        headers=_auth(superadmin["token"]),
    )
    assert resp.status_code == 409
    assert resp.json()["detail"] == "USER_ALREADY_VERIFIED"


async def test_recovery_non_superuser_forbidden(
    client: AsyncClient, session: AsyncSession
) -> None:
    target = await _make_user(session, "rtarget@example.com")
    plain = await _make_user(session, "rplain@example.com")
    tokens = await _login(client, plain.email)
    resp = await client.post(
        f"/admin/users/{target.id}/send-password-reset",
        headers=_auth(tokens["access_token"]),
    )
    assert resp.status_code == 403


# ---------------------------------------------------------------------------
# Suspend reuse (smoke) — soft suspend blocks the free user's next login
# ---------------------------------------------------------------------------


async def test_suspend_free_user_blocks_login(
    client: AsyncClient, session: AsyncSession, superadmin: dict[str, str]
) -> None:
    user = await _make_user(session, "tosuspend@example.com")
    await _login(client, user.email)  # works while active

    resp = await client.post(
        f"/admin/users/{user.id}/deactivate", headers=_auth(superadmin["token"])
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["is_active"] is False

    failed = await client.post(
        "/auth/jwt/login", data={"username": user.email, "password": PASSWORD}
    )
    assert failed.status_code == 400
    assert failed.json()["detail"] == "LOGIN_BAD_CREDENTIALS"
