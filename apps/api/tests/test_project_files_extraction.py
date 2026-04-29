"""Tests for the extractor dispatch + callback + viewer-bundle flow."""

from __future__ import annotations

from uuid import uuid4

from httpx import AsyncClient

from bimstitch_api.extraction import (
    ExtractionDispatchError,
    set_extraction_dispatcher,
)
from tests.conftest import (
    VALID_IFC_HEADER,
    FakeStorage,
    _add_member,
    _auth,
    _create_project,
)

SECRET = "dev-shared-secret-change-me"  # matches Settings default


def _bearer(secret: str = SECRET) -> dict[str, str]:
    return {"Authorization": f"Bearer {secret}"}


async def _ready_file(
    client: AsyncClient,
    fake: FakeStorage,
    org_user: dict[str, str],
    name: str = "ext.ifc",
) -> tuple[str, str]:
    """Create a project + initiate + complete a file. Returns (project_id, file_id)."""
    project = await _create_project(client, org_user["access_token"], name=name + "-p")
    init = (
        await client.post(
            f"/projects/{project['id']}/files/initiate",
            json={
                "filename": name,
                "size_bytes": len(VALID_IFC_HEADER),
                "content_type": "application/octet-stream",
            },
            headers=_auth(org_user["access_token"]),
        )
    ).json()
    fake.objects[init["storage_key"]] = VALID_IFC_HEADER
    complete = await client.post(
        f"/projects/{project['id']}/files/{init['file_id']}/complete",
        headers=_auth(org_user["access_token"]),
    )
    assert complete.status_code == 200, complete.text
    return project["id"], init["file_id"]


# ---------------------------------------------------------------------------
# Dispatch behaviour after complete_upload
# ---------------------------------------------------------------------------


async def test_complete_dispatches_extraction_and_marks_queued(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
    extraction_calls: list[dict[str, str]],
) -> None:
    client, fake = fake_storage_client
    project_id, file_id = await _ready_file(client, fake, org_user, name="dispatch.ifc")

    assert len(extraction_calls) == 1
    assert extraction_calls[0]["file_id"] == file_id
    assert extraction_calls[0]["project_id"] == project_id

    listing = await client.get(
        f"/projects/{project_id}/files?status=all",
        headers=_auth(org_user["access_token"]),
    )
    [row] = listing.json()
    assert row["extraction_status"] == "queued"
    assert row["extraction_error"] is None


async def test_complete_marks_failed_when_dispatch_raises(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    async def _boom(*_args: object, **_kwargs: object) -> None:
        raise ExtractionDispatchError("connection refused")

    set_extraction_dispatcher(_boom)

    client, fake = fake_storage_client
    project_id, file_id = await _ready_file(client, fake, org_user, name="boom.ifc")

    listing = await client.get(
        f"/projects/{project_id}/files?status=all",
        headers=_auth(org_user["access_token"]),
    )
    [row] = listing.json()
    assert row["extraction_status"] == "failed"
    assert row["extraction_error"] is not None
    assert "DISPATCH_FAILED" in row["extraction_error"]


# ---------------------------------------------------------------------------
# Internal callback endpoint
# ---------------------------------------------------------------------------


async def test_callback_requires_bearer_token(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, fake = fake_storage_client
    _, file_id = await _ready_file(client, fake, org_user, name="auth.ifc")

    no_auth = await client.post(
        "/internal/extraction/callback",
        json={"file_id": file_id, "status": "succeeded"},
    )
    assert no_auth.status_code == 401

    bad_auth = await client.post(
        "/internal/extraction/callback",
        json={"file_id": file_id, "status": "succeeded"},
        headers=_bearer("not-the-secret"),
    )
    assert bad_auth.status_code == 401


async def test_callback_unknown_file_returns_404(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, _fake = fake_storage_client
    resp = await client.post(
        "/internal/extraction/callback",
        json={"file_id": str(uuid4()), "status": "succeeded"},
        headers=_bearer(),
    )
    assert resp.status_code == 404
    assert resp.json()["detail"] == "FILE_NOT_FOUND"


async def test_callback_running_then_succeeded(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, fake = fake_storage_client
    project_id, file_id = await _ready_file(client, fake, org_user, name="lifecycle.ifc")

    # Move to running.
    running = await client.post(
        "/internal/extraction/callback",
        json={
            "file_id": file_id,
            "status": "running",
            "started_at": "2026-04-29T12:00:00Z",
            "extractor_version": "0.1.0",
        },
        headers=_bearer(),
    )
    assert running.status_code == 200, running.text
    assert running.json()["extraction_status"] == "running"
    assert running.json()["extractor_version"] == "0.1.0"

    # Move to succeeded with storage keys.
    succeeded = await client.post(
        "/internal/extraction/callback",
        json={
            "file_id": file_id,
            "status": "succeeded",
            "fragments_key": f"projects/{project_id}/{file_id}.frag",
            "metadata_key": f"projects/{project_id}/{file_id}.metadata.json",
            "properties_key": f"projects/{project_id}/{file_id}.properties.json",
            "finished_at": "2026-04-29T12:00:30Z",
            "extractor_version": "0.1.0",
        },
        headers=_bearer(),
    )
    assert succeeded.status_code == 200
    body = succeeded.json()
    assert body["extraction_status"] == "succeeded"
    assert body["extraction_error"] is None


async def test_callback_is_idempotent_after_terminal(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, fake = fake_storage_client
    project_id, file_id = await _ready_file(client, fake, org_user, name="idem.ifc")

    first = await client.post(
        "/internal/extraction/callback",
        json={
            "file_id": file_id,
            "status": "succeeded",
            "fragments_key": "projects/x/y.frag",
        },
        headers=_bearer(),
    )
    assert first.status_code == 200
    assert first.json()["extraction_status"] == "succeeded"

    # Second call should be a no-op (e.g. retried delivery).
    second = await client.post(
        "/internal/extraction/callback",
        json={
            "file_id": file_id,
            "status": "failed",
            "error": "should-be-ignored",
        },
        headers=_bearer(),
    )
    assert second.status_code == 200
    body = second.json()
    assert body["extraction_status"] == "succeeded"  # unchanged
    assert body["extraction_error"] is None


async def test_callback_rejects_invalid_incoming_status(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, fake = fake_storage_client
    _, file_id = await _ready_file(client, fake, org_user, name="bad.ifc")

    resp = await client.post(
        "/internal/extraction/callback",
        json={"file_id": file_id, "status": "queued"},
        headers=_bearer(),
    )
    assert resp.status_code == 400
    assert resp.json()["detail"] == "INVALID_CALLBACK_STATUS"


async def test_callback_records_failure(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, fake = fake_storage_client
    project_id, file_id = await _ready_file(client, fake, org_user, name="fail.ifc")

    resp = await client.post(
        "/internal/extraction/callback",
        json={
            "file_id": file_id,
            "status": "failed",
            "error": "UNSUPPORTED_SCHEMA: IFC4X1",
            "finished_at": "2026-04-29T13:00:00Z",
        },
        headers=_bearer(),
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["extraction_status"] == "failed"
    assert body["extraction_error"] == "UNSUPPORTED_SCHEMA: IFC4X1"


# ---------------------------------------------------------------------------
# Retry endpoint
# ---------------------------------------------------------------------------


async def test_retry_requeues_failed_extraction(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
    extraction_calls: list[dict[str, str]],
) -> None:
    async def _boom(*_args: object, **_kwargs: object) -> None:
        raise ExtractionDispatchError("connection refused")

    set_extraction_dispatcher(_boom)
    client, fake = fake_storage_client
    project_id, file_id = await _ready_file(client, fake, org_user, name="retry.ifc")

    # First dispatch failed (autouse + boom dispatcher).
    listing = await client.get(
        f"/projects/{project_id}/files?status=all",
        headers=_auth(org_user["access_token"]),
    )
    assert listing.json()[0]["extraction_status"] == "failed"

    # Replace dispatcher with a recording stub so the retry succeeds.
    extraction_calls.clear()

    async def _record(file_id_arg, project_id_arg, storage_key, _settings) -> None:
        extraction_calls.append(
            {
                "file_id": str(file_id_arg),
                "project_id": str(project_id_arg),
                "storage_key": storage_key,
            }
        )

    set_extraction_dispatcher(_record)

    resp = await client.post(
        f"/projects/{project_id}/files/{file_id}/retry-extraction",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["extraction_status"] == "queued"
    assert body["extraction_error"] is None
    assert len(extraction_calls) == 1
    assert extraction_calls[0]["file_id"] == file_id


async def test_retry_rejects_non_failed_extraction(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, fake = fake_storage_client
    project_id, file_id = await _ready_file(client, fake, org_user, name="ok.ifc")

    # extraction_status defaults to queued after complete (autouse stub).
    resp = await client.post(
        f"/projects/{project_id}/files/{file_id}/retry-extraction",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 409
    assert resp.json()["detail"] == "EXTRACTION_NOT_FAILED"


# ---------------------------------------------------------------------------
# Viewer bundle endpoint
# ---------------------------------------------------------------------------


async def test_viewer_bundle_404_when_extraction_not_succeeded(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, fake = fake_storage_client
    project_id, file_id = await _ready_file(client, fake, org_user, name="not-yet.ifc")

    resp = await client.get(
        f"/projects/{project_id}/files/{file_id}/viewer-bundle",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 404
    assert resp.json()["detail"] == "VIEWER_BUNDLE_NOT_READY"


async def test_viewer_bundle_returns_presigned_urls_after_extraction(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, fake = fake_storage_client
    project_id, file_id = await _ready_file(client, fake, org_user, name="viewer.ifc")

    fragments_key = f"projects/{project_id}/{file_id}.frag"
    metadata_key = f"projects/{project_id}/{file_id}.metadata.json"
    properties_key = f"projects/{project_id}/{file_id}.properties.json"
    fake.objects[fragments_key] = b"frag-bytes"
    fake.objects[metadata_key] = b"{}"
    fake.objects[properties_key] = b"{}"

    cb = await client.post(
        "/internal/extraction/callback",
        json={
            "file_id": file_id,
            "status": "succeeded",
            "fragments_key": fragments_key,
            "metadata_key": metadata_key,
            "properties_key": properties_key,
        },
        headers=_bearer(),
    )
    assert cb.status_code == 200

    resp = await client.get(
        f"/projects/{project_id}/files/{file_id}/viewer-bundle",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["fragments_url"].startswith("http://fake-storage/")
    assert body["fragments_url"].endswith(".frag")
    assert body["metadata_url"] is not None
    assert body["properties_url"] is not None
    assert body["expires_in"] == fake.presign_ttl_value


async def test_viewer_bundle_cross_org_returns_404(
    org_user: dict[str, str],
    other_org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, fake = fake_storage_client
    project_id, file_id = await _ready_file(client, fake, org_user, name="iso.ifc")

    # Mark succeeded so the only thing standing between us and a 200 is auth.
    await client.post(
        "/internal/extraction/callback",
        json={
            "file_id": file_id,
            "status": "succeeded",
            "fragments_key": f"projects/{project_id}/{file_id}.frag",
        },
        headers=_bearer(),
    )

    resp = await client.get(
        f"/projects/{project_id}/files/{file_id}/viewer-bundle",
        headers=_auth(other_org_user["access_token"]),
    )
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Member access (viewer role can read viewer-bundle)
# ---------------------------------------------------------------------------


async def test_viewer_role_can_get_viewer_bundle(
    org_user: dict[str, str],
    same_org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, fake = fake_storage_client
    project_id, file_id = await _ready_file(client, fake, org_user, name="viewer-role.ifc")
    await _add_member(
        client, org_user["access_token"], project_id, same_org_user["id"], "viewer"
    )

    fragments_key = f"projects/{project_id}/{file_id}.frag"
    fake.objects[fragments_key] = b"frag-bytes"
    await client.post(
        "/internal/extraction/callback",
        json={
            "file_id": file_id,
            "status": "succeeded",
            "fragments_key": fragments_key,
        },
        headers=_bearer(),
    )

    resp = await client.get(
        f"/projects/{project_id}/files/{file_id}/viewer-bundle",
        headers=_auth(same_org_user["access_token"]),
    )
    assert resp.status_code == 200
