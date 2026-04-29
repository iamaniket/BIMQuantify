"""Integration tests for project file uploads.

Storage is mocked via dependency override so tests run without MinIO.
Shared fixtures (FakeStorage, fake_storage_client, _auth, _create_project,
_add_member, VALID_IFC_HEADER) live in conftest.py.
"""

from __future__ import annotations

from uuid import uuid4

import pytest
from httpx import AsyncClient

from tests.conftest import (
    VALID_IFC_HEADER,
    FakeStorage,
    _add_member,
    _auth,
    _create_project,
)


# ---------------------------------------------------------------------------
# initiate
# ---------------------------------------------------------------------------


async def test_initiate_owner_succeeds(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, fake = fake_storage_client
    project = await _create_project(client, org_user["access_token"])
    resp = await client.post(
        f"/projects/{project['id']}/files/initiate",
        json={
            "filename": "model.ifc",
            "size_bytes": 1024,
            "content_type": "application/octet-stream",
        },
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["upload_url"].startswith("http://fake-storage/")
    assert body["storage_key"].startswith(f"projects/{project['id']}/")
    assert body["storage_key"].endswith(".ifc")
    assert "file_id" in body
    assert body["expires_in"] == fake.presign_ttl_value


async def test_initiate_editor_succeeds(
    org_user: dict[str, str],
    same_org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, _ = fake_storage_client
    project = await _create_project(client, org_user["access_token"], name="ShareEditor")
    await _add_member(
        client, org_user["access_token"], project["id"], same_org_user["id"], "editor"
    )
    resp = await client.post(
        f"/projects/{project['id']}/files/initiate",
        json={"filename": "x.ifc", "size_bytes": 100, "content_type": "application/octet-stream"},
        headers=_auth(same_org_user["access_token"]),
    )
    assert resp.status_code == 201


async def test_initiate_viewer_forbidden(
    org_user: dict[str, str],
    same_org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, _ = fake_storage_client
    project = await _create_project(client, org_user["access_token"], name="LockedV")
    await _add_member(
        client, org_user["access_token"], project["id"], same_org_user["id"], "viewer"
    )
    resp = await client.post(
        f"/projects/{project['id']}/files/initiate",
        json={"filename": "x.ifc", "size_bytes": 100, "content_type": "application/octet-stream"},
        headers=_auth(same_org_user["access_token"]),
    )
    assert resp.status_code == 403


async def test_initiate_rejects_non_ifc_extension(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, _ = fake_storage_client
    project = await _create_project(client, org_user["access_token"], name="ExtCheck")
    resp = await client.post(
        f"/projects/{project['id']}/files/initiate",
        json={"filename": "model.txt", "size_bytes": 100, "content_type": "text/plain"},
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 400
    assert resp.json()["detail"] == "INVALID_FILE_EXTENSION"


async def test_initiate_rejects_oversized(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("UPLOAD_MAX_BYTES", "1024")
    from bimstitch_api.config import get_settings

    get_settings.cache_clear()
    try:
        client, _ = fake_storage_client
        project = await _create_project(client, org_user["access_token"], name="SizeCap")
        resp = await client.post(
            f"/projects/{project['id']}/files/initiate",
            json={
                "filename": "huge.ifc",
                "size_bytes": 4096,
                "content_type": "application/octet-stream",
            },
            headers=_auth(org_user["access_token"]),
        )
        assert resp.status_code == 413
        assert resp.json()["detail"] == "FILE_TOO_LARGE"
    finally:
        monkeypatch.delenv("UPLOAD_MAX_BYTES", raising=False)
        get_settings.cache_clear()


async def test_initiate_cross_org_returns_404(
    org_user: dict[str, str],
    other_org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, _ = fake_storage_client
    project = await _create_project(client, org_user["access_token"], name="AOnly")
    resp = await client.post(
        f"/projects/{project['id']}/files/initiate",
        json={"filename": "x.ifc", "size_bytes": 100, "content_type": "application/octet-stream"},
        headers=_auth(other_org_user["access_token"]),
    )
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# complete
# ---------------------------------------------------------------------------


async def test_complete_happy_path_marks_ready(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, fake = fake_storage_client
    project = await _create_project(client, org_user["access_token"], name="HappyComplete")
    init = (
        await client.post(
            f"/projects/{project['id']}/files/initiate",
            json={
                "filename": "m.ifc",
                "size_bytes": len(VALID_IFC_HEADER),
                "content_type": "application/octet-stream",
            },
            headers=_auth(org_user["access_token"]),
        )
    ).json()

    fake.objects[init["storage_key"]] = VALID_IFC_HEADER

    resp = await client.post(
        f"/projects/{project['id']}/files/{init['file_id']}/complete",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "ready"
    assert body["ifc_schema"] == "IFC4"
    assert body["rejection_reason"] is None


async def test_complete_invalid_bytes_marks_rejected_and_deletes_object(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, fake = fake_storage_client
    project = await _create_project(client, org_user["access_token"], name="BadBytes")
    bad = b"this is not an IFC file at all\n" * 4
    init = (
        await client.post(
            f"/projects/{project['id']}/files/initiate",
            json={
                "filename": "fake.ifc",
                "size_bytes": len(bad),
                "content_type": "application/octet-stream",
            },
            headers=_auth(org_user["access_token"]),
        )
    ).json()
    fake.objects[init["storage_key"]] = bad

    resp = await client.post(
        f"/projects/{project['id']}/files/{init['file_id']}/complete",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "rejected"
    assert body["rejection_reason"] == "FILE_NOT_ISO_10303_21"
    assert init["storage_key"] not in fake.objects
    assert init["storage_key"] in fake.deleted


async def test_complete_object_missing_returns_422(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, _ = fake_storage_client
    project = await _create_project(client, org_user["access_token"], name="NoUpload")
    init = (
        await client.post(
            f"/projects/{project['id']}/files/initiate",
            json={
                "filename": "m.ifc",
                "size_bytes": 1024,
                "content_type": "application/octet-stream",
            },
            headers=_auth(org_user["access_token"]),
        )
    ).json()
    # Don't upload — go straight to complete.
    resp = await client.post(
        f"/projects/{project['id']}/files/{init['file_id']}/complete",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 422
    assert resp.json()["detail"] == "OBJECT_NOT_UPLOADED"


async def test_complete_size_mismatch_returns_422(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, fake = fake_storage_client
    project = await _create_project(client, org_user["access_token"], name="SizeMismatch")
    init = (
        await client.post(
            f"/projects/{project['id']}/files/initiate",
            json={
                "filename": "m.ifc",
                "size_bytes": 9999,
                "content_type": "application/octet-stream",
            },
            headers=_auth(org_user["access_token"]),
        )
    ).json()
    fake.objects[init["storage_key"]] = VALID_IFC_HEADER  # different length

    resp = await client.post(
        f"/projects/{project['id']}/files/{init['file_id']}/complete",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 422
    assert resp.json()["detail"] == "SIZE_MISMATCH"


async def test_complete_already_finalized_returns_409(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, fake = fake_storage_client
    project = await _create_project(client, org_user["access_token"], name="DoubleComplete")
    init = (
        await client.post(
            f"/projects/{project['id']}/files/initiate",
            json={
                "filename": "m.ifc",
                "size_bytes": len(VALID_IFC_HEADER),
                "content_type": "application/octet-stream",
            },
            headers=_auth(org_user["access_token"]),
        )
    ).json()
    fake.objects[init["storage_key"]] = VALID_IFC_HEADER
    first = await client.post(
        f"/projects/{project['id']}/files/{init['file_id']}/complete",
        headers=_auth(org_user["access_token"]),
    )
    assert first.status_code == 200
    second = await client.post(
        f"/projects/{project['id']}/files/{init['file_id']}/complete",
        headers=_auth(org_user["access_token"]),
    )
    assert second.status_code == 409
    assert second.json()["detail"] == "FILE_ALREADY_FINALIZED"


# ---------------------------------------------------------------------------
# list
# ---------------------------------------------------------------------------


async def test_list_files_default_returns_only_ready(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, fake = fake_storage_client
    project = await _create_project(client, org_user["access_token"], name="Listing")

    # Ready file.
    init1 = (
        await client.post(
            f"/projects/{project['id']}/files/initiate",
            json={
                "filename": "ok.ifc",
                "size_bytes": len(VALID_IFC_HEADER),
                "content_type": "application/octet-stream",
            },
            headers=_auth(org_user["access_token"]),
        )
    ).json()
    fake.objects[init1["storage_key"]] = VALID_IFC_HEADER
    await client.post(
        f"/projects/{project['id']}/files/{init1['file_id']}/complete",
        headers=_auth(org_user["access_token"]),
    )

    # Pending file (no complete).
    await client.post(
        f"/projects/{project['id']}/files/initiate",
        json={
            "filename": "pending.ifc",
            "size_bytes": 1024,
            "content_type": "application/octet-stream",
        },
        headers=_auth(org_user["access_token"]),
    )

    default_resp = await client.get(
        f"/projects/{project['id']}/files", headers=_auth(org_user["access_token"])
    )
    assert default_resp.status_code == 200
    default_files = default_resp.json()
    assert [f["original_filename"] for f in default_files] == ["ok.ifc"]

    all_resp = await client.get(
        f"/projects/{project['id']}/files?status=all",
        headers=_auth(org_user["access_token"]),
    )
    assert all_resp.status_code == 200
    all_files = all_resp.json()
    assert sorted(f["original_filename"] for f in all_files) == ["ok.ifc", "pending.ifc"]


# ---------------------------------------------------------------------------
# download
# ---------------------------------------------------------------------------


async def test_download_returns_presigned_url_for_ready_file(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, fake = fake_storage_client
    project = await _create_project(client, org_user["access_token"], name="DL")
    init = (
        await client.post(
            f"/projects/{project['id']}/files/initiate",
            json={
                "filename": "down.ifc",
                "size_bytes": len(VALID_IFC_HEADER),
                "content_type": "application/octet-stream",
            },
            headers=_auth(org_user["access_token"]),
        )
    ).json()
    fake.objects[init["storage_key"]] = VALID_IFC_HEADER
    await client.post(
        f"/projects/{project['id']}/files/{init['file_id']}/complete",
        headers=_auth(org_user["access_token"]),
    )

    resp = await client.get(
        f"/projects/{project['id']}/files/{init['file_id']}/download",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["download_url"].endswith("?download=down.ifc")
    assert body["expires_in"] == fake.presign_ttl_value


async def test_download_404_for_pending_file(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, _ = fake_storage_client
    project = await _create_project(client, org_user["access_token"], name="DLPending")
    init = (
        await client.post(
            f"/projects/{project['id']}/files/initiate",
            json={
                "filename": "p.ifc",
                "size_bytes": 100,
                "content_type": "application/octet-stream",
            },
            headers=_auth(org_user["access_token"]),
        )
    ).json()
    resp = await client.get(
        f"/projects/{project['id']}/files/{init['file_id']}/download",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 404
    assert resp.json()["detail"] == "FILE_NOT_READY"


# ---------------------------------------------------------------------------
# delete
# ---------------------------------------------------------------------------


async def test_delete_removes_row_and_object(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, fake = fake_storage_client
    project = await _create_project(client, org_user["access_token"], name="DelP")
    init = (
        await client.post(
            f"/projects/{project['id']}/files/initiate",
            json={
                "filename": "del.ifc",
                "size_bytes": len(VALID_IFC_HEADER),
                "content_type": "application/octet-stream",
            },
            headers=_auth(org_user["access_token"]),
        )
    ).json()
    fake.objects[init["storage_key"]] = VALID_IFC_HEADER

    resp = await client.delete(
        f"/projects/{project['id']}/files/{init['file_id']}",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 204
    assert init["storage_key"] not in fake.objects
    assert init["storage_key"] in fake.deleted

    listing = await client.get(
        f"/projects/{project['id']}/files?status=all",
        headers=_auth(org_user["access_token"]),
    )
    assert listing.json() == []


async def test_delete_unknown_file_returns_404(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, _ = fake_storage_client
    project = await _create_project(client, org_user["access_token"], name="DelUnknown")
    resp = await client.delete(
        f"/projects/{project['id']}/files/{uuid4()}",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 404


async def test_delete_viewer_forbidden(
    org_user: dict[str, str],
    same_org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, fake = fake_storage_client
    project = await _create_project(client, org_user["access_token"], name="DelViewer")
    await _add_member(
        client, org_user["access_token"], project["id"], same_org_user["id"], "viewer"
    )
    init = (
        await client.post(
            f"/projects/{project['id']}/files/initiate",
            json={
                "filename": "x.ifc",
                "size_bytes": len(VALID_IFC_HEADER),
                "content_type": "application/octet-stream",
            },
            headers=_auth(org_user["access_token"]),
        )
    ).json()
    fake.objects[init["storage_key"]] = VALID_IFC_HEADER

    resp = await client.delete(
        f"/projects/{project['id']}/files/{init['file_id']}",
        headers=_auth(same_org_user["access_token"]),
    )
    assert resp.status_code == 403
