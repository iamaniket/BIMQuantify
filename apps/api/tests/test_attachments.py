"""Integration tests for project attachment storage.

Storage is mocked via dependency override so tests run without MinIO.
Shared fixtures (FakeStorage, fake_storage_client, _auth, _create_project,
_add_member, _new_hash) live in conftest.py.
"""

from __future__ import annotations

import hashlib
from typing import TYPE_CHECKING
from uuid import uuid4

import pytest

from tests.conftest import (
    FakeStorage,
    _add_member,
    _auth,
    _create_model,
    _create_project,
    _latest_audit,
    _new_hash,
)

SECRET = "dev-shared-secret-change-me"


def _bearer(secret: str = SECRET) -> dict[str, str]:
    return {"Authorization": f"Bearer {secret}"}

if TYPE_CHECKING:
    from httpx import AsyncClient
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker


VALID_IFC_HEADER = (
    b"ISO-10303-21;\nHEADER;\n"
    b"FILE_DESCRIPTION(('ViewDefinition'),'2;1');\n"
    b"FILE_NAME('test.ifc','2026-01-01T00:00:00','','','','','');\n"
    b"FILE_SCHEMA(('IFC4'));\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n"
)

_file_counter = 0


async def _create_ready_file(
    client: AsyncClient,
    fake: FakeStorage,
    token: str,
    project_id: str,
    model_id: str,
) -> str:
    global _file_counter
    _file_counter += 1
    content = VALID_IFC_HEADER + f"\n{_file_counter}".encode()
    sha = hashlib.sha256(content).hexdigest()
    init_resp = await client.post(
        f"/projects/{project_id}/models/{model_id}/files/initiate",
        json={
            "filename": f"test-att-{_file_counter}.ifc",
            "size_bytes": len(content),
            "content_type": "application/octet-stream",
            "content_sha256": sha,
        },
        headers=_auth(token),
    )
    assert init_resp.status_code == 201, init_resp.text
    init = init_resp.json()
    fake.objects[init["storage_key"]] = content
    complete = await client.post(
        f"/projects/{project_id}/models/{model_id}/files/{init['file_id']}/complete",
        headers=_auth(token),
    )
    assert complete.status_code == 200, complete.text
    return init["file_id"]


def _att_payload(**overrides: object) -> dict[str, object]:
    base: dict[str, object] = {
        "filename": "photo.jpg",
        "size_bytes": 2048,
        "content_type": "image/jpeg",
        "content_sha256": _new_hash(),
    }
    base.update(overrides)
    return base


async def _initiate_att(
    client: AsyncClient,
    token: str,
    project_id: str,
    **overrides: object,
) -> dict:
    resp = await client.post(
        f"/projects/{project_id}/attachments/initiate",
        json=_att_payload(**overrides),
        headers=_auth(token),
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _complete_att(
    client: AsyncClient,
    fake: FakeStorage,
    token: str,
    project_id: str,
    att: dict,
    size: int = 2048,
) -> dict:
    fake.objects[att["storage_key"]] = b"x" * size
    resp = await client.post(
        f"/projects/{project_id}/attachments/{att['attachment_id']}/complete",
        headers=_auth(token),
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


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
    body = await _initiate_att(client, org_user["access_token"], project["id"])
    assert body["upload_url"].startswith("http://fake-storage/")
    assert body["storage_key"].startswith(f"projects/{project['id']}/attachments/")
    assert body["storage_key"].endswith(".jpg")
    assert "attachment_id" in body
    assert body["expires_in"] == fake.presign_ttl_value


@pytest.mark.asyncio
async def test_initiate_rejects_bad_extension(
    org_user: dict[str, str],
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, _ = fake_storage_client
    project = await _create_project(client, org_user["access_token"])
    resp = await client.post(
        f"/projects/{project['id']}/attachments/initiate",
        json=_att_payload(filename="evil.exe"),
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
        f"/projects/{project['id']}/attachments/initiate",
        json=_att_payload(size_bytes=999_999_999_999),
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
    await _initiate_att(client, org_user["access_token"], project["id"], content_sha256=sha)
    resp = await client.post(
        f"/projects/{project['id']}/attachments/initiate",
        json=_att_payload(content_sha256=sha, filename="dupe.jpg"),
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
    await _initiate_att(client, org_user["access_token"], project["id"])
    row = await _latest_audit(session_maker, "attachment.initiated")
    assert row is not None
    assert row.resource_type == "attachments"
    assert row.after is not None
    assert row.after["original_filename"] == "photo.jpg"
    assert row.after["attachment_category"] == "image"


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
    att = await _initiate_att(client, org_user["access_token"], project["id"])
    body = await _complete_att(client, fake, org_user["access_token"], project["id"], att)
    assert body["status"] == "ready"


@pytest.mark.asyncio
async def test_complete_rejects_size_mismatch(
    org_user: dict[str, str],
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, fake = fake_storage_client
    project = await _create_project(client, org_user["access_token"])
    att = await _initiate_att(client, org_user["access_token"], project["id"])
    fake.objects[att["storage_key"]] = b"x" * 999
    resp = await client.post(
        f"/projects/{project['id']}/attachments/{att['attachment_id']}/complete",
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
    att = await _initiate_att(client, org_user["access_token"], project["id"])
    resp = await client.post(
        f"/projects/{project['id']}/attachments/{att['attachment_id']}/complete",
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
    att = await _initiate_att(client, org_user["access_token"], project["id"])
    await _complete_att(client, fake, org_user["access_token"], project["id"], att)
    row = await _latest_audit(session_maker, "attachment.completed")
    assert row is not None
    assert row.resource_type == "attachments"
    assert row.before is not None
    assert row.after is not None
    assert row.before["status"] == "pending"
    assert row.after["status"] == "ready"


# ---------------------------------------------------------------------------
# List / Get / Download
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_returns_only_ready_attachments(
    org_user: dict[str, str],
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, fake = fake_storage_client
    project = await _create_project(client, org_user["access_token"])
    att1 = await _initiate_att(client, org_user["access_token"], project["id"])
    await _complete_att(client, fake, org_user["access_token"], project["id"], att1)
    await _initiate_att(client, org_user["access_token"], project["id"])
    resp = await client.get(
        f"/projects/{project['id']}/attachments",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 200
    items = resp.json()
    assert len(items) == 1
    assert items[0]["status"] == "ready"


@pytest.mark.asyncio
async def test_list_filters_by_category(
    org_user: dict[str, str],
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, fake = fake_storage_client
    project = await _create_project(client, org_user["access_token"])
    img = await _initiate_att(client, org_user["access_token"], project["id"], filename="a.jpg")
    await _complete_att(client, fake, org_user["access_token"], project["id"], img)
    pdf = await _initiate_att(client, org_user["access_token"], project["id"], filename="b.pdf")
    await _complete_att(client, fake, org_user["access_token"], project["id"], pdf)
    resp = await client.get(
        f"/projects/{project['id']}/attachments?category=image",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 200
    assert len(resp.json()) == 1
    assert resp.json()[0]["attachment_category"] == "image"


@pytest.mark.asyncio
async def test_get_single_attachment(
    org_user: dict[str, str],
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, fake = fake_storage_client
    project = await _create_project(client, org_user["access_token"])
    att = await _initiate_att(client, org_user["access_token"], project["id"])
    resp = await client.get(
        f"/projects/{project['id']}/attachments/{att['attachment_id']}",
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
    att = await _initiate_att(client, org_user["access_token"], project["id"])
    await _complete_att(client, fake, org_user["access_token"], project["id"], att)
    resp = await client.get(
        f"/projects/{project['id']}/attachments/{att['attachment_id']}/download",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 200
    assert "download_url" in resp.json()


@pytest.mark.asyncio
async def test_download_rejects_pending_attachment(
    org_user: dict[str, str],
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, _ = fake_storage_client
    project = await _create_project(client, org_user["access_token"])
    att = await _initiate_att(client, org_user["access_token"], project["id"])
    resp = await client.get(
        f"/projects/{project['id']}/attachments/{att['attachment_id']}/download",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 409
    assert resp.json()["detail"] == "ATTACHMENT_NOT_READY"


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
    att = await _initiate_att(client, org_user["access_token"], project["id"])
    resp = await client.patch(
        f"/projects/{project['id']}/attachments/{att['attachment_id']}",
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
    att = await _initiate_att(client, org_user["access_token"], project["id"])
    await client.patch(
        f"/projects/{project['id']}/attachments/{att['attachment_id']}",
        json={"description": "New desc"},
        headers=_auth(org_user["access_token"]),
    )
    row = await _latest_audit(session_maker, "attachment.updated")
    assert row is not None
    assert row.resource_type == "attachments"
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
    att = await _initiate_att(client, org_user["access_token"], project["id"])
    resp = await client.delete(
        f"/projects/{project['id']}/attachments/{att['attachment_id']}",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 204
    resp2 = await client.get(
        f"/projects/{project['id']}/attachments/{att['attachment_id']}",
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
    att = await _initiate_att(client, org_user["access_token"], project["id"])
    await client.delete(
        f"/projects/{project['id']}/attachments/{att['attachment_id']}",
        headers=_auth(org_user["access_token"]),
    )
    row = await _latest_audit(session_maker, "attachment.deleted")
    assert row is not None
    assert row.resource_type == "attachments"
    assert row.before is not None
    assert row.after is None


# ---------------------------------------------------------------------------
# Permissions — viewer cannot initiate
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_viewer_cannot_initiate_attachment(
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
        f"/projects/{project['id']}/attachments/initiate",
        json=_att_payload(),
        headers=_auth(same_org_non_admin_user["access_token"]),
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_viewer_cannot_delete_attachment(
    org_user: dict[str, str],
    same_org_non_admin_user: dict[str, str],
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, _ = fake_storage_client
    project = await _create_project(client, org_user["access_token"])
    att = await _initiate_att(client, org_user["access_token"], project["id"])
    await _add_member(
        client,
        org_user["access_token"],
        project["id"],
        same_org_non_admin_user["id"],
        "viewer",
    )
    resp = await client.delete(
        f"/projects/{project['id']}/attachments/{att['attachment_id']}",
        headers=_auth(same_org_non_admin_user["access_token"]),
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_viewer_can_list_attachments(
    org_user: dict[str, str],
    same_org_non_admin_user: dict[str, str],
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, fake = fake_storage_client
    project = await _create_project(client, org_user["access_token"])
    att = await _initiate_att(client, org_user["access_token"], project["id"])
    await _complete_att(client, fake, org_user["access_token"], project["id"], att)
    await _add_member(
        client,
        org_user["access_token"],
        project["id"],
        same_org_non_admin_user["id"],
        "viewer",
    )
    resp = await client.get(
        f"/projects/{project['id']}/attachments",
        headers=_auth(same_org_non_admin_user["access_token"]),
    )
    assert resp.status_code == 200
    assert len(resp.json()) == 1


# ---------------------------------------------------------------------------
# Not found
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_nonexistent_attachment_404(
    org_user: dict[str, str],
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, _ = fake_storage_client
    project = await _create_project(client, org_user["access_token"])
    resp = await client.get(
        f"/projects/{project['id']}/attachments/{uuid4()}",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# uploaded_by_name
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_includes_uploaded_by_name(
    org_user: dict[str, str],
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, fake = fake_storage_client
    project = await _create_project(client, org_user["access_token"])
    att = await _initiate_att(client, org_user["access_token"], project["id"])
    await _complete_att(client, fake, org_user["access_token"], project["id"], att)
    resp = await client.get(
        f"/projects/{project['id']}/attachments",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 200
    items = resp.json()
    assert len(items) == 1
    assert items[0]["uploaded_by_name"] is not None
    assert isinstance(items[0]["uploaded_by_name"], str)


@pytest.mark.asyncio
async def test_get_includes_uploaded_by_name(
    org_user: dict[str, str],
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, _ = fake_storage_client
    project = await _create_project(client, org_user["access_token"])
    att = await _initiate_att(client, org_user["access_token"], project["id"])
    resp = await client.get(
        f"/projects/{project['id']}/attachments/{att['attachment_id']}",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 200
    assert "uploaded_by_name" in resp.json()
    assert resp.json()["uploaded_by_name"] is not None


# ---------------------------------------------------------------------------
# Download — disposition param
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_download_inline_disposition(
    org_user: dict[str, str],
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, fake = fake_storage_client
    project = await _create_project(client, org_user["access_token"])
    att = await _initiate_att(client, org_user["access_token"], project["id"])
    await _complete_att(client, fake, org_user["access_token"], project["id"], att)
    resp = await client.get(
        f"/projects/{project['id']}/attachments/{att['attachment_id']}/download?disposition=inline",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 200
    url = resp.json()["download_url"]
    assert "disposition=inline" in url


@pytest.mark.asyncio
async def test_download_default_disposition_is_attachment(
    org_user: dict[str, str],
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, fake = fake_storage_client
    project = await _create_project(client, org_user["access_token"])
    att = await _initiate_att(client, org_user["access_token"], project["id"])
    await _complete_att(client, fake, org_user["access_token"], project["id"], att)
    resp = await client.get(
        f"/projects/{project['id']}/attachments/{att['attachment_id']}/download",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 200
    url = resp.json()["download_url"]
    assert "disposition=attachment" in url


@pytest.mark.asyncio
async def test_download_rejects_invalid_disposition(
    org_user: dict[str, str],
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, fake = fake_storage_client
    project = await _create_project(client, org_user["access_token"])
    att = await _initiate_att(client, org_user["access_token"], project["id"])
    await _complete_att(client, fake, org_user["access_token"], project["id"], att)
    resp = await client.get(
        f"/projects/{project['id']}/attachments/{att['attachment_id']}/download?disposition=badvalue",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 422


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
    att = await _initiate_att(
        client, org_user["access_token"], project["id"], filename=filename
    )
    detail = await client.get(
        f"/projects/{project['id']}/attachments/{att['attachment_id']}",
        headers=_auth(org_user["access_token"]),
    )
    assert detail.json()["attachment_category"] == expected_category


# ---------------------------------------------------------------------------
# Capture metadata
# ---------------------------------------------------------------------------

_SAMPLE_METADATA: dict[str, object] = {
    "captured_at": "2026-05-27T10:30:00.000Z",
    "capture_method": "camera",
    "device": {"user_agent": "TestAgent/1.0"},
    "geolocation": {
        "latitude": 52.3676,
        "longitude": 4.9041,
        "accuracy": 10.5,
        "low_accuracy": False,
    },
    "exif": {
        "make": "Apple",
        "model": "iPhone 15 Pro",
        "orientation": 1,
        "image_width": 4032,
        "image_height": 3024,
    },
}


@pytest.mark.asyncio
async def test_capture_metadata_round_trips(
    org_user: dict[str, str],
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, fake = fake_storage_client
    project = await _create_project(client, org_user["access_token"])
    att = await _initiate_att(
        client, org_user["access_token"], project["id"],
        capture_metadata=_SAMPLE_METADATA,
    )
    body = await _complete_att(client, fake, org_user["access_token"], project["id"], att)
    meta = body["capture_metadata"]
    assert meta is not None
    assert meta["capture_method"] == "camera"
    assert meta["geolocation"]["latitude"] == 52.3676
    assert meta["exif"]["make"] == "Apple"
    assert "server_received_at" in meta


@pytest.mark.asyncio
async def test_capture_metadata_null_is_ok(
    org_user: dict[str, str],
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, fake = fake_storage_client
    project = await _create_project(client, org_user["access_token"])
    att = await _initiate_att(client, org_user["access_token"], project["id"])
    body = await _complete_att(client, fake, org_user["access_token"], project["id"], att)
    assert body["capture_metadata"] is None


@pytest.mark.asyncio
async def test_capture_metadata_geolocation_null_ok(
    org_user: dict[str, str],
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, fake = fake_storage_client
    project = await _create_project(client, org_user["access_token"])
    meta = {
        "captured_at": "2026-05-27T10:30:00.000Z",
        "capture_method": "file_picker",
        "device": {"user_agent": "TestAgent/1.0"},
        "geolocation": None,
        "exif": None,
    }
    att = await _initiate_att(
        client, org_user["access_token"], project["id"],
        capture_metadata=meta,
    )
    body = await _complete_att(client, fake, org_user["access_token"], project["id"], att)
    assert body["capture_metadata"] is not None
    assert body["capture_metadata"]["geolocation"] is None
    assert body["capture_metadata"]["exif"] is None
    assert "server_received_at" in body["capture_metadata"]


@pytest.mark.asyncio
async def test_capture_metadata_server_received_at_stamped(
    org_user: dict[str, str],
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, fake = fake_storage_client
    project = await _create_project(client, org_user["access_token"])
    att = await _initiate_att(
        client, org_user["access_token"], project["id"],
        capture_metadata=_SAMPLE_METADATA,
    )
    body = await _complete_att(client, fake, org_user["access_token"], project["id"], att)
    server_ts = body["capture_metadata"]["server_received_at"]
    assert server_ts.startswith("2")
    assert "T" in server_ts


@pytest.mark.asyncio
async def test_capture_metadata_audit_snapshot(
    org_user: dict[str, str],
    fake_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    client, fake = fake_storage_client
    project = await _create_project(client, org_user["access_token"])
    await _initiate_att(
        client, org_user["access_token"], project["id"],
        capture_metadata=_SAMPLE_METADATA,
    )
    row = await _latest_audit(session_maker, "attachment.initiated")
    assert row is not None
    assert row.after is not None
    assert row.after["has_capture_metadata"] is True


# ---------------------------------------------------------------------------
# List — linked_file_id / unlinked filters
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_filters_by_linked_file_id(
    org_user: dict[str, str],
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, fake = fake_storage_client
    token = org_user["access_token"]
    project = await _create_project(client, token)
    model = await _create_model(client, token, project["id"])
    file_id_a = await _create_ready_file(client, fake, token, project["id"], model["id"])
    file_id_b = await _create_ready_file(client, fake, token, project["id"], model["id"])

    att_a = await _initiate_att(client, token, project["id"], linked_file_id=file_id_a)
    await _complete_att(client, fake, token, project["id"], att_a)
    att_b = await _initiate_att(client, token, project["id"], linked_file_id=file_id_b)
    await _complete_att(client, fake, token, project["id"], att_b)

    resp = await client.get(
        f"/projects/{project['id']}/attachments?linked_file_id={file_id_a}",
        headers=_auth(token),
    )
    assert resp.status_code == 200
    items = resp.json()
    assert len(items) == 1
    assert items[0]["linked_file_id"] == file_id_a


@pytest.mark.asyncio
async def test_list_filters_by_element_and_file(
    org_user: dict[str, str],
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, fake = fake_storage_client
    token = org_user["access_token"]
    project = await _create_project(client, token)
    model = await _create_model(client, token, project["id"])
    file_id = await _create_ready_file(client, fake, token, project["id"], model["id"])
    gid_a = "0aB1cD2eF3gH4iJ5kL6mN7"
    gid_b = "9zY8xW7vU6tS5rQ4pO3nM2"

    att1 = await _initiate_att(
        client, token, project["id"],
        linked_file_id=file_id, linked_element_global_id=gid_a,
    )
    await _complete_att(client, fake, token, project["id"], att1)
    att2 = await _initiate_att(
        client, token, project["id"],
        linked_file_id=file_id, linked_element_global_id=gid_b,
    )
    await _complete_att(client, fake, token, project["id"], att2)

    resp = await client.get(
        f"/projects/{project['id']}/attachments?linked_file_id={file_id}&linked_element_global_id={gid_a}",
        headers=_auth(token),
    )
    assert resp.status_code == 200
    items = resp.json()
    assert len(items) == 1
    assert items[0]["linked_element_global_id"] == gid_a


@pytest.mark.asyncio
async def test_list_unlinked_filter(
    org_user: dict[str, str],
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, fake = fake_storage_client
    token = org_user["access_token"]
    project = await _create_project(client, token)

    linked = await _initiate_att(
        client, token, project["id"],
        linked_element_global_id="0aB1cD2eF3gH4iJ5kL6mN7",
    )
    await _complete_att(client, fake, token, project["id"], linked)
    unlinked = await _initiate_att(client, token, project["id"])
    await _complete_att(client, fake, token, project["id"], unlinked)

    resp = await client.get(
        f"/projects/{project['id']}/attachments?unlinked=true",
        headers=_auth(token),
    )
    assert resp.status_code == 200
    items = resp.json()
    assert len(items) == 1
    assert items[0]["linked_element_global_id"] is None


# ---------------------------------------------------------------------------
# List — linked_point filters
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_filters_by_linked_point_type(
    org_user: dict[str, str],
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, fake = fake_storage_client
    token = org_user["access_token"]
    project = await _create_project(client, token)

    pdf_pin = await _initiate_att(
        client, token, project["id"],
        linked_point={"type": "pdf", "page": 2, "x": 0.5, "y": 0.3},
    )
    await _complete_att(client, fake, token, project["id"], pdf_pin)
    ifc_pin = await _initiate_att(
        client, token, project["id"],
        linked_point={"type": "ifc", "x": 1.0, "y": 2.0, "z": 3.0},
    )
    await _complete_att(client, fake, token, project["id"], ifc_pin)
    plain = await _initiate_att(client, token, project["id"])
    await _complete_att(client, fake, token, project["id"], plain)

    resp = await client.get(
        f"/projects/{project['id']}/attachments?linked_point_type=pdf",
        headers=_auth(token),
    )
    assert resp.status_code == 200
    items = resp.json()
    assert len(items) == 1
    assert items[0]["linked_point"]["type"] == "pdf"


@pytest.mark.asyncio
async def test_list_filters_by_linked_point_page(
    org_user: dict[str, str],
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, fake = fake_storage_client
    token = org_user["access_token"]
    project = await _create_project(client, token)

    page2 = await _initiate_att(
        client, token, project["id"],
        linked_point={"type": "pdf", "page": 2, "x": 0.1, "y": 0.2},
    )
    await _complete_att(client, fake, token, project["id"], page2)
    page5 = await _initiate_att(
        client, token, project["id"],
        linked_point={"type": "pdf", "page": 5, "x": 0.8, "y": 0.9},
    )
    await _complete_att(client, fake, token, project["id"], page5)

    resp = await client.get(
        f"/projects/{project['id']}/attachments?linked_point_type=pdf&linked_point_page=2",
        headers=_auth(token),
    )
    assert resp.status_code == 200
    items = resp.json()
    assert len(items) == 1
    assert items[0]["linked_point"]["page"] == 2


# ---------------------------------------------------------------------------
# linked_point validation
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_initiate_validates_linked_point_pdf(
    org_user: dict[str, str],
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, _ = fake_storage_client
    project = await _create_project(client, org_user["access_token"])
    resp = await client.post(
        f"/projects/{project['id']}/attachments/initiate",
        json=_att_payload(linked_point={"type": "pdf", "page": 0, "x": 0.5, "y": 0.5}),
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_initiate_validates_linked_point_bad_type(
    org_user: dict[str, str],
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, _ = fake_storage_client
    project = await _create_project(client, org_user["access_token"])
    resp = await client.post(
        f"/projects/{project['id']}/attachments/initiate",
        json=_att_payload(linked_point={"type": "bad", "x": 0, "y": 0}),
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_initiate_accepts_valid_pdf_point(
    org_user: dict[str, str],
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, _ = fake_storage_client
    project = await _create_project(client, org_user["access_token"])
    resp = await client.post(
        f"/projects/{project['id']}/attachments/initiate",
        json=_att_payload(linked_point={"type": "pdf", "page": 3, "x": 0.45, "y": 0.72}),
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 201
    body = resp.json()
    detail = await client.get(
        f"/projects/{project['id']}/attachments/{body['attachment_id']}",
        headers=_auth(org_user["access_token"]),
    )
    lp = detail.json()["linked_point"]
    assert lp["type"] == "pdf"
    assert lp["page"] == 3


# ---------------------------------------------------------------------------
# Image metadata extraction dispatch
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_complete_image_dispatches_extraction(
    org_user: dict[str, str],
    fake_storage_client: tuple[AsyncClient, FakeStorage],
    job_dispatch_calls: list[dict[str, object]],
) -> None:
    client, fake = fake_storage_client
    project = await _create_project(client, org_user["access_token"])
    att = await _initiate_att(client, org_user["access_token"], project["id"])
    await _complete_att(client, fake, org_user["access_token"], project["id"], att)

    img_calls = [c for c in job_dispatch_calls if c["job_type"] == "image_metadata_extraction"]
    assert len(img_calls) == 1
    payload = img_calls[0]["payload"]
    assert isinstance(payload, dict)
    assert payload["attachment_id"] == att["attachment_id"]
    assert payload["project_id"] == project["id"]
    assert "storage_key" in payload
    assert "bucket" in payload


@pytest.mark.asyncio
async def test_complete_non_image_does_not_dispatch(
    org_user: dict[str, str],
    fake_storage_client: tuple[AsyncClient, FakeStorage],
    job_dispatch_calls: list[dict[str, object]],
) -> None:
    client, fake = fake_storage_client
    project = await _create_project(client, org_user["access_token"])
    att = await _initiate_att(
        client, org_user["access_token"], project["id"], filename="report.pdf"
    )
    await _complete_att(client, fake, org_user["access_token"], project["id"], att)

    img_calls = [c for c in job_dispatch_calls if c["job_type"] == "image_metadata_extraction"]
    assert len(img_calls) == 0


# ---------------------------------------------------------------------------
# Attachment metadata callback
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_attachment_callback_succeeded(
    org_user: dict[str, str],
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, fake = fake_storage_client
    project = await _create_project(client, org_user["access_token"])
    att = await _initiate_att(client, org_user["access_token"], project["id"])
    body = await _complete_att(client, fake, org_user["access_token"], project["id"], att)
    assert body["server_metadata"] is None

    metadata = {
        "gps": {"latitude": 52.3676, "longitude": 4.9041, "altitude": 3.5},
        "camera": {"make": "Apple", "model": "iPhone 15 Pro", "software": None},
        "image": {"width": 4032, "height": 3024, "orientation": 1, "color_space": 1},
        "capture": {"date_time_original": "2026-05-27T10:30:00.000Z"},
        "extracted_at": "2026-05-27T10:30:05.000Z",
        "extractor_version": "0.1.0",
    }
    resp = await client.post(
        "/internal/jobs/attachments/callback",
        json={
            "attachment_id": att["attachment_id"],
            "organization_id": org_user["organization_id"],
            "job_id": str(uuid4()),
            "status": "succeeded",
            "server_metadata": metadata,
            "finished_at": "2026-05-27T10:30:05Z",
        },
        headers=_bearer(),
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["server_metadata"] is not None
    assert data["server_metadata"]["gps"]["latitude"] == 52.3676
    assert data["server_metadata"]["camera"]["make"] == "Apple"


@pytest.mark.asyncio
async def test_attachment_callback_failed(
    org_user: dict[str, str],
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, fake = fake_storage_client
    project = await _create_project(client, org_user["access_token"])
    att = await _initiate_att(client, org_user["access_token"], project["id"])
    await _complete_att(client, fake, org_user["access_token"], project["id"], att)

    resp = await client.post(
        "/internal/jobs/attachments/callback",
        json={
            "attachment_id": att["attachment_id"],
            "organization_id": org_user["organization_id"],
            "job_id": str(uuid4()),
            "status": "failed",
            "error": "EXIF_PARSE_ERROR: invalid JPEG",
            "finished_at": "2026-05-27T10:30:05Z",
        },
        headers=_bearer(),
    )
    assert resp.status_code == 200
    assert resp.json()["server_metadata"] is None


@pytest.mark.asyncio
async def test_attachment_callback_not_found(
    org_user: dict[str, str],
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, _ = fake_storage_client
    resp = await client.post(
        "/internal/jobs/attachments/callback",
        json={
            "attachment_id": str(uuid4()),
            "organization_id": org_user["organization_id"],
            "job_id": str(uuid4()),
            "status": "succeeded",
            "server_metadata": {"gps": None},
        },
        headers=_bearer(),
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_attachment_callback_requires_auth(
    org_user: dict[str, str],
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, fake = fake_storage_client
    project = await _create_project(client, org_user["access_token"])
    att = await _initiate_att(client, org_user["access_token"], project["id"])
    await _complete_att(client, fake, org_user["access_token"], project["id"], att)

    resp = await client.post(
        "/internal/jobs/attachments/callback",
        json={
            "attachment_id": att["attachment_id"],
            "organization_id": org_user["organization_id"],
            "job_id": str(uuid4()),
            "status": "succeeded",
            "server_metadata": {},
        },
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_server_metadata_in_response(
    org_user: dict[str, str],
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    """After callback, the GET endpoint includes server_metadata."""
    client, fake = fake_storage_client
    project = await _create_project(client, org_user["access_token"])
    att = await _initiate_att(client, org_user["access_token"], project["id"])
    await _complete_att(client, fake, org_user["access_token"], project["id"], att)

    metadata = {"gps": {"latitude": 51.5, "longitude": 5.4}, "camera": None}
    await client.post(
        "/internal/jobs/attachments/callback",
        json={
            "attachment_id": att["attachment_id"],
            "organization_id": org_user["organization_id"],
            "job_id": str(uuid4()),
            "status": "succeeded",
            "server_metadata": metadata,
        },
        headers=_bearer(),
    )

    resp = await client.get(
        f"/projects/{project['id']}/attachments/{att['attachment_id']}",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 200
    assert resp.json()["server_metadata"]["gps"]["latitude"] == 51.5
