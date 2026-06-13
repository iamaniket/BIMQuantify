"""Tests for the extractor dispatch + callback + viewer-bundle flow."""

from __future__ import annotations

from uuid import uuid4

from httpx import AsyncClient

from bimstitch_api.jobs import (
    DispatchJobError,
    set_job_dispatcher,
)
from tests.conftest import (
    VALID_IFC_HEADER,
    FakeStorage,
    _add_member,
    _auth,
    _create_model,
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
) -> tuple[str, str, str]:
    """Create a project + model + initiate + complete a file. Returns
    (project_id, model_id, file_id)."""
    project = await _create_project(client, org_user["access_token"], name=name + "-p")
    model = await _create_model(client, org_user["access_token"], project["id"], name=name + "-m")
    init = (
        await client.post(
            f"/projects/{project['id']}/models/{model['id']}/files/initiate",
            json={
                "filename": name,
                "size_bytes": len(VALID_IFC_HEADER),
                "content_type": "application/octet-stream",
                "content_sha256": "6ef80f63974c453f39da279f6ee263111ae09ac0e884a6f3a148a0da0b8583be",
            },
            headers=_auth(org_user["access_token"]),
        )
    ).json()
    fake.objects[init["storage_key"]] = VALID_IFC_HEADER
    complete = await client.post(
        f"/projects/{project['id']}/models/{model['id']}/files/{init['file_id']}/complete",
        headers=_auth(org_user["access_token"]),
    )
    assert complete.status_code == 200, complete.text
    return project["id"], model["id"], init["file_id"]


async def _complete_ready_ifc(
    client: AsyncClient,
    fake: FakeStorage,
    org_user: dict[str, str],
    project_id: str,
    model_id: str,
    name: str,
    sha256: str,
) -> str:
    """Initiate + complete an IFC file in an EXISTING project/model. `sha256`
    must be unique within the project (per-role dedup index)."""
    init = (
        await client.post(
            f"/projects/{project_id}/models/{model_id}/files/initiate",
            json={
                "filename": name,
                "size_bytes": len(VALID_IFC_HEADER),
                "content_type": "application/octet-stream",
                "content_sha256": sha256,
            },
            headers=_auth(org_user["access_token"]),
        )
    ).json()
    fake.objects[init["storage_key"]] = VALID_IFC_HEADER
    complete = await client.post(
        f"/projects/{project_id}/models/{model_id}/files/{init['file_id']}/complete",
        headers=_auth(org_user["access_token"]),
    )
    assert complete.status_code == 200, complete.text
    return init["file_id"]


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
    project_id, model_id, file_id = await _ready_file(client, fake, org_user, name="dispatch.ifc")

    assert len(extraction_calls) == 1
    assert extraction_calls[0]["file_id"] == file_id
    assert extraction_calls[0]["project_id"] == project_id

    listing = await client.get(
        f"/projects/{project_id}/models/{model_id}/files?status=all",
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
        raise DispatchJobError("connection refused")

    set_job_dispatcher(_boom)

    client, fake = fake_storage_client
    project_id, model_id, file_id = await _ready_file(client, fake, org_user, name="boom.ifc")

    listing = await client.get(
        f"/projects/{project_id}/models/{model_id}/files?status=all",
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
    _, _, file_id = await _ready_file(client, fake, org_user, name="auth.ifc")

    no_auth = await client.post(
        "/internal/jobs/callback",
        json={"file_id": file_id, "status": "succeeded"},
    )
    assert no_auth.status_code == 401

    bad_auth = await client.post(
        "/internal/jobs/callback",
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
        "/internal/jobs/callback",
        json={
            "file_id": str(uuid4()),
            "organization_id": org_user["organization_id"],
            "status": "succeeded",
        },
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
    project_id, _model_id, file_id = await _ready_file(client, fake, org_user, name="lifecycle.ifc")

    # Move to running.
    running = await client.post(
        "/internal/jobs/callback",
        json={
            "file_id": file_id,
            "organization_id": org_user["organization_id"],
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
        "/internal/jobs/callback",
        json={
            "file_id": file_id,
            "organization_id": org_user["organization_id"],
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
    _project_id, _model_id, file_id = await _ready_file(client, fake, org_user, name="idem.ifc")

    first = await client.post(
        "/internal/jobs/callback",
        json={
            "file_id": file_id,
            "organization_id": org_user["organization_id"],
            "status": "succeeded",
            "fragments_key": "projects/x/y.frag",
        },
        headers=_bearer(),
    )
    assert first.status_code == 200
    assert first.json()["extraction_status"] == "succeeded"

    # Second call should be a no-op (e.g. retried delivery).
    second = await client.post(
        "/internal/jobs/callback",
        json={
            "file_id": file_id,
            "organization_id": org_user["organization_id"],
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
    _, _, file_id = await _ready_file(client, fake, org_user, name="bad.ifc")

    resp = await client.post(
        "/internal/jobs/callback",
        json={
            "file_id": file_id,
            "organization_id": org_user["organization_id"],
            "status": "queued",
        },
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
    _project_id, _model_id, file_id = await _ready_file(client, fake, org_user, name="fail.ifc")

    resp = await client.post(
        "/internal/jobs/callback",
        json={
            "file_id": file_id,
            "organization_id": org_user["organization_id"],
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
        raise DispatchJobError("connection refused")

    set_job_dispatcher(_boom)
    client, fake = fake_storage_client
    project_id, model_id, file_id = await _ready_file(client, fake, org_user, name="retry.ifc")

    # First dispatch failed (autouse + boom dispatcher).
    listing = await client.get(
        f"/projects/{project_id}/models/{model_id}/files?status=all",
        headers=_auth(org_user["access_token"]),
    )
    assert listing.json()[0]["extraction_status"] == "failed"

    # Replace dispatcher with a recording stub so the retry succeeds.
    extraction_calls.clear()

    async def _record(job, _settings, _organization_id=None) -> None:
        payload = dict(job.payload or {})
        entry = {
            "job_id": str(job.id),
            "job_type": job.job_type.value,
            "payload": payload,
        }
        for k in ("file_id", "project_id", "storage_key"):
            if k in payload:
                entry[k] = payload[k]
        extraction_calls.append(entry)

    set_job_dispatcher(_record)

    resp = await client.post(
        f"/projects/{project_id}/models/{model_id}/files/{file_id}/retry-extraction",
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
    project_id, model_id, file_id = await _ready_file(client, fake, org_user, name="ok.ifc")

    # extraction_status defaults to queued after complete (autouse stub).
    resp = await client.post(
        f"/projects/{project_id}/models/{model_id}/files/{file_id}/retry-extraction",
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
    project_id, model_id, file_id = await _ready_file(client, fake, org_user, name="not-yet.ifc")

    resp = await client.get(
        f"/projects/{project_id}/models/{model_id}/files/{file_id}/viewer-bundle",
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
    project_id, model_id, file_id = await _ready_file(client, fake, org_user, name="viewer.ifc")

    fragments_key = f"projects/{project_id}/{file_id}.frag"
    metadata_key = f"projects/{project_id}/{file_id}.metadata.json"
    properties_key = f"projects/{project_id}/{file_id}.properties.json"
    outline_key = f"projects/{project_id}/{file_id}.outline.bin"
    floor_plans_key = f"projects/{project_id}/{file_id}.floorplans.bin"
    fake.objects[fragments_key] = b"frag-bytes"
    fake.objects[metadata_key] = b"{}"
    fake.objects[properties_key] = b"{}"
    fake.objects[outline_key] = b"outline-bytes"
    fake.objects[floor_plans_key] = b"floorplans-bytes"

    cb = await client.post(
        "/internal/jobs/callback",
        json={
            "file_id": file_id,
            "organization_id": org_user["organization_id"],
            "status": "succeeded",
            "fragments_key": fragments_key,
            "metadata_key": metadata_key,
            "properties_key": properties_key,
            "outline_key": outline_key,
            "floor_plans_key": floor_plans_key,
        },
        headers=_bearer(),
    )
    assert cb.status_code == 200

    resp = await client.get(
        f"/projects/{project_id}/models/{model_id}/files/{file_id}/viewer-bundle",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["fragments_url"].startswith("http://fake-storage/")
    assert ".frag?download=" in body["fragments_url"]
    assert body["metadata_url"] is not None
    assert body["properties_url"] is not None
    assert body["outline_url"] is not None
    assert body["outline_url"].startswith("http://fake-storage/")
    assert ".outline.bin?download=" in body["outline_url"]
    assert body["floor_plans_url"] is not None
    assert body["floor_plans_url"].startswith("http://fake-storage/")
    assert ".floorplans.bin?download=" in body["floor_plans_url"]
    assert body["expires_in"] == fake.presign_ttl_value


async def test_callback_outline_key_persists_and_job_result_carries_it(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, fake = fake_storage_client
    project_id, model_id, file_id = await _ready_file(client, fake, org_user, name="outline.ifc")

    list_resp = await client.get("/jobs", headers=_auth(org_user["access_token"]))
    job_id = list_resp.json()["items"][0]["id"]

    fragments_key = f"projects/{project_id}/{file_id}.frag"
    outline_key = f"projects/{project_id}/{file_id}.outline.bin"
    cb = await client.post(
        "/internal/jobs/callback",
        json={
            "file_id": file_id,
            "organization_id": org_user["organization_id"],
            "job_id": job_id,
            "status": "succeeded",
            "fragments_key": fragments_key,
            "outline_key": outline_key,
        },
        headers=_bearer(),
    )
    assert cb.status_code == 200

    job = await client.get(f"/jobs/{job_id}", headers=_auth(org_user["access_token"]))
    assert job.json()["result"]["outline_key"] == outline_key

    resp = await client.get(
        f"/projects/{project_id}/models/{model_id}/files/{file_id}/viewer-bundle",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["outline_url"] is not None


async def test_callback_without_outline_key_leaves_outline_null(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    """Outline is optional: extraction succeeds without it (graceful degrade
    for old artifacts and outline-pipeline failures) and the bundle reports
    outline_url=null so the viewer falls back to client-side compute."""
    client, fake = fake_storage_client
    project_id, model_id, file_id = await _ready_file(client, fake, org_user, name="no-outline.ifc")

    list_resp = await client.get("/jobs", headers=_auth(org_user["access_token"]))
    job_id = list_resp.json()["items"][0]["id"]

    cb = await client.post(
        "/internal/jobs/callback",
        json={
            "file_id": file_id,
            "organization_id": org_user["organization_id"],
            "job_id": job_id,
            "status": "succeeded",
            "fragments_key": f"projects/{project_id}/{file_id}.frag",
        },
        headers=_bearer(),
    )
    assert cb.status_code == 200
    assert cb.json()["extraction_status"] == "succeeded"

    job = await client.get(f"/jobs/{job_id}", headers=_auth(org_user["access_token"]))
    assert "outline_key" not in job.json()["result"]

    resp = await client.get(
        f"/projects/{project_id}/models/{model_id}/files/{file_id}/viewer-bundle",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["outline_url"] is None


async def test_callback_floor_plans_key_persists_and_job_result_carries_it(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, fake = fake_storage_client
    project_id, model_id, file_id = await _ready_file(
        client, fake, org_user, name="floorplans.ifc"
    )

    list_resp = await client.get("/jobs", headers=_auth(org_user["access_token"]))
    job_id = list_resp.json()["items"][0]["id"]

    fragments_key = f"projects/{project_id}/{file_id}.frag"
    floor_plans_key = f"projects/{project_id}/{file_id}.floorplans.bin"
    cb = await client.post(
        "/internal/jobs/callback",
        json={
            "file_id": file_id,
            "organization_id": org_user["organization_id"],
            "job_id": job_id,
            "status": "succeeded",
            "fragments_key": fragments_key,
            "floor_plans_key": floor_plans_key,
        },
        headers=_bearer(),
    )
    assert cb.status_code == 200

    job = await client.get(f"/jobs/{job_id}", headers=_auth(org_user["access_token"]))
    assert job.json()["result"]["floor_plans_key"] == floor_plans_key

    resp = await client.get(
        f"/projects/{project_id}/models/{model_id}/files/{file_id}/viewer-bundle",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["floor_plans_url"] is not None


async def test_callback_without_floor_plans_key_leaves_floor_plans_null(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    """Floor plans are optional: a model with no storeys (or a generation
    failure) still succeeds, and the bundle reports floor_plans_url=null."""
    client, fake = fake_storage_client
    project_id, model_id, file_id = await _ready_file(
        client, fake, org_user, name="no-floorplans.ifc"
    )

    list_resp = await client.get("/jobs", headers=_auth(org_user["access_token"]))
    job_id = list_resp.json()["items"][0]["id"]

    cb = await client.post(
        "/internal/jobs/callback",
        json={
            "file_id": file_id,
            "organization_id": org_user["organization_id"],
            "job_id": job_id,
            "status": "succeeded",
            "fragments_key": f"projects/{project_id}/{file_id}.frag",
        },
        headers=_bearer(),
    )
    assert cb.status_code == 200

    job = await client.get(f"/jobs/{job_id}", headers=_auth(org_user["access_token"]))
    assert "floor_plans_key" not in job.json()["result"]

    resp = await client.get(
        f"/projects/{project_id}/models/{model_id}/files/{file_id}/viewer-bundle",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["floor_plans_url"] is None


async def test_callback_detected_kind_persists_on_file(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    """The extractor's content classification is persisted on the file so the
    portal can badge the discipline and pick the architectural model as the 2D
    source in a federated view."""
    client, fake = fake_storage_client
    project_id, model_id, file_id = await _ready_file(
        client, fake, org_user, name="mep.ifc"
    )

    cb = await client.post(
        "/internal/jobs/callback",
        json={
            "file_id": file_id,
            "organization_id": org_user["organization_id"],
            "status": "succeeded",
            "fragments_key": f"projects/{project_id}/{file_id}.frag",
            "detected_kind": "mep",
        },
        headers=_bearer(),
    )
    assert cb.status_code == 200, cb.text
    assert cb.json()["detected_kind"] == "mep"

    # Re-read via the files list to confirm it durably persisted.
    files = await client.get(
        f"/projects/{project_id}/models/{model_id}/files",
        headers=_auth(org_user["access_token"]),
    )
    assert files.status_code == 200, files.text
    row = next(f for f in files.json() if f["id"] == file_id)
    assert row["detected_kind"] == "mep"


async def test_project_viewer_bundle_lists_models_with_detected_kind(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    """The federated manifest returns one entry per model with a ready IFC
    file: presigned URLs + the discipline classification. The architectural
    model carries a floor_plans_url (the 2D source); MEP is 3D-only; a model
    with no ready IFC is omitted."""
    client, fake = fake_storage_client
    token = org_user["access_token"]
    org_id = org_user["organization_id"]

    project = await _create_project(client, token, name="federated")
    project_id = project["id"]
    arch = await _create_model(client, token, project_id, name="ARC", discipline="architectural")
    mep = await _create_model(client, token, project_id, name="MEP", discipline="mep")
    # Structural model with NO ready IFC file — must be omitted from the manifest.
    await _create_model(client, token, project_id, name="EMPTY", discipline="structural")

    arch_file = await _complete_ready_ifc(
        client, fake, org_user, project_id, arch["id"], "arc.ifc", f"{1:064x}"
    )
    mep_file = await _complete_ready_ifc(
        client, fake, org_user, project_id, mep["id"], "mep.ifc", f"{2:064x}"
    )

    # Architectural model: succeeded WITH a floor-plan artifact (the 2D source).
    cb_arch = await client.post(
        "/internal/jobs/callback",
        json={
            "file_id": arch_file,
            "organization_id": org_id,
            "status": "succeeded",
            "fragments_key": f"projects/{project_id}/{arch_file}.frag",
            "floor_plans_key": f"projects/{project_id}/{arch_file}.floorplans.bin",
            "detected_kind": "architectural",
        },
        headers=_bearer(),
    )
    assert cb_arch.status_code == 200, cb_arch.text

    # MEP model: succeeded, NO floor-plan artifact (3D-only per the gate).
    cb_mep = await client.post(
        "/internal/jobs/callback",
        json={
            "file_id": mep_file,
            "organization_id": org_id,
            "status": "succeeded",
            "fragments_key": f"projects/{project_id}/{mep_file}.frag",
            "detected_kind": "mep",
        },
        headers=_bearer(),
    )
    assert cb_mep.status_code == 200, cb_mep.text

    resp = await client.get(f"/projects/{project_id}/viewer-bundle", headers=_auth(token))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["expires_in"] > 0
    models = body["models"]
    assert len(models) == 2  # EMPTY model omitted
    by_kind = {m["detected_kind"]: m for m in models}
    assert set(by_kind) == {"architectural", "mep"}

    arch_entry = by_kind["architectural"]
    assert arch_entry["model_id"] == arch["id"]
    assert arch_entry["discipline"] == "architectural"
    assert arch_entry["fragments_url"] is not None
    assert arch_entry["floor_plans_url"] is not None  # arch supplies the 2D plan

    mep_entry = by_kind["mep"]
    assert mep_entry["model_id"] == mep["id"]
    assert mep_entry["fragments_url"] is not None
    assert mep_entry["floor_plans_url"] is None  # MEP is 3D-only


async def test_project_viewer_bundle_requires_read_access(
    org_user: dict[str, str],
    other_org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    """A user from another org cannot read a project's federated manifest."""
    client, fake = fake_storage_client
    project_id, _model_id, _file_id = await _ready_file(client, fake, org_user, name="iso-fed.ifc")
    resp = await client.get(
        f"/projects/{project_id}/viewer-bundle",
        headers=_auth(other_org_user["access_token"]),
    )
    assert resp.status_code == 404, resp.text


async def test_viewer_bundle_cross_org_returns_404(
    org_user: dict[str, str],
    other_org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, fake = fake_storage_client
    project_id, model_id, file_id = await _ready_file(client, fake, org_user, name="iso.ifc")

    # Mark succeeded so the only thing standing between us and a 200 is auth.
    await client.post(
        "/internal/jobs/callback",
        json={
            "file_id": file_id,
            "organization_id": org_user["organization_id"],
            "status": "succeeded",
            "fragments_key": f"projects/{project_id}/{file_id}.frag",
        },
        headers=_bearer(),
    )

    resp = await client.get(
        f"/projects/{project_id}/models/{model_id}/files/{file_id}/viewer-bundle",
        headers=_auth(other_org_user["access_token"]),
    )
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Member access (viewer role can read viewer-bundle)
# ---------------------------------------------------------------------------


async def test_viewer_role_can_get_viewer_bundle(
    org_user: dict[str, str],
    same_org_non_admin_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, fake = fake_storage_client
    project_id, model_id, file_id = await _ready_file(
        client, fake, org_user, name="viewer-role.ifc"
    )
    await _add_member(client, org_user["access_token"], project_id, same_org_non_admin_user["id"], "viewer")

    fragments_key = f"projects/{project_id}/{file_id}.frag"
    fake.objects[fragments_key] = b"frag-bytes"
    await client.post(
        "/internal/jobs/callback",
        json={
            "file_id": file_id,
            "organization_id": org_user["organization_id"],
            "status": "succeeded",
            "fragments_key": fragments_key,
        },
        headers=_bearer(),
    )

    resp = await client.get(
        f"/projects/{project_id}/models/{model_id}/files/{file_id}/viewer-bundle",
        headers=_auth(same_org_non_admin_user["access_token"]),
    )
    assert resp.status_code == 200
