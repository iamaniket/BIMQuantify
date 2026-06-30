"""Integration tests for project file uploads (now nested under Document).

Storage is mocked via dependency override so tests run without MinIO.
Shared fixtures (FakeStorage, fake_storage_client, _auth, _create_project,
_create_document, _add_member, VALID_IFC_HEADER) live in conftest.py.
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
    _create_document,
    _create_project,
    _new_hash,
)


async def _project_and_model(
    client: AsyncClient,
    token: str,
    project_name: str = "P1",
    document_name: str = "M1",
) -> tuple[str, str]:
    project = await _create_project(client, token, name=project_name)
    model = await _create_document(client, token, project["id"], name=document_name)
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
    project_id, document_id = await _project_and_model(client, org_user["access_token"])
    resp = await client.post(
        f"/projects/{project_id}/documents/{document_id}/files/initiate",
        json={
            "filename": "model.ifc",
            "size_bytes": 1024,
            "content_type": "application/octet-stream",
            "content_sha256": "300c0f07fde9fa9b8dccbd31d742d3fc7b71a469c5c9ba1a634e64a9fa400e2f",
        },
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["upload_url"].startswith("http://fake-storage/")
    assert body["storage_key"].startswith(f"projects/{project_id}/documents/{document_id}/")
    assert body["storage_key"].endswith(".ifc")
    assert "file_id" in body
    assert body["expires_in"] == fake.presign_ttl_value


async def test_initiate_assigns_version_number_1_for_first_file(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, _ = fake_storage_client
    project_id, document_id = await _project_and_model(
        client, org_user["access_token"], document_name="V1"
    )
    init = (
        await client.post(
            f"/projects/{project_id}/documents/{document_id}/files/initiate",
            json={
                "filename": "first.ifc",
                "size_bytes": 100,
                "content_type": "application/octet-stream",
                "content_sha256": "54846f0be0201682eebd9f203acdc3fca3959b17cd6e3c9757dd5ef3e98a5631",
            },
            headers=_auth(org_user["access_token"]),
        )
    ).json()

    listing = await client.get(
        f"/projects/{project_id}/documents/{document_id}/files?status=all",
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
    project_id, document_id = await _project_and_model(
        client, org_user["access_token"], document_name="VInc"
    )
    for i in range(3):
        await client.post(
            f"/projects/{project_id}/documents/{document_id}/files/initiate",
            json={
                "filename": f"v{i}.ifc",
                "size_bytes": 100,
                "content_type": "application/octet-stream",
                "content_sha256": _new_hash(),
            },
            headers=_auth(org_user["access_token"]),
        )

    listing = await client.get(
        f"/projects/{project_id}/documents/{document_id}/files?status=all",
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
    a = await _create_document(client, org_user["access_token"], project["id"], name="A")
    b = await _create_document(client, org_user["access_token"], project["id"], name="B")

    for model in (a, b):
        await client.post(
            f"/projects/{project['id']}/documents/{model['id']}/files/initiate",
            json={
                "filename": "f.ifc",
                "size_bytes": 100,
                "content_type": "application/octet-stream",
                "content_sha256": _new_hash(),
            },
            headers=_auth(org_user["access_token"]),
        )

    for model in (a, b):
        listing = (
            await client.get(
                f"/projects/{project['id']}/documents/{model['id']}/files?status=all",
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
    project_id, document_id = await _project_and_model(
        client, org_user["access_token"], project_name="ShareEditor"
    )
    resp = await client.post(
        f"/projects/{project_id}/documents/{document_id}/files/initiate",
        json={
            "filename": "x.ifc",
            "size_bytes": 100,
            "content_type": "application/octet-stream",
            "content_sha256": "9c95f91b4579b507d9af0db70dd312e86c9da9c8b3892f03b062ed5cf06d0135",
        },
        headers=_auth(same_org_user["access_token"]),
    )
    assert resp.status_code == 201


async def test_initiate_viewer_forbidden(
    org_user: dict[str, str],
    same_org_non_admin_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, _ = fake_storage_client
    project_id, document_id = await _project_and_model(
        client, org_user["access_token"], project_name="LockedV"
    )
    await _add_member(
        client, org_user["access_token"], project_id, same_org_non_admin_user["id"], "viewer"
    )
    resp = await client.post(
        f"/projects/{project_id}/documents/{document_id}/files/initiate",
        json={
            "filename": "x.ifc",
            "size_bytes": 100,
            "content_type": "application/octet-stream",
            "content_sha256": "804615e99933939d6d99b0122be4a767c4f66008e3a8660655266eb4a852309a",
        },
        headers=_auth(same_org_non_admin_user["access_token"]),
    )
    assert resp.status_code == 403


async def test_initiate_rejects_non_ifc_extension(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, _ = fake_storage_client
    project_id, document_id = await _project_and_model(
        client, org_user["access_token"], project_name="ExtCheck"
    )
    resp = await client.post(
        f"/projects/{project_id}/documents/{document_id}/files/initiate",
        json={
            "filename": "model.txt",
            "size_bytes": 100,
            "content_type": "text/plain",
            "content_sha256": "0ff78641601947f0de6f1ec7f71320b1ac094385a5c75110f7fc3c04ecf31cc5",
        },
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
    from bimdossier_api.config import get_settings

    get_settings.cache_clear()
    try:
        client, _ = fake_storage_client
        project_id, document_id = await _project_and_model(
            client, org_user["access_token"], project_name="SizeCap"
        )
        resp = await client.post(
            f"/projects/{project_id}/documents/{document_id}/files/initiate",
            json={
                "filename": "huge.ifc",
                "size_bytes": 4096,
                "content_type": "application/octet-stream",
                "content_sha256": "c18706a78c14baf4861722444ed76c36e87cd7351ee74328a31f34fabf3690b4",
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
    project_id, document_id = await _project_and_model(
        client, org_user["access_token"], project_name="AOnly"
    )
    resp = await client.post(
        f"/projects/{project_id}/documents/{document_id}/files/initiate",
        json={
            "filename": "x.ifc",
            "size_bytes": 100,
            "content_type": "application/octet-stream",
            "content_sha256": "120c25fad76244243e534863a961eb7c1f5085d520c9f1822c47afb3231b3da3",
        },
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
        f"/projects/{project['id']}/documents/{uuid4()}/files/initiate",
        json={
            "filename": "x.ifc",
            "size_bytes": 100,
            "content_type": "application/octet-stream",
            "content_sha256": "872161d28afc2d9d40e7c172c4f4f3a30de204b80da0b5148a9604b0c257ce66",
        },
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 404
    assert resp.json()["detail"] == "DOCUMENT_NOT_FOUND"


# ---------------------------------------------------------------------------
# complete
# ---------------------------------------------------------------------------


async def test_complete_happy_path_marks_ready(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, fake = fake_storage_client
    project_id, document_id = await _project_and_model(
        client, org_user["access_token"], project_name="HappyComplete"
    )
    init = (
        await client.post(
            f"/projects/{project_id}/documents/{document_id}/files/initiate",
            json={
                "filename": "m.ifc",
                "size_bytes": len(VALID_IFC_HEADER),
                "content_type": "application/octet-stream",
                "content_sha256": "ab2f3952733bbc52e62a505f7fd39e7649eb6b2b59d8598b1aabe153479b5933",
            },
            headers=_auth(org_user["access_token"]),
        )
    ).json()

    fake.objects[init["storage_key"]] = VALID_IFC_HEADER

    resp = await client.post(
        f"/projects/{project_id}/documents/{document_id}/files/{init['file_id']}/complete",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "ready"
    assert body["ifc_schema"] == "IFC4"
    assert body["rejection_reason"] is None
    assert body["document_id"] == document_id
    assert body["version_number"] == 1


async def test_complete_invalid_bytes_marks_rejected_and_deletes_object(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, fake = fake_storage_client
    project_id, document_id = await _project_and_model(
        client, org_user["access_token"], project_name="BadBytes"
    )
    bad = b"this is not an IFC file at all\n" * 4
    init = (
        await client.post(
            f"/projects/{project_id}/documents/{document_id}/files/initiate",
            json={
                "filename": "fake.ifc",
                "size_bytes": len(bad),
                "content_type": "application/octet-stream",
                "content_sha256": "83d4cf4edeb97f584e5e193b0472c5ed11dadf0cb24aad28845f6f28a33a3beb",
            },
            headers=_auth(org_user["access_token"]),
        )
    ).json()
    fake.objects[init["storage_key"]] = bad

    resp = await client.post(
        f"/projects/{project_id}/documents/{document_id}/files/{init['file_id']}/complete",
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
    project_id, document_id = await _project_and_model(
        client, org_user["access_token"], project_name="GapP"
    )
    bad = b"not ifc\n"
    init1 = (
        await client.post(
            f"/projects/{project_id}/documents/{document_id}/files/initiate",
            json={
                "filename": "v1.ifc",
                "size_bytes": len(bad),
                "content_type": "application/octet-stream",
                "content_sha256": "427f3937ec1468da67481a3619808a4eb2508b2a26cae6f2e65c2cdca0f8d72d",
            },
            headers=_auth(org_user["access_token"]),
        )
    ).json()
    fake.objects[init1["storage_key"]] = bad
    rejected = await client.post(
        f"/projects/{project_id}/documents/{document_id}/files/{init1['file_id']}/complete",
        headers=_auth(org_user["access_token"]),
    )
    assert rejected.json()["status"] == "rejected"

    init2 = (
        await client.post(
            f"/projects/{project_id}/documents/{document_id}/files/initiate",
            json={
                "filename": "v2.ifc",
                "size_bytes": 100,
                "content_type": "application/octet-stream",
                "content_sha256": "a475b73afce04b8b75db97e89863f5a1d8823dcdb14d69de23f8693fbbb21aee",
            },
            headers=_auth(org_user["access_token"]),
        )
    ).json()

    listing = await client.get(
        f"/projects/{project_id}/documents/{document_id}/files?status=all",
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
    project_id, document_id = await _project_and_model(
        client, org_user["access_token"], project_name="NoUpload"
    )
    init = (
        await client.post(
            f"/projects/{project_id}/documents/{document_id}/files/initiate",
            json={
                "filename": "m.ifc",
                "size_bytes": 1024,
                "content_type": "application/octet-stream",
                "content_sha256": "cffa066c7651dea114922a95bee25490399cd0ba83d8d1711b20f58b5484ef64",
            },
            headers=_auth(org_user["access_token"]),
        )
    ).json()
    resp = await client.post(
        f"/projects/{project_id}/documents/{document_id}/files/{init['file_id']}/complete",
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
    project_id, document_id = await _project_and_model(
        client, org_user["access_token"], project_name="SizeMismatch"
    )
    init = (
        await client.post(
            f"/projects/{project_id}/documents/{document_id}/files/initiate",
            json={
                "filename": "m.ifc",
                "size_bytes": 9999,
                "content_type": "application/octet-stream",
                "content_sha256": "0eeb8a484e66a7db595afe28a24d496d4b8c1269f94a3e7a3da7f735264e0e6d",
            },
            headers=_auth(org_user["access_token"]),
        )
    ).json()
    fake.objects[init["storage_key"]] = VALID_IFC_HEADER

    resp = await client.post(
        f"/projects/{project_id}/documents/{document_id}/files/{init['file_id']}/complete",
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
    project_id, document_id = await _project_and_model(
        client, org_user["access_token"], project_name="DoubleComplete"
    )
    init = (
        await client.post(
            f"/projects/{project_id}/documents/{document_id}/files/initiate",
            json={
                "filename": "m.ifc",
                "size_bytes": len(VALID_IFC_HEADER),
                "content_type": "application/octet-stream",
                "content_sha256": "3082812976234469484f2a0b5f8dacea662a95e3550c66bcbef780e890961135",
            },
            headers=_auth(org_user["access_token"]),
        )
    ).json()
    fake.objects[init["storage_key"]] = VALID_IFC_HEADER
    first = await client.post(
        f"/projects/{project_id}/documents/{document_id}/files/{init['file_id']}/complete",
        headers=_auth(org_user["access_token"]),
    )
    assert first.status_code == 200
    second = await client.post(
        f"/projects/{project_id}/documents/{document_id}/files/{init['file_id']}/complete",
        headers=_auth(org_user["access_token"]),
    )
    assert second.status_code == 409
    assert second.json()["detail"] == "FILE_ALREADY_FINALIZED"


# ---------------------------------------------------------------------------
# ifcZIP (compressed IFC) upload + complete
# ---------------------------------------------------------------------------

# Minimal bytes that open with the zip local-file-header magic. The processor
# (not the API) decompresses and validates the inner IFC; the API only checks
# the magic, so a header-only blob is enough to exercise the accept path.
VALID_IFCZIP_BYTES = b"PK\x03\x04" + b"\x00" * 60


async def test_initiate_ifczip_succeeds(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, _ = fake_storage_client
    project_id, document_id = await _project_and_model(
        client, org_user["access_token"], project_name="IfczipInit"
    )
    resp = await client.post(
        f"/projects/{project_id}/documents/{document_id}/files/initiate",
        json={
            "filename": "model.ifczip",
            "size_bytes": len(VALID_IFCZIP_BYTES),
            "content_type": "application/octet-stream",
            "content_sha256": _new_hash(),
        },
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["storage_key"].endswith(".ifczip")


async def test_complete_ifczip_marks_ready_and_dispatches_compressed(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
    extraction_calls: list[dict[str, str]],
) -> None:
    """A valid zip is accepted without header-sniffing: schema stays unknown and
    the extraction job is dispatched with compressed=True so the processor
    decompresses before opening the model."""
    client, fake = fake_storage_client
    project_id, document_id = await _project_and_model(
        client, org_user["access_token"], project_name="IfczipComplete"
    )
    init = (
        await client.post(
            f"/projects/{project_id}/documents/{document_id}/files/initiate",
            json={
                "filename": "model.ifczip",
                "size_bytes": len(VALID_IFCZIP_BYTES),
                "content_type": "application/octet-stream",
                "content_sha256": _new_hash(),
            },
            headers=_auth(org_user["access_token"]),
        )
    ).json()
    fake.objects[init["storage_key"]] = VALID_IFCZIP_BYTES

    resp = await client.post(
        f"/projects/{project_id}/documents/{document_id}/files/{init['file_id']}/complete",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "ready"
    assert body["file_type"] == "ifc"
    # Schema is deferred to the processor — not knowable from the zip wrapper.
    assert body["ifc_schema"] == "unknown"
    assert body["rejection_reason"] is None
    assert body["extraction_status"] == "queued"

    assert len(extraction_calls) == 1
    assert extraction_calls[0]["job_type"] == "ifc_extraction"
    assert extraction_calls[0]["payload"]["compressed"] is True


async def test_complete_ifczip_non_zip_marks_rejected(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
    extraction_calls: list[dict[str, str]],
) -> None:
    """An .ifczip whose bytes aren't a zip is rejected at complete — no job
    dispatched, the object is deleted."""
    client, fake = fake_storage_client
    project_id, document_id = await _project_and_model(
        client, org_user["access_token"], project_name="IfczipBadMagic"
    )
    bad = b"ISO-10303-21;\nHEADER;\n"  # a raw IFC, not a zip
    init = (
        await client.post(
            f"/projects/{project_id}/documents/{document_id}/files/initiate",
            json={
                "filename": "fake.ifczip",
                "size_bytes": len(bad),
                "content_type": "application/octet-stream",
                "content_sha256": _new_hash(),
            },
            headers=_auth(org_user["access_token"]),
        )
    ).json()
    fake.objects[init["storage_key"]] = bad

    resp = await client.post(
        f"/projects/{project_id}/documents/{document_id}/files/{init['file_id']}/complete",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "rejected"
    assert body["rejection_reason"] == "FILE_NOT_VALID_IFCZIP"
    assert init["storage_key"] not in fake.objects
    assert init["storage_key"] in fake.deleted
    assert len(extraction_calls) == 0


# ---------------------------------------------------------------------------
# list
# ---------------------------------------------------------------------------


async def test_list_files_default_returns_only_ready(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, fake = fake_storage_client
    project_id, document_id = await _project_and_model(
        client, org_user["access_token"], project_name="Listing"
    )

    # Ready file.
    init1 = (
        await client.post(
            f"/projects/{project_id}/documents/{document_id}/files/initiate",
            json={
                "filename": "ok.ifc",
                "size_bytes": len(VALID_IFC_HEADER),
                "content_type": "application/octet-stream",
                "content_sha256": "5b51c80337c12841bfccdca60bff4fb393f3a68d7222631a0f564de6d02ea92a",
            },
            headers=_auth(org_user["access_token"]),
        )
    ).json()
    fake.objects[init1["storage_key"]] = VALID_IFC_HEADER
    await client.post(
        f"/projects/{project_id}/documents/{document_id}/files/{init1['file_id']}/complete",
        headers=_auth(org_user["access_token"]),
    )

    # Pending file (no complete).
    await client.post(
        f"/projects/{project_id}/documents/{document_id}/files/initiate",
        json={
            "filename": "pending.ifc",
            "size_bytes": 1024,
            "content_type": "application/octet-stream",
            "content_sha256": "5cc56dcffee774e160350feee2abdc6ba580a470d83aeaef7900d4e8279d9255",
        },
        headers=_auth(org_user["access_token"]),
    )

    default_resp = await client.get(
        f"/projects/{project_id}/documents/{document_id}/files",
        headers=_auth(org_user["access_token"]),
    )
    assert default_resp.status_code == 200
    default_files = default_resp.json()
    assert [f["original_filename"] for f in default_files] == ["ok.ifc"]

    all_resp = await client.get(
        f"/projects/{project_id}/documents/{document_id}/files?status=all",
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
    a = await _create_document(client, org_user["access_token"], project["id"], name="A")
    b = await _create_document(client, org_user["access_token"], project["id"], name="B")

    for _ in range(2):
        await client.post(
            f"/projects/{project['id']}/documents/{a['id']}/files/initiate",
            json={
                "filename": "f.ifc",
                "size_bytes": 100,
                "content_type": "application/octet-stream",
                "content_sha256": _new_hash(),
            },
            headers=_auth(org_user["access_token"]),
        )
    await client.post(
        f"/projects/{project['id']}/documents/{b['id']}/files/initiate",
        json={
            "filename": "f.ifc",
            "size_bytes": 100,
            "content_type": "application/octet-stream",
            "content_sha256": "6aa1b09f0c8e2fe17d08096708acc59a9200aaf7096fdb060cc7eb26f72efaf4",
        },
        headers=_auth(org_user["access_token"]),
    )

    a_list = (
        await client.get(
            f"/projects/{project['id']}/documents/{a['id']}/files?status=all",
            headers=_auth(org_user["access_token"]),
        )
    ).json()
    b_list = (
        await client.get(
            f"/projects/{project['id']}/documents/{b['id']}/files?status=all",
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
    project_id, document_id = await _project_and_model(
        client, org_user["access_token"], project_name="DL"
    )
    init = (
        await client.post(
            f"/projects/{project_id}/documents/{document_id}/files/initiate",
            json={
                "filename": "down.ifc",
                "size_bytes": len(VALID_IFC_HEADER),
                "content_type": "application/octet-stream",
                "content_sha256": "1b3448f938a9f9798fc7cac0916a738a1f7ccb754000c47a43ffddc2500d081c",
            },
            headers=_auth(org_user["access_token"]),
        )
    ).json()
    fake.objects[init["storage_key"]] = VALID_IFC_HEADER
    await client.post(
        f"/projects/{project_id}/documents/{document_id}/files/{init['file_id']}/complete",
        headers=_auth(org_user["access_token"]),
    )

    resp = await client.get(
        f"/projects/{project_id}/documents/{document_id}/files/{init['file_id']}/download",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 200
    body = resp.json()
    assert "?download=down.ifc" in body["download_url"]
    assert body["expires_in"] == fake.presign_ttl_value


async def test_download_404_for_pending_file(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, _ = fake_storage_client
    project_id, document_id = await _project_and_model(
        client, org_user["access_token"], project_name="DLPending"
    )
    init = (
        await client.post(
            f"/projects/{project_id}/documents/{document_id}/files/initiate",
            json={
                "filename": "p.ifc",
                "size_bytes": 100,
                "content_type": "application/octet-stream",
                "content_sha256": "2c4f106ac62a5fdd097e7f5394c74cceeb9b56d6a72ea3fc9d55c6095e7606af",
            },
            headers=_auth(org_user["access_token"]),
        )
    ).json()
    resp = await client.get(
        f"/projects/{project_id}/documents/{document_id}/files/{init['file_id']}/download",
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
    project_id, document_id = await _project_and_model(
        client, org_user["access_token"], project_name="DelP"
    )
    init = (
        await client.post(
            f"/projects/{project_id}/documents/{document_id}/files/initiate",
            json={
                "filename": "del.ifc",
                "size_bytes": len(VALID_IFC_HEADER),
                "content_type": "application/octet-stream",
                "content_sha256": "ae85eeb1018984140c5ea2f85baf0fa5a776a16e988bafaa66ea8e637d47f46d",
            },
            headers=_auth(org_user["access_token"]),
        )
    ).json()
    fake.objects[init["storage_key"]] = VALID_IFC_HEADER

    resp = await client.delete(
        f"/projects/{project_id}/documents/{document_id}/files/{init['file_id']}",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 204
    assert init["storage_key"] not in fake.objects
    assert init["storage_key"] in fake.deleted

    listing = await client.get(
        f"/projects/{project_id}/documents/{document_id}/files?status=all",
        headers=_auth(org_user["access_token"]),
    )
    assert listing.json() == []


async def test_delete_unknown_file_returns_404(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, _ = fake_storage_client
    project_id, document_id = await _project_and_model(
        client, org_user["access_token"], project_name="DelUnknown"
    )
    resp = await client.delete(
        f"/projects/{project_id}/documents/{document_id}/files/{uuid4()}",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 404


async def test_delete_viewer_forbidden(
    org_user: dict[str, str],
    same_org_non_admin_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, fake = fake_storage_client
    project_id, document_id = await _project_and_model(
        client, org_user["access_token"], project_name="DelViewer"
    )
    await _add_member(
        client, org_user["access_token"], project_id, same_org_non_admin_user["id"], "viewer"
    )
    init = (
        await client.post(
            f"/projects/{project_id}/documents/{document_id}/files/initiate",
            json={
                "filename": "x.ifc",
                "size_bytes": len(VALID_IFC_HEADER),
                "content_type": "application/octet-stream",
                "content_sha256": "fc0b86876bf7343bafccff5c90bed47085fdce455d794c22ed7753cc2fff1882",
            },
            headers=_auth(org_user["access_token"]),
        )
    ).json()
    fake.objects[init["storage_key"]] = VALID_IFC_HEADER

    resp = await client.delete(
        f"/projects/{project_id}/documents/{document_id}/files/{init['file_id']}",
        headers=_auth(same_org_non_admin_user["access_token"]),
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
    project_id, document_id = await _project_and_model(
        client, org_user["access_token"], project_name="LockReject"
    )
    # Upload and complete an IFC file so the model is locked to IFC.
    init = (
        await client.post(
            f"/projects/{project_id}/documents/{document_id}/files/initiate",
            json={
                "filename": "model.ifc",
                "size_bytes": len(VALID_IFC_HEADER),
                "content_type": "application/octet-stream",
                "content_sha256": "437fdcfdf000171cc0553191d92d358095d4a1539136e5f83af698a3fea38069",
            },
            headers=_auth(org_user["access_token"]),
        )
    ).json()
    fake.objects[init["storage_key"]] = VALID_IFC_HEADER
    complete_resp = await client.post(
        f"/projects/{project_id}/documents/{document_id}/files/{init['file_id']}/complete",
        headers=_auth(org_user["access_token"]),
    )
    assert complete_resp.status_code == 200
    assert complete_resp.json()["status"] == "ready"

    # Now try to initiate a PDF upload — must be rejected.
    resp = await client.post(
        f"/projects/{project_id}/documents/{document_id}/files/initiate",
        json={
            "filename": "drawing.pdf",
            "size_bytes": 1024,
            "content_type": "application/pdf",
            "content_sha256": "b5a8e2bfb470d2bb639c99f9e316f26dbdb86a9e20208535909f0e2e8586ea72",
        },
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 422, resp.text
    body = resp.json()
    assert body["detail"]["code"] == "DOCUMENT_FILE_TYPE_LOCKED"
    assert body["detail"]["locked_to"] == "ifc"


async def test_initiate_locked_model_allows_same_type(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    """After an IFC file is ready, a second IFC upload is still allowed."""
    client, fake = fake_storage_client
    project_id, document_id = await _project_and_model(
        client, org_user["access_token"], project_name="LockAllow"
    )
    init = (
        await client.post(
            f"/projects/{project_id}/documents/{document_id}/files/initiate",
            json={
                "filename": "model.ifc",
                "size_bytes": len(VALID_IFC_HEADER),
                "content_type": "application/octet-stream",
                "content_sha256": "23936f6f5c78d879a45c12849866019542c71619b439ca7d11af98265ec0ad87",
            },
            headers=_auth(org_user["access_token"]),
        )
    ).json()
    fake.objects[init["storage_key"]] = VALID_IFC_HEADER
    complete_resp = await client.post(
        f"/projects/{project_id}/documents/{document_id}/files/{init['file_id']}/complete",
        headers=_auth(org_user["access_token"]),
    )
    assert complete_resp.status_code == 200

    # A second IFC initiate for the same model should still succeed.
    resp = await client.post(
        f"/projects/{project_id}/documents/{document_id}/files/initiate",
        json={
            "filename": "model_v2.ifc",
            "size_bytes": len(VALID_IFC_HEADER),
            "content_type": "application/octet-stream",
            "content_sha256": "ae675f5d6a7daec4943c2ab1e376b0600dab546dc2a1641992e631bb2d14793f",
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
    project_id, document_id = await _project_and_model(
        client, org_user["access_token"], project_name="PdfInit"
    )
    resp = await client.post(
        f"/projects/{project_id}/documents/{document_id}/files/initiate",
        json={
            "filename": "drawing.pdf",
            "size_bytes": 2048,
            "content_type": "application/pdf",
            "content_sha256": "0703d4a951c38f0d39ceb10e266c29a23c419d5fe31ebdf92d0162020a355d99",
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
    project_id, document_id = await _project_and_model(
        client, org_user["access_token"], project_name="UnkExt"
    )
    for filename in ("model.rvt", "model.xyz", "model.step"):
        resp = await client.post(
            f"/projects/{project_id}/documents/{document_id}/files/initiate",
            json={
                "filename": filename,
                "size_bytes": 100,
                "content_type": "application/octet-stream",
                "content_sha256": "431af265da6aaacae3b9755eb5358a8dfa4e8d424d838fa6cf01acfd8fcaae13",
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
    project_id, document_id = await _project_and_model(
        client, org_user["access_token"], project_name="PdfComplete"
    )
    init = (
        await client.post(
            f"/projects/{project_id}/documents/{document_id}/files/initiate",
            json={
                "filename": "plan.pdf",
                "size_bytes": len(VALID_PDF_BYTES),
                "content_type": "application/pdf",
                "content_sha256": "234ac5e8a6bb4eec5b183218e879e5e89a49c125c99260c9c8ea4af8579ae298",
            },
            headers=_auth(org_user["access_token"]),
        )
    ).json()
    fake.objects[init["storage_key"]] = VALID_PDF_BYTES

    resp = await client.post(
        f"/projects/{project_id}/documents/{document_id}/files/{init['file_id']}/complete",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "ready"
    assert body["file_type"] == "pdf"
    assert body["ifc_schema"] is None
    assert body["extraction_status"] == "queued"
    # PDF complete dispatches BOTH extraction (metadata + geometry) and
    # page-image rasterization (mobile pdfjs-free viewer underlay), in parallel.
    assert len(extraction_calls) == 2
    job_types = {c["job_type"] for c in extraction_calls}
    assert job_types == {"pdf_extraction", "pdf_pages_rasterization"}


async def test_complete_pdf_invalid_magic_rejects(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, fake = fake_storage_client
    project_id, document_id = await _project_and_model(
        client, org_user["access_token"], project_name="PdfBadMagic"
    )
    bad = b"this is not a pdf at all\n"
    init = (
        await client.post(
            f"/projects/{project_id}/documents/{document_id}/files/initiate",
            json={
                "filename": "fake.pdf",
                "size_bytes": len(bad),
                "content_type": "application/pdf",
                "content_sha256": "89c7a536cb506f119978d83286efee1f23f7cbbc65e9c7a4d5ab2605070e4a9d",
            },
            headers=_auth(org_user["access_token"]),
        )
    ).json()
    fake.objects[init["storage_key"]] = bad

    resp = await client.post(
        f"/projects/{project_id}/documents/{document_id}/files/{init['file_id']}/complete",
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
    project_id, document_id = await _project_and_model(
        client, org_user["access_token"], project_name="PdfViewer"
    )
    init = (
        await client.post(
            f"/projects/{project_id}/documents/{document_id}/files/initiate",
            json={
                "filename": "plan.pdf",
                "size_bytes": len(VALID_PDF_BYTES),
                "content_type": "application/pdf",
                "content_sha256": "a7570660cf84bb15a36183bee1ce0dd866576a6be25a9744cd37744a440e80e5",
            },
            headers=_auth(org_user["access_token"]),
        )
    ).json()
    fake.objects[init["storage_key"]] = VALID_PDF_BYTES
    await client.post(
        f"/projects/{project_id}/documents/{document_id}/files/{init['file_id']}/complete",
        headers=_auth(org_user["access_token"]),
    )

    resp = await client.get(
        f"/projects/{project_id}/documents/{document_id}/files/{init['file_id']}/viewer-bundle",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["file_type"] == "pdf"
    assert body["file_url"] is not None
    assert "?download=plan.pdf" in body["file_url"]
    assert body["fragments_url"] is None
    assert body["geometry_url"] is None
    assert body["outline_url"] is None
    assert body["expires_in"] == fake.presign_ttl_value


async def test_pdf_callback_persists_geometry_and_bundle_serves_it(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    """A PDF extractor callback carrying geometry_key persists it, and the
    viewer-bundle then presigns a geometry_url."""
    client, fake = fake_storage_client
    project_id, document_id = await _project_and_model(
        client, org_user["access_token"], project_name="PdfGeometry"
    )
    init = (
        await client.post(
            f"/projects/{project_id}/documents/{document_id}/files/initiate",
            json={
                "filename": "plan.pdf",
                "size_bytes": len(VALID_PDF_BYTES),
                "content_type": "application/pdf",
                "content_sha256": "a7570660cf84bb15a36183bee1ce0dd866576a6be25a9744cd37744a440e80e5",
            },
            headers=_auth(org_user["access_token"]),
        )
    ).json()
    fake.objects[init["storage_key"]] = VALID_PDF_BYTES
    await client.post(
        f"/projects/{project_id}/documents/{document_id}/files/{init['file_id']}/complete",
        headers=_auth(org_user["access_token"]),
    )

    geometry_key = init["storage_key"].replace(".pdf", ".geometry.json")
    callback = await client.post(
        "/internal/jobs/callback",
        json={
            "file_id": init["file_id"],
            "organization_id": org_user["organization_id"],
            "status": "succeeded",
            "metadata_key": f"projects/{project_id}/meta.json",
            "geometry_key": geometry_key,
            "page_count": 1,
        },
        headers={"Authorization": "Bearer dev-shared-secret-change-me"},
    )
    assert callback.status_code == 200, callback.text
    assert callback.json()["extraction_status"] == "succeeded"

    resp = await client.get(
        f"/projects/{project_id}/documents/{document_id}/files/{init['file_id']}/viewer-bundle",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["file_type"] == "pdf"
    assert body["geometry_url"] is not None
    assert "geometry.json" in body["geometry_url"]


async def test_viewer_bundle_pdf_rewrites_pages_manifest_to_presigned_urls(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    """The mobile viewer's ImageRasterSource reads each page's `url`; the
    processor writes a raw `key`. The viewer-bundle must rewrite the manifest —
    presigning every page key into a fetchable url — and inline it as a data:
    URL. Regression guard for the cross-seam contract mismatch that rendered
    zero pages on mobile."""
    import base64 as _b64
    import json as _json

    client, fake = fake_storage_client
    project_id, document_id = await _project_and_model(
        client, org_user["access_token"], project_name="PdfPages"
    )
    init = (
        await client.post(
            f"/projects/{project_id}/documents/{document_id}/files/initiate",
            json={
                "filename": "plan.pdf",
                "size_bytes": len(VALID_PDF_BYTES),
                "content_type": "application/pdf",
                "content_sha256": "deadbeef" * 8,
            },
            headers=_auth(org_user["access_token"]),
        )
    ).json()
    fake.objects[init["storage_key"]] = VALID_PDF_BYTES
    await client.post(
        f"/projects/{project_id}/documents/{document_id}/files/{init['file_id']}/complete",
        headers=_auth(org_user["access_token"]),
    )

    # The processor uploads pages.json with raw S3 `key`s (no url).
    manifest_key = f"projects/{project_id}/{init['file_id']}.pages.json"
    image_key = f"projects/{project_id}/{init['file_id']}.page-0.webp"
    fake.objects[manifest_key] = _json.dumps(
        {
            "v": 1,
            "pages": [
                {
                    "index": 0,
                    "pageWidth": 595.3,
                    "pageHeight": 841.9,
                    "imageWidth": 2480,
                    "imageHeight": 3508,
                    "key": image_key,
                }
            ],
        }
    ).encode()
    cb = await client.post(
        "/internal/jobs/pages/callback",
        json={
            "file_id": init["file_id"],
            "organization_id": org_user["organization_id"],
            "status": "succeeded",
            "pdf_pages_key": manifest_key,
            "page_count": 1,
        },
        headers=_WORKER_AUTH,
    )
    assert cb.status_code == 200, cb.text

    resp = await client.get(
        f"/projects/{project_id}/documents/{document_id}/files/{init['file_id']}/viewer-bundle",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 200, resp.text
    pages_url = resp.json()["pdf_pages_url"]
    assert pages_url is not None
    assert pages_url.startswith("data:application/json;base64,")

    decoded = _json.loads(_b64.b64decode(pages_url.split(",", 1)[1]))
    page0 = decoded["pages"][0]
    # The page now carries a fetchable url (presigned), not a raw key.
    assert "key" not in page0
    assert page0["url"] is not None and image_key in page0["url"]
    # Geometry is preserved so the viewer can size the world-space page box.
    assert page0["pageWidth"] == 595.3
    assert page0["index"] == 0


async def _complete_ready_pdf(
    client: AsyncClient,
    fake: FakeStorage,
    org_user: dict[str, str],
    sha: str,
    name: str = "plan.pdf",
) -> tuple[str, str, str]:
    """Initiate + complete a valid PDF; returns (project_id, document_id, file_id)."""
    project_id, document_id = await _project_and_model(
        client, org_user["access_token"], project_name=f"Pdf-{sha[:6]}"
    )
    init = (
        await client.post(
            f"/projects/{project_id}/documents/{document_id}/files/initiate",
            json={
                "filename": name,
                "size_bytes": len(VALID_PDF_BYTES),
                "content_type": "application/pdf",
                "content_sha256": sha,
            },
            headers=_auth(org_user["access_token"]),
        )
    ).json()
    fake.objects[init["storage_key"]] = VALID_PDF_BYTES
    await client.post(
        f"/projects/{project_id}/documents/{document_id}/files/{init['file_id']}/complete",
        headers=_auth(org_user["access_token"]),
    )
    return project_id, document_id, init["file_id"]


_WORKER_AUTH = {"Authorization": "Bearer dev-shared-secret-change-me"}


async def test_pages_callback_persists_manifest_and_bundle_serves_it(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    """A succeeded pdf_pages_rasterization callback persists the manifest key, and
    the viewer-bundle then reads that manifest, presigns each page image, and
    inlines the rewritten manifest as a base64 ``data:`` URL for the mobile viewer
    (see ``_build_pdf_pages_manifest_url`` — the manifest key never leaks to the
    client; only presigned page URLs do)."""
    import base64
    import json

    client, fake = fake_storage_client
    project_id, document_id, file_id = await _complete_ready_pdf(
        client, fake, org_user, "1111111111111111111111111111111111111111111111111111111111111111"
    )

    # The worker uploads the page-image manifest object; the callback only carries
    # its KEY. Simulate that upload so the bundle can read + presign it.
    manifest_key = f"projects/{project_id}/doc/plan.pages.json"
    page_key = f"projects/{project_id}/doc/pages/page-0.webp"
    fake.objects[manifest_key] = json.dumps(
        {
            "pages": [
                {
                    "key": page_key,
                    "index": 0,
                    "pageWidth": 800,
                    "pageHeight": 600,
                    "imageWidth": 1600,
                    "imageHeight": 1200,
                }
            ]
        }
    ).encode()

    cb = await client.post(
        "/internal/jobs/pages/callback",
        json={
            "file_id": file_id,
            "organization_id": org_user["organization_id"],
            "status": "succeeded",
            "pdf_pages_key": manifest_key,
            "page_count": 3,
        },
        headers=_WORKER_AUTH,
    )
    assert cb.status_code == 200, cb.text

    resp = await client.get(
        f"/projects/{project_id}/documents/{document_id}/files/{file_id}/viewer-bundle",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["file_type"] == "pdf"
    # New behavior: the manifest is rewritten + inlined as a base64 data: URL whose
    # page entries carry presigned image URLs (the raw manifest key never leaks).
    assert body["pdf_pages_url"] is not None
    assert body["pdf_pages_url"].startswith("data:application/json;base64,")
    decoded = json.loads(base64.b64decode(body["pdf_pages_url"].split(",", 1)[1]))
    assert decoded["pages"][0]["index"] == 0
    assert page_key in decoded["pages"][0]["url"]  # presigned from the page key


async def test_pages_callback_failed_leaves_bundle_without_pages_url(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    """A failed rasterization callback records the failure without a manifest;
    the file stays viewable (extraction untouched) and the bundle has no pages url."""
    client, fake = fake_storage_client
    project_id, document_id, file_id = await _complete_ready_pdf(
        client, fake, org_user, "2222222222222222222222222222222222222222222222222222222222222222"
    )

    cb = await client.post(
        "/internal/jobs/pages/callback",
        json={
            "file_id": file_id,
            "organization_id": org_user["organization_id"],
            "status": "failed",
            "error": "boom",
            "retriable": False,
        },
        headers=_WORKER_AUTH,
    )
    assert cb.status_code == 200, cb.text

    resp = await client.get(
        f"/projects/{project_id}/documents/{document_id}/files/{file_id}/viewer-bundle",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    # Rasterization failure is non-fatal: the PDF is still viewable (file_url),
    # only the mobile page-image underlay is absent.
    assert body["file_url"] is not None
    assert body["pdf_pages_url"] is None


# ---------------------------------------------------------------------------
# DXF / DWG (CAD) upload + complete
# ---------------------------------------------------------------------------

# ASCII DXF opens with group code 0 + SECTION and carries a HEADER section.
VALID_DXF_BYTES = b"0\r\nSECTION\r\n2\r\nHEADER\r\n0\r\nENDSEC\r\n0\r\nEOF\r\n"
# DWG opens with a 6-byte ACxxxx version tag.
VALID_DWG_BYTES = b"AC1027" + b"\x00" * 60


async def test_initiate_dxf_succeeds(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, _ = fake_storage_client
    project_id, document_id = await _project_and_model(
        client, org_user["access_token"], project_name="DxfInit"
    )
    resp = await client.post(
        f"/projects/{project_id}/documents/{document_id}/files/initiate",
        json={
            "filename": "floorplan.dxf",
            "size_bytes": len(VALID_DXF_BYTES),
            "content_type": "application/octet-stream",
            "content_sha256": _new_hash(),
        },
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["storage_key"].endswith(".dxf")


async def test_initiate_dwg_succeeds(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, _ = fake_storage_client
    project_id, document_id = await _project_and_model(
        client, org_user["access_token"], project_name="DwgInit"
    )
    resp = await client.post(
        f"/projects/{project_id}/documents/{document_id}/files/initiate",
        json={
            "filename": "floorplan.dwg",
            "size_bytes": len(VALID_DWG_BYTES),
            "content_type": "application/octet-stream",
            "content_sha256": _new_hash(),
        },
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["storage_key"].endswith(".dwg")


async def test_complete_dxf_valid_marks_ready_and_dispatches(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
    extraction_calls: list[dict[str, str]],
) -> None:
    client, fake = fake_storage_client
    project_id, document_id = await _project_and_model(
        client, org_user["access_token"], project_name="DxfComplete"
    )
    init = (
        await client.post(
            f"/projects/{project_id}/documents/{document_id}/files/initiate",
            json={
                "filename": "plan.dxf",
                "size_bytes": len(VALID_DXF_BYTES),
                "content_type": "application/octet-stream",
                "content_sha256": _new_hash(),
            },
            headers=_auth(org_user["access_token"]),
        )
    ).json()
    fake.objects[init["storage_key"]] = VALID_DXF_BYTES

    resp = await client.post(
        f"/projects/{project_id}/documents/{document_id}/files/{init['file_id']}/complete",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "ready"
    assert body["file_type"] == "dxf"
    assert body["ifc_schema"] is None
    assert body["extraction_status"] == "queued"

    assert len(extraction_calls) == 1
    assert extraction_calls[0]["job_type"] == "dxf_extraction"
    assert extraction_calls[0]["payload"]["source_format"] == "dxf"


async def test_complete_dwg_valid_dispatches_with_source_format_dwg(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
    extraction_calls: list[dict[str, str]],
) -> None:
    client, fake = fake_storage_client
    project_id, document_id = await _project_and_model(
        client, org_user["access_token"], project_name="DwgComplete"
    )
    init = (
        await client.post(
            f"/projects/{project_id}/documents/{document_id}/files/initiate",
            json={
                "filename": "plan.dwg",
                "size_bytes": len(VALID_DWG_BYTES),
                "content_type": "application/octet-stream",
                "content_sha256": _new_hash(),
            },
            headers=_auth(org_user["access_token"]),
        )
    ).json()
    fake.objects[init["storage_key"]] = VALID_DWG_BYTES

    resp = await client.post(
        f"/projects/{project_id}/documents/{document_id}/files/{init['file_id']}/complete",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "ready"
    assert body["file_type"] == "dwg"
    assert body["extraction_status"] == "queued"

    assert len(extraction_calls) == 1
    assert extraction_calls[0]["job_type"] == "dxf_extraction"
    assert extraction_calls[0]["payload"]["source_format"] == "dwg"


async def test_complete_dxf_invalid_magic_rejects(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
    extraction_calls: list[dict[str, str]],
) -> None:
    client, fake = fake_storage_client
    project_id, document_id = await _project_and_model(
        client, org_user["access_token"], project_name="DxfBadMagic"
    )
    bad = b"definitely not a dxf file\n"
    init = (
        await client.post(
            f"/projects/{project_id}/documents/{document_id}/files/initiate",
            json={
                "filename": "fake.dxf",
                "size_bytes": len(bad),
                "content_type": "application/octet-stream",
                "content_sha256": _new_hash(),
            },
            headers=_auth(org_user["access_token"]),
        )
    ).json()
    fake.objects[init["storage_key"]] = bad

    resp = await client.post(
        f"/projects/{project_id}/documents/{document_id}/files/{init['file_id']}/complete",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "rejected"
    assert body["rejection_reason"] == "FILE_NOT_VALID_DXF"
    assert init["storage_key"] not in fake.objects
    assert init["storage_key"] in fake.deleted
    assert len(extraction_calls) == 0


async def test_complete_dwg_invalid_magic_rejects(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
    extraction_calls: list[dict[str, str]],
) -> None:
    client, fake = fake_storage_client
    project_id, document_id = await _project_and_model(
        client, org_user["access_token"], project_name="DwgBadMagic"
    )
    bad = b"not a dwg\n"
    init = (
        await client.post(
            f"/projects/{project_id}/documents/{document_id}/files/initiate",
            json={
                "filename": "fake.dwg",
                "size_bytes": len(bad),
                "content_type": "application/octet-stream",
                "content_sha256": _new_hash(),
            },
            headers=_auth(org_user["access_token"]),
        )
    ).json()
    fake.objects[init["storage_key"]] = bad

    resp = await client.post(
        f"/projects/{project_id}/documents/{document_id}/files/{init['file_id']}/complete",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "rejected"
    assert body["rejection_reason"] == "FILE_NOT_VALID_DWG"
    assert len(extraction_calls) == 0


async def test_cad_callback_persists_artifacts_and_bundle_serves_them(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    """A DXF extractor callback carrying geometry_key + metadata_key persists
    both, and the viewer-bundle then presigns geometry_url + metadata_url +
    file_url."""
    client, fake = fake_storage_client
    project_id, document_id = await _project_and_model(
        client, org_user["access_token"], project_name="DxfBundle"
    )
    init = (
        await client.post(
            f"/projects/{project_id}/documents/{document_id}/files/initiate",
            json={
                "filename": "plan.dxf",
                "size_bytes": len(VALID_DXF_BYTES),
                "content_type": "application/octet-stream",
                "content_sha256": _new_hash(),
            },
            headers=_auth(org_user["access_token"]),
        )
    ).json()
    fake.objects[init["storage_key"]] = VALID_DXF_BYTES
    await client.post(
        f"/projects/{project_id}/documents/{document_id}/files/{init['file_id']}/complete",
        headers=_auth(org_user["access_token"]),
    )

    geometry_key = init["storage_key"].replace(".dxf", ".geometry.json")
    metadata_key = init["storage_key"].replace(".dxf", ".metadata.json")
    callback = await client.post(
        "/internal/jobs/callback",
        json={
            "file_id": init["file_id"],
            "organization_id": org_user["organization_id"],
            "status": "succeeded",
            "geometry_key": geometry_key,
            "metadata_key": metadata_key,
            "page_count": 1,
        },
        headers={"Authorization": "Bearer dev-shared-secret-change-me"},
    )
    assert callback.status_code == 200, callback.text
    assert callback.json()["extraction_status"] == "succeeded"

    resp = await client.get(
        f"/projects/{project_id}/documents/{document_id}/files/{init['file_id']}/viewer-bundle",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["file_type"] == "dxf"
    assert body["geometry_url"] is not None
    assert "geometry.json" in body["geometry_url"]
    assert body["metadata_url"] is not None
    assert "metadata.json" in body["metadata_url"]
    assert body["file_url"] is not None
    assert "?download=plan.dxf" in body["file_url"]


# ---------------------------------------------------------------------------
# Content-hash dedup
# ---------------------------------------------------------------------------


_DUP_HASH = "a" * 64
_DUP_HASH_2 = "b" * 64


async def test_initiate_rejects_duplicate_hash_in_same_project(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    """Same content hash uploaded twice in the same project → 409 with structured detail."""
    client, _ = fake_storage_client
    project = await _create_project(client, org_user["access_token"], name="DupP")
    model_a = await _create_document(client, org_user["access_token"], project["id"], name="A")
    model_b = await _create_document(client, org_user["access_token"], project["id"], name="B")

    first = await client.post(
        f"/projects/{project['id']}/documents/{model_a['id']}/files/initiate",
        json={
            "filename": "twin.ifc",
            "size_bytes": 100,
            "content_type": "application/octet-stream",
            "content_sha256": _DUP_HASH,
        },
        headers=_auth(org_user["access_token"]),
    )
    assert first.status_code == 201, first.text

    second = await client.post(
        f"/projects/{project['id']}/documents/{model_b['id']}/files/initiate",
        json={
            "filename": "twin-copy.ifc",
            "size_bytes": 100,
            "content_type": "application/octet-stream",
            "content_sha256": _DUP_HASH,
        },
        headers=_auth(org_user["access_token"]),
    )
    assert second.status_code == 409, second.text
    detail = second.json()["detail"]
    assert detail["code"] == "DUPLICATE_FILE_CONTENT"
    assert detail["existing_filename"] == "twin.ifc"
    assert detail["existing_file_id"] == first.json()["file_id"]
    assert detail["existing_document_id"] == model_a["id"]
    assert "twin.ifc" in detail["message"]


async def test_initiate_allows_same_hash_in_different_project(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    """Dedup is per-project — the same hash in a different project is allowed."""
    client, _ = fake_storage_client
    p1 = await _create_project(client, org_user["access_token"], name="P-One")
    p2 = await _create_project(client, org_user["access_token"], name="P-Two")
    m1 = await _create_document(client, org_user["access_token"], p1["id"], name="M1")
    m2 = await _create_document(client, org_user["access_token"], p2["id"], name="M2")

    body = {
        "filename": "shared.ifc",
        "size_bytes": 100,
        "content_type": "application/octet-stream",
        "content_sha256": _DUP_HASH,
    }
    first = await client.post(
        f"/projects/{p1['id']}/documents/{m1['id']}/files/initiate",
        json=body,
        headers=_auth(org_user["access_token"]),
    )
    second = await client.post(
        f"/projects/{p2['id']}/documents/{m2['id']}/files/initiate",
        json=body,
        headers=_auth(org_user["access_token"]),
    )
    assert first.status_code == 201
    assert second.status_code == 201


async def test_initiate_allows_different_hash_in_same_model(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    """Different bytes = legitimate new version. version_number still increments."""
    client, _ = fake_storage_client
    project_id, document_id = await _project_and_model(
        client, org_user["access_token"], project_name="VersionFlow"
    )

    v1 = await client.post(
        f"/projects/{project_id}/documents/{document_id}/files/initiate",
        json={
            "filename": "v1.ifc",
            "size_bytes": 100,
            "content_type": "application/octet-stream",
            "content_sha256": _DUP_HASH,
        },
        headers=_auth(org_user["access_token"]),
    )
    v2 = await client.post(
        f"/projects/{project_id}/documents/{document_id}/files/initiate",
        json={
            "filename": "v2.ifc",
            "size_bytes": 100,
            "content_type": "application/octet-stream",
            "content_sha256": _DUP_HASH_2,
        },
        headers=_auth(org_user["access_token"]),
    )
    assert v1.status_code == 201
    assert v2.status_code == 201

    listing = (
        await client.get(
            f"/projects/{project_id}/documents/{document_id}/files?status=all",
            headers=_auth(org_user["access_token"]),
        )
    ).json()
    versions = sorted(f["version_number"] for f in listing)
    assert versions == [1, 2]


async def test_initiate_rejects_invalid_hash_format(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    """Non-hex / wrong length / uppercase → 422 from Pydantic, before the route runs."""
    client, _ = fake_storage_client
    project_id, document_id = await _project_and_model(
        client, org_user["access_token"], project_name="BadHash"
    )

    cases = [
        "",  # empty
        "abc",  # too short
        "A" * 64,  # uppercase (validator is lowercase only)
        "g" * 64,  # non-hex
        "a" * 63,  # 63 chars
        "a" * 65,  # 65 chars
    ]
    for bad in cases:
        resp = await client.post(
            f"/projects/{project_id}/documents/{document_id}/files/initiate",
            json={
                "filename": "x.ifc",
                "size_bytes": 100,
                "content_type": "application/octet-stream",
                "content_sha256": bad,
            },
            headers=_auth(org_user["access_token"]),
        )
        assert resp.status_code == 422, f"hash={bad!r}: {resp.status_code} {resp.text}"


async def test_initiate_treats_pdf_and_ifc_symmetrically_for_dedup(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    """PDF dedup works the same way as IFC dedup."""
    client, _ = fake_storage_client
    project = await _create_project(client, org_user["access_token"], name="PdfDup")
    model_a = await _create_document(client, org_user["access_token"], project["id"], name="PA")
    model_b = await _create_document(client, org_user["access_token"], project["id"], name="PB")

    first = await client.post(
        f"/projects/{project['id']}/documents/{model_a['id']}/files/initiate",
        json={
            "filename": "plan.pdf",
            "size_bytes": 200,
            "content_type": "application/pdf",
            "content_sha256": _DUP_HASH,
        },
        headers=_auth(org_user["access_token"]),
    )
    assert first.status_code == 201

    second = await client.post(
        f"/projects/{project['id']}/documents/{model_b['id']}/files/initiate",
        json={
            "filename": "plan-copy.pdf",
            "size_bytes": 200,
            "content_type": "application/pdf",
            "content_sha256": _DUP_HASH,
        },
        headers=_auth(org_user["access_token"]),
    )
    assert second.status_code == 409
    assert second.json()["detail"]["code"] == "DUPLICATE_FILE_CONTENT"


async def test_pending_duplicate_blocks_then_releases_after_rejection(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    """A pending row blocks re-uploads of its hash. Once rejected, the slot frees."""
    client, fake = fake_storage_client
    project_id, document_id = await _project_and_model(
        client, org_user["access_token"], project_name="PendingDup"
    )

    bad_bytes = b"not an ifc" * 10  # 100 bytes — matches size_bytes
    # First initiate creates a pending row.
    first = await client.post(
        f"/projects/{project_id}/documents/{document_id}/files/initiate",
        json={
            "filename": "v1.ifc",
            "size_bytes": len(bad_bytes),
            "content_type": "application/octet-stream",
            "content_sha256": _DUP_HASH,
        },
        headers=_auth(org_user["access_token"]),
    )
    assert first.status_code == 201
    first_id = first.json()["file_id"]

    # While first is pending, a second initiate with the same hash → 409.
    second = await client.post(
        f"/projects/{project_id}/documents/{document_id}/files/initiate",
        json={
            "filename": "v1-again.ifc",
            "size_bytes": len(bad_bytes),
            "content_type": "application/octet-stream",
            "content_sha256": _DUP_HASH,
        },
        headers=_auth(org_user["access_token"]),
    )
    assert second.status_code == 409

    # Drive the first row to `rejected` by completing with non-IFC bytes.
    fake.objects[first.json()["storage_key"]] = bad_bytes
    rejected_resp = await client.post(
        f"/projects/{project_id}/documents/{document_id}/files/{first_id}/complete",
        headers=_auth(org_user["access_token"]),
    )
    assert rejected_resp.json()["status"] == "rejected", rejected_resp.text

    # Now the slot is free — re-uploading with the same hash succeeds.
    third = await client.post(
        f"/projects/{project_id}/documents/{document_id}/files/initiate",
        json={
            "filename": "v1-retry.ifc",
            "size_bytes": len(bad_bytes),
            "content_type": "application/octet-stream",
            "content_sha256": _DUP_HASH,
        },
        headers=_auth(org_user["access_token"]),
    )
    assert third.status_code == 201, third.text


async def test_complete_callback_persists_ifc_project_guid(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    """Successful extractor callback writes ifc_project_guid onto the row."""
    client, fake = fake_storage_client
    project_id, document_id = await _project_and_model(
        client, org_user["access_token"], project_name="GuidPersist"
    )
    init = (
        await client.post(
            f"/projects/{project_id}/documents/{document_id}/files/initiate",
            json={
                "filename": "guid.ifc",
                "size_bytes": len(VALID_IFC_HEADER),
                "content_type": "application/octet-stream",
                "content_sha256": _DUP_HASH,
            },
            headers=_auth(org_user["access_token"]),
        )
    ).json()
    fake.objects[init["storage_key"]] = VALID_IFC_HEADER
    await client.post(
        f"/projects/{project_id}/documents/{document_id}/files/{init['file_id']}/complete",
        headers=_auth(org_user["access_token"]),
    )

    callback = await client.post(
        "/internal/jobs/callback",
        json={
            "file_id": init["file_id"],
            "organization_id": org_user["organization_id"],
            "status": "succeeded",
            "fragments_key": f"projects/{project_id}/fragments.frag",
            "metadata_key": f"projects/{project_id}/meta.json",
            "properties_key": f"projects/{project_id}/props.json",
            "content_sha256": _DUP_HASH,
            "ifc_project_guid": "0123456789abcdefghijkl",
        },
        headers={"Authorization": "Bearer dev-shared-secret-change-me"},
    )
    assert callback.status_code == 200, callback.text
    body = callback.json()
    assert body["ifc_project_guid"] == "0123456789abcdefghijkl"
    assert body["extraction_status"] == "succeeded"


async def test_complete_callback_rejects_on_hash_mismatch(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    """If the extractor's computed hash differs from the client's claim, mark rejected."""
    client, fake = fake_storage_client
    project_id, document_id = await _project_and_model(
        client, org_user["access_token"], project_name="HashMismatch"
    )
    init = (
        await client.post(
            f"/projects/{project_id}/documents/{document_id}/files/initiate",
            json={
                "filename": "lying.ifc",
                "size_bytes": len(VALID_IFC_HEADER),
                "content_type": "application/octet-stream",
                "content_sha256": _DUP_HASH,  # client claims this
            },
            headers=_auth(org_user["access_token"]),
        )
    ).json()
    fake.objects[init["storage_key"]] = VALID_IFC_HEADER
    await client.post(
        f"/projects/{project_id}/documents/{document_id}/files/{init['file_id']}/complete",
        headers=_auth(org_user["access_token"]),
    )

    callback = await client.post(
        "/internal/jobs/callback",
        json={
            "file_id": init["file_id"],
            "organization_id": org_user["organization_id"],
            "status": "succeeded",
            "fragments_key": "fragments.frag",
            "metadata_key": "meta.json",
            "properties_key": "props.json",
            "content_sha256": _DUP_HASH_2,  # extractor saw something different
            "ifc_project_guid": "0123456789abcdefghijkl",
        },
        headers={"Authorization": "Bearer dev-shared-secret-change-me"},
    )
    assert callback.status_code == 200, callback.text
    body = callback.json()
    assert body["status"] == "rejected"
    assert body["rejection_reason"] == "CONTENT_HASH_MISMATCH"
    assert body["extraction_status"] == "failed"
    assert body["ifc_project_guid"] is None  # GUID not persisted on mismatch
    # Storage object was deleted.
    assert init["storage_key"] in fake.deleted
