"""Integration tests for project document storage.

Storage is mocked via dependency override so tests run without MinIO.
Shared fixtures (FakeStorage, fake_storage_client, _auth, _create_project,
_add_member, _new_hash) live in conftest.py.
"""

from __future__ import annotations

from typing import TYPE_CHECKING
from uuid import uuid4

import pytest
from sqlalchemy import select

from bimstitch_api.models.audit_log import AuditLog
from tests.conftest import (
    FakeStorage,
    _add_member,
    _auth,
    _create_project,
    _new_hash,
)

if TYPE_CHECKING:
    from httpx import AsyncClient
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker


def _doc_payload(**overrides: object) -> dict[str, object]:
    base: dict[str, object] = {
        "filename": "photo.jpg",
        "size_bytes": 2048,
        "content_type": "image/jpeg",
        "content_sha256": _new_hash(),
    }
    base.update(overrides)
    return base


async def _initiate_doc(
    client: AsyncClient,
    token: str,
    project_id: str,
    **overrides: object,
) -> dict:
    resp = await client.post(
        f"/projects/{project_id}/documents/initiate",
        json=_doc_payload(**overrides),
        headers=_auth(token),
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _complete_doc(
    client: AsyncClient,
    fake: FakeStorage,
    token: str,
    project_id: str,
    doc: dict,
    size: int = 2048,
) -> dict:
    fake.objects[doc["storage_key"]] = b"x" * size
    resp = await client.post(
        f"/projects/{project_id}/documents/{doc['document_id']}/complete",
        headers=_auth(token),
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


async def _latest_audit(
    session_maker: async_sessionmaker[AsyncSession], action: str
) -> AuditLog | None:
    async with session_maker() as s:
        row = (
            await s.execute(
                select(AuditLog)
                .where(AuditLog.action == action)
                .order_by(AuditLog.created_at.desc())
                .limit(1)
            )
        ).scalar_one_or_none()
    return row


# ---------------------------------------------------------------------------
# Initiate
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_initiate_succeeds(
    org_user: dict[str, str],
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, fake = fake_storage_client
    project = await _create_project(client, org_user["access_token"])
    body = await _initiate_doc(client, org_user["access_token"], project["id"])
    assert body["upload_url"].startswith("http://fake-storage/")
    assert body["storage_key"].startswith(f"projects/{project['id']}/documents/")
    assert body["storage_key"].endswith(".jpg")
    assert "document_id" in body
    assert body["expires_in"] == fake.presign_ttl_value


@pytest.mark.asyncio
async def test_initiate_rejects_bad_extension(
    org_user: dict[str, str],
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, _ = fake_storage_client
    project = await _create_project(client, org_user["access_token"])
    resp = await client.post(
        f"/projects/{project['id']}/documents/initiate",
        json=_doc_payload(filename="evil.exe"),
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 400
    assert resp.json()["detail"]["code"] == "INVALID_FILE_EXTENSION"


@pytest.mark.asyncio
async def test_initiate_rejects_oversized_file(
    org_user: dict[str, str],
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, _ = fake_storage_client
    project = await _create_project(client, org_user["access_token"])
    resp = await client.post(
        f"/projects/{project['id']}/documents/initiate",
        json=_doc_payload(size_bytes=999_999_999_999),
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 413
    assert resp.json()["detail"]["code"] == "FILE_TOO_LARGE"


@pytest.mark.asyncio
async def test_initiate_rejects_duplicate_sha256(
    org_user: dict[str, str],
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, _ = fake_storage_client
    project = await _create_project(client, org_user["access_token"])
    sha = _new_hash()
    await _initiate_doc(client, org_user["access_token"], project["id"], content_sha256=sha)
    resp = await client.post(
        f"/projects/{project['id']}/documents/initiate",
        json=_doc_payload(content_sha256=sha, filename="dupe.jpg"),
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 409
    assert resp.json()["detail"]["code"] == "DUPLICATE_CONTENT"


@pytest.mark.asyncio
async def test_initiate_emits_audit(
    org_user: dict[str, str],
    fake_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    client, _ = fake_storage_client
    project = await _create_project(client, org_user["access_token"])
    await _initiate_doc(client, org_user["access_token"], project["id"])
    row = await _latest_audit(session_maker, "document.initiated")
    assert row is not None
    assert row.resource_type == "documents"
    assert row.after is not None
    assert row.after["original_filename"] == "photo.jpg"
    assert row.after["document_category"] == "image"


# ---------------------------------------------------------------------------
# Complete
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_complete_sets_ready(
    org_user: dict[str, str],
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, fake = fake_storage_client
    project = await _create_project(client, org_user["access_token"])
    doc = await _initiate_doc(client, org_user["access_token"], project["id"])
    body = await _complete_doc(client, fake, org_user["access_token"], project["id"], doc)
    assert body["status"] == "ready"


@pytest.mark.asyncio
async def test_complete_rejects_size_mismatch(
    org_user: dict[str, str],
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, fake = fake_storage_client
    project = await _create_project(client, org_user["access_token"])
    doc = await _initiate_doc(client, org_user["access_token"], project["id"])
    fake.objects[doc["storage_key"]] = b"x" * 999
    resp = await client.post(
        f"/projects/{project['id']}/documents/{doc['document_id']}/complete",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 422
    assert resp.json()["detail"] == "SIZE_MISMATCH"


@pytest.mark.asyncio
async def test_complete_rejects_missing_object(
    org_user: dict[str, str],
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, _ = fake_storage_client
    project = await _create_project(client, org_user["access_token"])
    doc = await _initiate_doc(client, org_user["access_token"], project["id"])
    resp = await client.post(
        f"/projects/{project['id']}/documents/{doc['document_id']}/complete",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 422
    assert resp.json()["detail"] == "OBJECT_NOT_UPLOADED"


@pytest.mark.asyncio
async def test_complete_emits_audit(
    org_user: dict[str, str],
    fake_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    client, fake = fake_storage_client
    project = await _create_project(client, org_user["access_token"])
    doc = await _initiate_doc(client, org_user["access_token"], project["id"])
    await _complete_doc(client, fake, org_user["access_token"], project["id"], doc)
    row = await _latest_audit(session_maker, "document.completed")
    assert row is not None
    assert row.resource_type == "documents"
    assert row.before is not None
    assert row.after is not None
    assert row.before["status"] == "pending"
    assert row.after["status"] == "ready"


# ---------------------------------------------------------------------------
# List / Get / Download
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_returns_only_ready_documents(
    org_user: dict[str, str],
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, fake = fake_storage_client
    project = await _create_project(client, org_user["access_token"])
    doc1 = await _initiate_doc(client, org_user["access_token"], project["id"])
    await _complete_doc(client, fake, org_user["access_token"], project["id"], doc1)
    await _initiate_doc(client, org_user["access_token"], project["id"])
    resp = await client.get(
        f"/projects/{project['id']}/documents",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 200
    docs = resp.json()
    assert len(docs) == 1
    assert docs[0]["status"] == "ready"


@pytest.mark.asyncio
async def test_list_filters_by_category(
    org_user: dict[str, str],
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, fake = fake_storage_client
    project = await _create_project(client, org_user["access_token"])
    img = await _initiate_doc(client, org_user["access_token"], project["id"], filename="a.jpg")
    await _complete_doc(client, fake, org_user["access_token"], project["id"], img)
    pdf = await _initiate_doc(client, org_user["access_token"], project["id"], filename="b.pdf")
    await _complete_doc(client, fake, org_user["access_token"], project["id"], pdf)
    resp = await client.get(
        f"/projects/{project['id']}/documents?category=image",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 200
    assert len(resp.json()) == 1
    assert resp.json()[0]["document_category"] == "image"


@pytest.mark.asyncio
async def test_get_single_document(
    org_user: dict[str, str],
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, fake = fake_storage_client
    project = await _create_project(client, org_user["access_token"])
    doc = await _initiate_doc(client, org_user["access_token"], project["id"])
    resp = await client.get(
        f"/projects/{project['id']}/documents/{doc['document_id']}",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 200
    assert resp.json()["original_filename"] == "photo.jpg"


@pytest.mark.asyncio
async def test_download_returns_presigned_url(
    org_user: dict[str, str],
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, fake = fake_storage_client
    project = await _create_project(client, org_user["access_token"])
    doc = await _initiate_doc(client, org_user["access_token"], project["id"])
    await _complete_doc(client, fake, org_user["access_token"], project["id"], doc)
    resp = await client.get(
        f"/projects/{project['id']}/documents/{doc['document_id']}/download",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 200
    assert "download_url" in resp.json()


@pytest.mark.asyncio
async def test_download_rejects_pending_document(
    org_user: dict[str, str],
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, _ = fake_storage_client
    project = await _create_project(client, org_user["access_token"])
    doc = await _initiate_doc(client, org_user["access_token"], project["id"])
    resp = await client.get(
        f"/projects/{project['id']}/documents/{doc['document_id']}/download",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 409
    assert resp.json()["detail"] == "DOCUMENT_NOT_READY"


# ---------------------------------------------------------------------------
# Update (PATCH)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_update_description(
    org_user: dict[str, str],
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, _ = fake_storage_client
    project = await _create_project(client, org_user["access_token"])
    doc = await _initiate_doc(client, org_user["access_token"], project["id"])
    resp = await client.patch(
        f"/projects/{project['id']}/documents/{doc['document_id']}",
        json={"description": "Updated description"},
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 200
    assert resp.json()["description"] == "Updated description"


@pytest.mark.asyncio
async def test_update_emits_audit(
    org_user: dict[str, str],
    fake_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    client, _ = fake_storage_client
    project = await _create_project(client, org_user["access_token"])
    doc = await _initiate_doc(client, org_user["access_token"], project["id"])
    await client.patch(
        f"/projects/{project['id']}/documents/{doc['document_id']}",
        json={"description": "New desc"},
        headers=_auth(org_user["access_token"]),
    )
    row = await _latest_audit(session_maker, "document.updated")
    assert row is not None
    assert row.resource_type == "documents"
    assert row.before is not None
    assert row.after is not None
    assert row.after["description"] == "New desc"


# ---------------------------------------------------------------------------
# Delete (soft)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_delete_soft_deletes(
    org_user: dict[str, str],
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, _ = fake_storage_client
    project = await _create_project(client, org_user["access_token"])
    doc = await _initiate_doc(client, org_user["access_token"], project["id"])
    resp = await client.delete(
        f"/projects/{project['id']}/documents/{doc['document_id']}",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 204
    resp2 = await client.get(
        f"/projects/{project['id']}/documents/{doc['document_id']}",
        headers=_auth(org_user["access_token"]),
    )
    assert resp2.status_code == 404


@pytest.mark.asyncio
async def test_delete_emits_audit(
    org_user: dict[str, str],
    fake_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    client, _ = fake_storage_client
    project = await _create_project(client, org_user["access_token"])
    doc = await _initiate_doc(client, org_user["access_token"], project["id"])
    await client.delete(
        f"/projects/{project['id']}/documents/{doc['document_id']}",
        headers=_auth(org_user["access_token"]),
    )
    row = await _latest_audit(session_maker, "document.deleted")
    assert row is not None
    assert row.resource_type == "documents"
    assert row.before is not None
    assert row.after is None


# ---------------------------------------------------------------------------
# Permissions — viewer cannot initiate
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_viewer_cannot_initiate_document(
    org_user: dict[str, str],
    same_org_non_admin_user: dict[str, str],
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, _ = fake_storage_client
    project = await _create_project(client, org_user["access_token"])
    await _add_member(
        client,
        org_user["access_token"],
        project["id"],
        same_org_non_admin_user["id"],
        "viewer",
    )
    resp = await client.post(
        f"/projects/{project['id']}/documents/initiate",
        json=_doc_payload(),
        headers=_auth(same_org_non_admin_user["access_token"]),
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_viewer_cannot_delete_document(
    org_user: dict[str, str],
    same_org_non_admin_user: dict[str, str],
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, _ = fake_storage_client
    project = await _create_project(client, org_user["access_token"])
    doc = await _initiate_doc(client, org_user["access_token"], project["id"])
    await _add_member(
        client,
        org_user["access_token"],
        project["id"],
        same_org_non_admin_user["id"],
        "viewer",
    )
    resp = await client.delete(
        f"/projects/{project['id']}/documents/{doc['document_id']}",
        headers=_auth(same_org_non_admin_user["access_token"]),
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_viewer_can_list_documents(
    org_user: dict[str, str],
    same_org_non_admin_user: dict[str, str],
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, fake = fake_storage_client
    project = await _create_project(client, org_user["access_token"])
    doc = await _initiate_doc(client, org_user["access_token"], project["id"])
    await _complete_doc(client, fake, org_user["access_token"], project["id"], doc)
    await _add_member(
        client,
        org_user["access_token"],
        project["id"],
        same_org_non_admin_user["id"],
        "viewer",
    )
    resp = await client.get(
        f"/projects/{project['id']}/documents",
        headers=_auth(same_org_non_admin_user["access_token"]),
    )
    assert resp.status_code == 200
    assert len(resp.json()) == 1


# ---------------------------------------------------------------------------
# Not found
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_nonexistent_document_404(
    org_user: dict[str, str],
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, _ = fake_storage_client
    project = await _create_project(client, org_user["access_token"])
    resp = await client.get(
        f"/projects/{project['id']}/documents/{uuid4()}",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Multiple file types
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "filename,expected_category",
    [
        ("photo.jpg", "image"),
        ("photo.png", "image"),
        ("video.mp4", "video"),
        ("audio.mp3", "audio"),
        ("report.pdf", "office"),
        ("sheet.xlsx", "office"),
    ],
)
async def test_initiate_categorizes_file_types(
    org_user: dict[str, str],
    fake_storage_client: tuple[AsyncClient, FakeStorage],
    filename: str,
    expected_category: str,
) -> None:
    client, _ = fake_storage_client
    project = await _create_project(client, org_user["access_token"])
    doc = await _initiate_doc(
        client, org_user["access_token"], project["id"], filename=filename
    )
    detail = await client.get(
        f"/projects/{project['id']}/documents/{doc['document_id']}",
        headers=_auth(org_user["access_token"]),
    )
    assert detail.json()["document_category"] == expected_category
