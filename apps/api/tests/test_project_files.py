"""Integration tests for project file uploads (now nested under Model).

Storage is mocked via dependency override so tests run without MinIO.
Shared fixtures (FakeStorage, fake_storage_client, _auth, _create_project,
_create_model, _add_member, VALID_IFC_HEADER) live in conftest.py.
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
    _create_model,
    _create_project,
)


async def _project_and_model(
    client: AsyncClient,
    token: str,
    project_name: str = "P1",
    model_name: str = "M1",
) -> tuple[str, str]:
    project = await _create_project(client, token, name=project_name)
    model = await _create_model(client, token, project["id"], name=model_name)
    return project["id"], model["id"]


# ---------------------------------------------------------------------------
# initiate
# ---------------------------------------------------------------------------


async def test_initiate_owner_succeeds(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, fake = fake_storage_client
    project_id, model_id = await _project_and_model(client, org_user["access_token"])
    resp = await client.post(
        f"/projects/{project_id}/models/{model_id}/files/initiate",
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
    assert body["storage_key"].startswith(f"projects/{project_id}/models/{model_id}/")
    assert body["storage_key"].endswith(".ifc")
    assert "file_id" in body
    assert body["expires_in"] == fake.presign_ttl_value


async def test_initiate_assigns_version_number_1_for_first_file(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, _ = fake_storage_client
    project_id, model_id = await _project_and_model(
        client, org_user["access_token"], model_name="V1"
    )
    init = (
        await client.post(
            f"/projects/{project_id}/models/{model_id}/files/initiate",
            json={
                "filename": "first.ifc",
                "size_bytes": 100,
                "content_type": "application/octet-stream",
            },
            headers=_auth(org_user["access_token"]),
        )
    ).json()

    listing = await client.get(
        f"/projects/{project_id}/models/{model_id}/files?status=all",
        headers=_auth(org_user["access_token"]),
    )
    files = listing.json()
    assert len(files) == 1
    assert files[0]["id"] == init["file_id"]
    assert files[0]["version_number"] == 1


async def test_initiate_assigns_incrementing_version_numbers(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, _ = fake_storage_client
    project_id, model_id = await _project_and_model(
        client, org_user["access_token"], model_name="VInc"
    )
    for i in range(3):
        await client.post(
            f"/projects/{project_id}/models/{model_id}/files/initiate",
            json={
                "filename": f"v{i}.ifc",
                "size_bytes": 100,
                "content_type": "application/octet-stream",
            },
            headers=_auth(org_user["access_token"]),
        )

    listing = await client.get(
        f"/projects/{project_id}/models/{model_id}/files?status=all",
        headers=_auth(org_user["access_token"]),
    )
    files = listing.json()
    # Listing is ordered by version_number DESC.
    assert [f["version_number"] for f in files] == [3, 2, 1]


async def test_initiate_version_number_unique_per_model(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    """Two different models in the same project both start at version_number=1."""
    client, _ = fake_storage_client
    project = await _create_project(client, org_user["access_token"], name="MultiModel")
    a = await _create_model(client, org_user["access_token"], project["id"], name="A")
    b = await _create_model(client, org_user["access_token"], project["id"], name="B")

    for model in (a, b):
        await client.post(
            f"/projects/{project['id']}/models/{model['id']}/files/initiate",
            json={
                "filename": "f.ifc",
                "size_bytes": 100,
                "content_type": "application/octet-stream",
            },
            headers=_auth(org_user["access_token"]),
        )

    for model in (a, b):
        listing = (
            await client.get(
                f"/projects/{project['id']}/models/{model['id']}/files?status=all",
                headers=_auth(org_user["access_token"]),
            )
        ).json()
        assert len(listing) == 1
        assert listing[0]["version_number"] == 1


async def test_initiate_editor_succeeds(
    org_user: dict[str, str],
    same_org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, _ = fake_storage_client
    project_id, model_id = await _project_and_model(
        client, org_user["access_token"], project_name="ShareEditor"
    )
    await _add_member(client, org_user["access_token"], project_id, same_org_user["id"], "editor")
    resp = await client.post(
        f"/projects/{project_id}/models/{model_id}/files/initiate",
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
    project_id, model_id = await _project_and_model(
        client, org_user["access_token"], project_name="LockedV"
    )
    await _add_member(client, org_user["access_token"], project_id, same_org_user["id"], "viewer")
    resp = await client.post(
        f"/projects/{project_id}/models/{model_id}/files/initiate",
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
    project_id, model_id = await _project_and_model(
        client, org_user["access_token"], project_name="ExtCheck"
    )
    resp = await client.post(
        f"/projects/{project_id}/models/{model_id}/files/initiate",
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
        project_id, model_id = await _project_and_model(
            client, org_user["access_token"], project_name="SizeCap"
        )
        resp = await client.post(
            f"/projects/{project_id}/models/{model_id}/files/initiate",
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
    project_id, model_id = await _project_and_model(
        client, org_user["access_token"], project_name="AOnly"
    )
    resp = await client.post(
        f"/projects/{project_id}/models/{model_id}/files/initiate",
        json={"filename": "x.ifc", "size_bytes": 100, "content_type": "application/octet-stream"},
        headers=_auth(other_org_user["access_token"]),
    )
    assert resp.status_code == 404


async def test_initiate_unknown_model_returns_404(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, _ = fake_storage_client
    project = await _create_project(client, org_user["access_token"], name="UnknownM")
    resp = await client.post(
        f"/projects/{project['id']}/models/{uuid4()}/files/initiate",
        json={"filename": "x.ifc", "size_bytes": 100, "content_type": "application/octet-stream"},
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 404
    assert resp.json()["detail"] == "MODEL_NOT_FOUND"


# ---------------------------------------------------------------------------
# complete
# ---------------------------------------------------------------------------


async def test_complete_happy_path_marks_ready(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, fake = fake_storage_client
    project_id, model_id = await _project_and_model(
        client, org_user["access_token"], project_name="HappyComplete"
    )
    init = (
        await client.post(
            f"/projects/{project_id}/models/{model_id}/files/initiate",
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
        f"/projects/{project_id}/models/{model_id}/files/{init['file_id']}/complete",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "ready"
    assert body["ifc_schema"] == "IFC4"
    assert body["rejection_reason"] is None
    assert body["model_id"] == model_id
    assert body["version_number"] == 1


async def test_complete_invalid_bytes_marks_rejected_and_deletes_object(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, fake = fake_storage_client
    project_id, model_id = await _project_and_model(
        client, org_user["access_token"], project_name="BadBytes"
    )
    bad = b"this is not an IFC file at all\n" * 4
    init = (
        await client.post(
            f"/projects/{project_id}/models/{model_id}/files/initiate",
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
        f"/projects/{project_id}/models/{model_id}/files/{init['file_id']}/complete",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "rejected"
    assert body["rejection_reason"] == "FILE_NOT_ISO_10303_21"
    assert init["storage_key"] not in fake.objects
    assert init["storage_key"] in fake.deleted


async def test_initiate_gap_after_rejected_complete(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    """Rejected uploads still consume their version_number — the next initiate
    gets the next number, leaving a gap. This is intentional per spec."""
    client, fake = fake_storage_client
    project_id, model_id = await _project_and_model(
        client, org_user["access_token"], project_name="GapP"
    )
    bad = b"not ifc\n"
    init1 = (
        await client.post(
            f"/projects/{project_id}/models/{model_id}/files/initiate",
            json={
                "filename": "v1.ifc",
                "size_bytes": len(bad),
                "content_type": "application/octet-stream",
            },
            headers=_auth(org_user["access_token"]),
        )
    ).json()
    fake.objects[init1["storage_key"]] = bad
    rejected = await client.post(
        f"/projects/{project_id}/models/{model_id}/files/{init1['file_id']}/complete",
        headers=_auth(org_user["access_token"]),
    )
    assert rejected.json()["status"] == "rejected"

    init2 = (
        await client.post(
            f"/projects/{project_id}/models/{model_id}/files/initiate",
            json={
                "filename": "v2.ifc",
                "size_bytes": 100,
                "content_type": "application/octet-stream",
            },
            headers=_auth(org_user["access_token"]),
        )
    ).json()

    listing = await client.get(
        f"/projects/{project_id}/models/{model_id}/files?status=all",
        headers=_auth(org_user["access_token"]),
    )
    versions = sorted(f["version_number"] for f in listing.json())
    # Both rows still exist; the rejected one kept its v=1, new one is v=2.
    assert versions == [1, 2]
    assert init2["file_id"] != init1["file_id"]


async def test_complete_object_missing_returns_422(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, _ = fake_storage_client
    project_id, model_id = await _project_and_model(
        client, org_user["access_token"], project_name="NoUpload"
    )
    init = (
        await client.post(
            f"/projects/{project_id}/models/{model_id}/files/initiate",
            json={
                "filename": "m.ifc",
                "size_bytes": 1024,
                "content_type": "application/octet-stream",
            },
            headers=_auth(org_user["access_token"]),
        )
    ).json()
    resp = await client.post(
        f"/projects/{project_id}/models/{model_id}/files/{init['file_id']}/complete",
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
    project_id, model_id = await _project_and_model(
        client, org_user["access_token"], project_name="SizeMismatch"
    )
    init = (
        await client.post(
            f"/projects/{project_id}/models/{model_id}/files/initiate",
            json={
                "filename": "m.ifc",
                "size_bytes": 9999,
                "content_type": "application/octet-stream",
            },
            headers=_auth(org_user["access_token"]),
        )
    ).json()
    fake.objects[init["storage_key"]] = VALID_IFC_HEADER

    resp = await client.post(
        f"/projects/{project_id}/models/{model_id}/files/{init['file_id']}/complete",
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
    project_id, model_id = await _project_and_model(
        client, org_user["access_token"], project_name="DoubleComplete"
    )
    init = (
        await client.post(
            f"/projects/{project_id}/models/{model_id}/files/initiate",
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
        f"/projects/{project_id}/models/{model_id}/files/{init['file_id']}/complete",
        headers=_auth(org_user["access_token"]),
    )
    assert first.status_code == 200
    second = await client.post(
        f"/projects/{project_id}/models/{model_id}/files/{init['file_id']}/complete",
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
    project_id, model_id = await _project_and_model(
        client, org_user["access_token"], project_name="Listing"
    )

    # Ready file.
    init1 = (
        await client.post(
            f"/projects/{project_id}/models/{model_id}/files/initiate",
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
        f"/projects/{project_id}/models/{model_id}/files/{init1['file_id']}/complete",
        headers=_auth(org_user["access_token"]),
    )

    # Pending file (no complete).
    await client.post(
        f"/projects/{project_id}/models/{model_id}/files/initiate",
        json={
            "filename": "pending.ifc",
            "size_bytes": 1024,
            "content_type": "application/octet-stream",
        },
        headers=_auth(org_user["access_token"]),
    )

    default_resp = await client.get(
        f"/projects/{project_id}/models/{model_id}/files",
        headers=_auth(org_user["access_token"]),
    )
    assert default_resp.status_code == 200
    default_files = default_resp.json()
    assert [f["original_filename"] for f in default_files] == ["ok.ifc"]

    all_resp = await client.get(
        f"/projects/{project_id}/models/{model_id}/files?status=all",
        headers=_auth(org_user["access_token"]),
    )
    assert all_resp.status_code == 200
    all_files = all_resp.json()
    assert sorted(f["original_filename"] for f in all_files) == ["ok.ifc", "pending.ifc"]


async def test_list_files_scoped_to_model(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, _ = fake_storage_client
    project = await _create_project(client, org_user["access_token"], name="MultiModelList")
    a = await _create_model(client, org_user["access_token"], project["id"], name="A")
    b = await _create_model(client, org_user["access_token"], project["id"], name="B")

    for _ in range(2):
        await client.post(
            f"/projects/{project['id']}/models/{a['id']}/files/initiate",
            json={
                "filename": "f.ifc",
                "size_bytes": 100,
                "content_type": "application/octet-stream",
            },
            headers=_auth(org_user["access_token"]),
        )
    await client.post(
        f"/projects/{project['id']}/models/{b['id']}/files/initiate",
        json={
            "filename": "f.ifc",
            "size_bytes": 100,
            "content_type": "application/octet-stream",
        },
        headers=_auth(org_user["access_token"]),
    )

    a_list = (
        await client.get(
            f"/projects/{project['id']}/models/{a['id']}/files?status=all",
            headers=_auth(org_user["access_token"]),
        )
    ).json()
    b_list = (
        await client.get(
            f"/projects/{project['id']}/models/{b['id']}/files?status=all",
            headers=_auth(org_user["access_token"]),
        )
    ).json()
    assert len(a_list) == 2
    assert len(b_list) == 1


# ---------------------------------------------------------------------------
# download
# ---------------------------------------------------------------------------


async def test_download_returns_presigned_url_for_ready_file(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, fake = fake_storage_client
    project_id, model_id = await _project_and_model(
        client, org_user["access_token"], project_name="DL"
    )
    init = (
        await client.post(
            f"/projects/{project_id}/models/{model_id}/files/initiate",
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
        f"/projects/{project_id}/models/{model_id}/files/{init['file_id']}/complete",
        headers=_auth(org_user["access_token"]),
    )

    resp = await client.get(
        f"/projects/{project_id}/models/{model_id}/files/{init['file_id']}/download",
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
    project_id, model_id = await _project_and_model(
        client, org_user["access_token"], project_name="DLPending"
    )
    init = (
        await client.post(
            f"/projects/{project_id}/models/{model_id}/files/initiate",
            json={
                "filename": "p.ifc",
                "size_bytes": 100,
                "content_type": "application/octet-stream",
            },
            headers=_auth(org_user["access_token"]),
        )
    ).json()
    resp = await client.get(
        f"/projects/{project_id}/models/{model_id}/files/{init['file_id']}/download",
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
    project_id, model_id = await _project_and_model(
        client, org_user["access_token"], project_name="DelP"
    )
    init = (
        await client.post(
            f"/projects/{project_id}/models/{model_id}/files/initiate",
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
        f"/projects/{project_id}/models/{model_id}/files/{init['file_id']}",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 204
    assert init["storage_key"] not in fake.objects
    assert init["storage_key"] in fake.deleted

    listing = await client.get(
        f"/projects/{project_id}/models/{model_id}/files?status=all",
        headers=_auth(org_user["access_token"]),
    )
    assert listing.json() == []


async def test_delete_unknown_file_returns_404(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, _ = fake_storage_client
    project_id, model_id = await _project_and_model(
        client, org_user["access_token"], project_name="DelUnknown"
    )
    resp = await client.delete(
        f"/projects/{project_id}/models/{model_id}/files/{uuid4()}",
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
    project_id, model_id = await _project_and_model(
        client, org_user["access_token"], project_name="DelViewer"
    )
    await _add_member(client, org_user["access_token"], project_id, same_org_user["id"], "viewer")
    init = (
        await client.post(
            f"/projects/{project_id}/models/{model_id}/files/initiate",
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
        f"/projects/{project_id}/models/{model_id}/files/{init['file_id']}",
        headers=_auth(same_org_user["access_token"]),
    )
    assert resp.status_code == 403


# ---------------------------------------------------------------------------
# File-type locking
# ---------------------------------------------------------------------------


async def test_initiate_locked_model_rejects_different_type(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    """Once an IFC file is ready, uploading a PDF to the same model is rejected."""
    client, fake = fake_storage_client
    project_id, model_id = await _project_and_model(
        client, org_user["access_token"], project_name="LockReject"
    )
    # Upload and complete an IFC file so the model is locked to IFC.
    init = (
        await client.post(
            f"/projects/{project_id}/models/{model_id}/files/initiate",
            json={
                "filename": "model.ifc",
                "size_bytes": len(VALID_IFC_HEADER),
                "content_type": "application/octet-stream",
            },
            headers=_auth(org_user["access_token"]),
        )
    ).json()
    fake.objects[init["storage_key"]] = VALID_IFC_HEADER
    complete_resp = await client.post(
        f"/projects/{project_id}/models/{model_id}/files/{init['file_id']}/complete",
        headers=_auth(org_user["access_token"]),
    )
    assert complete_resp.status_code == 200
    assert complete_resp.json()["status"] == "ready"

    # Now try to initiate a PDF upload — must be rejected.
    resp = await client.post(
        f"/projects/{project_id}/models/{model_id}/files/initiate",
        json={
            "filename": "drawing.pdf",
            "size_bytes": 1024,
            "content_type": "application/pdf",
        },
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 422, resp.text
    body = resp.json()
    assert body["detail"]["code"] == "MODEL_FILE_TYPE_LOCKED"
    assert body["detail"]["locked_to"] == "ifc"


async def test_initiate_locked_model_allows_same_type(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    """After an IFC file is ready, a second IFC upload is still allowed."""
    client, fake = fake_storage_client
    project_id, model_id = await _project_and_model(
        client, org_user["access_token"], project_name="LockAllow"
    )
    init = (
        await client.post(
            f"/projects/{project_id}/models/{model_id}/files/initiate",
            json={
                "filename": "model.ifc",
                "size_bytes": len(VALID_IFC_HEADER),
                "content_type": "application/octet-stream",
            },
            headers=_auth(org_user["access_token"]),
        )
    ).json()
    fake.objects[init["storage_key"]] = VALID_IFC_HEADER
    complete_resp = await client.post(
        f"/projects/{project_id}/models/{model_id}/files/{init['file_id']}/complete",
        headers=_auth(org_user["access_token"]),
    )
    assert complete_resp.status_code == 200

    # A second IFC initiate for the same model should still succeed.
    resp = await client.post(
        f"/projects/{project_id}/models/{model_id}/files/initiate",
        json={
            "filename": "model_v2.ifc",
            "size_bytes": len(VALID_IFC_HEADER),
            "content_type": "application/octet-stream",
        },
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 201, resp.text


# ---------------------------------------------------------------------------
# PDF upload + complete
# ---------------------------------------------------------------------------

VALID_PDF_BYTES = b"%PDF-1.7\n%test content\n"


async def test_initiate_pdf_succeeds(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, fake = fake_storage_client
    project_id, model_id = await _project_and_model(
        client, org_user["access_token"], project_name="PdfInit"
    )
    resp = await client.post(
        f"/projects/{project_id}/models/{model_id}/files/initiate",
        json={
            "filename": "drawing.pdf",
            "size_bytes": 2048,
            "content_type": "application/pdf",
        },
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["storage_key"].endswith(".pdf")


async def test_initiate_unknown_extension_rejected(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, _ = fake_storage_client
    project_id, model_id = await _project_and_model(
        client, org_user["access_token"], project_name="UnkExt"
    )
    for filename in ("model.dwg", "model.xyz", "model.step"):
        resp = await client.post(
            f"/projects/{project_id}/models/{model_id}/files/initiate",
            json={
                "filename": filename,
                "size_bytes": 100,
                "content_type": "application/octet-stream",
            },
            headers=_auth(org_user["access_token"]),
        )
        assert resp.status_code == 400, f"{filename}: {resp.text}"
        assert resp.json()["detail"] == "INVALID_FILE_EXTENSION"


async def test_complete_pdf_valid_marks_ready_no_extraction(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
    extraction_calls: list[dict[str, str]],
) -> None:
    client, fake = fake_storage_client
    project_id, model_id = await _project_and_model(
        client, org_user["access_token"], project_name="PdfComplete"
    )
    init = (
        await client.post(
            f"/projects/{project_id}/models/{model_id}/files/initiate",
            json={
                "filename": "plan.pdf",
                "size_bytes": len(VALID_PDF_BYTES),
                "content_type": "application/pdf",
            },
            headers=_auth(org_user["access_token"]),
        )
    ).json()
    fake.objects[init["storage_key"]] = VALID_PDF_BYTES

    resp = await client.post(
        f"/projects/{project_id}/models/{model_id}/files/{init['file_id']}/complete",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "ready"
    assert body["file_type"] == "pdf"
    assert body["ifc_schema"] is None
    assert body["extraction_status"] == "not_started"
    assert len(extraction_calls) == 0


async def test_complete_pdf_invalid_magic_rejects(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, fake = fake_storage_client
    project_id, model_id = await _project_and_model(
        client, org_user["access_token"], project_name="PdfBadMagic"
    )
    bad = b"this is not a pdf at all\n"
    init = (
        await client.post(
            f"/projects/{project_id}/models/{model_id}/files/initiate",
            json={
                "filename": "fake.pdf",
                "size_bytes": len(bad),
                "content_type": "application/pdf",
            },
            headers=_auth(org_user["access_token"]),
        )
    ).json()
    fake.objects[init["storage_key"]] = bad

    resp = await client.post(
        f"/projects/{project_id}/models/{model_id}/files/{init['file_id']}/complete",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "rejected"
    assert body["rejection_reason"] == "FILE_NOT_VALID_PDF"
    assert init["storage_key"] not in fake.objects
    assert init["storage_key"] in fake.deleted


async def test_viewer_bundle_pdf_returns_file_url(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, fake = fake_storage_client
    project_id, model_id = await _project_and_model(
        client, org_user["access_token"], project_name="PdfViewer"
    )
    init = (
        await client.post(
            f"/projects/{project_id}/models/{model_id}/files/initiate",
            json={
                "filename": "plan.pdf",
                "size_bytes": len(VALID_PDF_BYTES),
                "content_type": "application/pdf",
            },
            headers=_auth(org_user["access_token"]),
        )
    ).json()
    fake.objects[init["storage_key"]] = VALID_PDF_BYTES
    await client.post(
        f"/projects/{project_id}/models/{model_id}/files/{init['file_id']}/complete",
        headers=_auth(org_user["access_token"]),
    )

    resp = await client.get(
        f"/projects/{project_id}/models/{model_id}/files/{init['file_id']}/viewer-bundle",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["file_type"] == "pdf"
    assert body["file_url"] is not None
    assert body["file_url"].endswith("?download=plan.pdf")
    assert body["fragments_url"] is None
    assert body["expires_in"] == fake.presign_ttl_value
