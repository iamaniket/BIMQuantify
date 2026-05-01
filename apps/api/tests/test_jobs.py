"""Tests for the /jobs tenant-level job tracking endpoint."""

from __future__ import annotations

from uuid import uuid4

from httpx import AsyncClient

from bimstitch_api.extraction import ExtractionDispatchError, set_extraction_dispatcher
from tests.conftest import (
    VALID_IFC_HEADER,
    FakeStorage,
    _auth,
    _create_model,
    _create_project,
)

VALID_PDF_BYTES = b"%PDF-1.7\n%test content\n"
SECRET = "dev-shared-secret-change-me"


def _bearer(secret: str = SECRET) -> dict[str, str]:
    return {"Authorization": f"Bearer {secret}"}


async def _ready_ifc(
    client: AsyncClient,
    fake: FakeStorage,
    org_user: dict[str, str],
    name: str = "job.ifc",
) -> tuple[str, str, str]:
    project = await _create_project(client, org_user["access_token"], name=name + "-p")
    model = await _create_model(client, org_user["access_token"], project["id"], name=name + "-m")
    init = (
        await client.post(
            f"/projects/{project['id']}/models/{model['id']}/files/initiate",
            json={
                "filename": name,
                "size_bytes": len(VALID_IFC_HEADER),
                "content_type": "application/octet-stream",
            },
            headers=_auth(org_user["access_token"]),
        )
    ).json()
    fake.objects[init["storage_key"]] = VALID_IFC_HEADER
    await client.post(
        f"/projects/{project['id']}/models/{model['id']}/files/{init['file_id']}/complete",
        headers=_auth(org_user["access_token"]),
    )
    return project["id"], model["id"], init["file_id"]


async def _ready_pdf(
    client: AsyncClient,
    fake: FakeStorage,
    org_user: dict[str, str],
    name: str = "job.pdf",
) -> tuple[str, str, str]:
    project = await _create_project(client, org_user["access_token"], name=name + "-p")
    model = await _create_model(client, org_user["access_token"], project["id"], name=name + "-m")
    init = (
        await client.post(
            f"/projects/{project['id']}/models/{model['id']}/files/initiate",
            json={
                "filename": name,
                "size_bytes": len(VALID_PDF_BYTES),
                "content_type": "application/pdf",
            },
            headers=_auth(org_user["access_token"]),
        )
    ).json()
    fake.objects[init["storage_key"]] = VALID_PDF_BYTES
    await client.post(
        f"/projects/{project['id']}/models/{model['id']}/files/{init['file_id']}/complete",
        headers=_auth(org_user["access_token"]),
    )
    return project["id"], model["id"], init["file_id"]


# ---------------------------------------------------------------------------
# List + get
# ---------------------------------------------------------------------------


async def test_list_jobs_empty(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, _fake = fake_storage_client
    resp = await client.get("/jobs", headers=_auth(org_user["access_token"]))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["items"] == []
    assert body["total"] == 0


async def test_ifc_complete_creates_job(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, fake = fake_storage_client
    project_id, _model_id, file_id = await _ready_ifc(client, fake, org_user, name="ifc-job.ifc")

    resp = await client.get("/jobs", headers=_auth(org_user["access_token"]))
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 1
    job = body["items"][0]
    assert job["job_type"] == "ifc_extraction"
    assert job["status"] == "pending"
    assert job["file_id"] == file_id
    assert job["project_id"] == project_id


async def test_pdf_complete_creates_job(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, fake = fake_storage_client
    project_id, _model_id, file_id = await _ready_pdf(client, fake, org_user, name="pdf-job.pdf")

    resp = await client.get("/jobs", headers=_auth(org_user["access_token"]))
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 1
    job = body["items"][0]
    assert job["job_type"] == "pdf_extraction"
    assert job["status"] == "pending"
    assert job["file_id"] == file_id
    assert job["project_id"] == project_id


async def test_get_job(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, fake = fake_storage_client
    await _ready_ifc(client, fake, org_user, name="get-job.ifc")

    list_resp = await client.get("/jobs", headers=_auth(org_user["access_token"]))
    job_id = list_resp.json()["items"][0]["id"]

    resp = await client.get(f"/jobs/{job_id}", headers=_auth(org_user["access_token"]))
    assert resp.status_code == 200
    assert resp.json()["id"] == job_id


async def test_get_job_not_found(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, _fake = fake_storage_client
    resp = await client.get(f"/jobs/{uuid4()}", headers=_auth(org_user["access_token"]))
    assert resp.status_code == 404
    assert resp.json()["detail"] == "JOB_NOT_FOUND"


# ---------------------------------------------------------------------------
# Callback → Job status update
# ---------------------------------------------------------------------------


async def test_callback_updates_job_to_running(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, fake = fake_storage_client
    _project_id, _model_id, file_id = await _ready_ifc(client, fake, org_user, name="run-job.ifc")

    list_resp = await client.get("/jobs", headers=_auth(org_user["access_token"]))
    job_id = list_resp.json()["items"][0]["id"]

    cb = await client.post(
        "/internal/extraction/callback",
        json={
            "file_id": file_id,
            "job_id": job_id,
            "status": "running",
            "started_at": "2026-05-01T10:00:00Z",
        },
        headers=_bearer(),
    )
    assert cb.status_code == 200

    resp = await client.get(f"/jobs/{job_id}", headers=_auth(org_user["access_token"]))
    assert resp.json()["status"] == "running"
    assert resp.json()["started_at"] is not None


async def test_callback_updates_job_to_succeeded(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, fake = fake_storage_client
    project_id, _model_id, file_id = await _ready_ifc(
        client, fake, org_user, name="succeed-job.ifc"
    )

    list_resp = await client.get("/jobs", headers=_auth(org_user["access_token"]))
    job_id = list_resp.json()["items"][0]["id"]

    fragments_key = f"projects/{project_id}/{file_id}.frag"
    metadata_key = f"projects/{project_id}/{file_id}.metadata.json"
    cb = await client.post(
        "/internal/extraction/callback",
        json={
            "file_id": file_id,
            "job_id": job_id,
            "status": "succeeded",
            "fragments_key": fragments_key,
            "metadata_key": metadata_key,
            "finished_at": "2026-05-01T10:01:00Z",
        },
        headers=_bearer(),
    )
    assert cb.status_code == 200

    resp = await client.get(f"/jobs/{job_id}", headers=_auth(org_user["access_token"]))
    body = resp.json()
    assert body["status"] == "succeeded"
    assert body["result"]["fragments_key"] == fragments_key
    assert body["result"]["metadata_key"] == metadata_key
    assert body["finished_at"] is not None


async def test_callback_updates_job_to_failed(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, fake = fake_storage_client
    _project_id, _model_id, file_id = await _ready_ifc(
        client, fake, org_user, name="fail-job.ifc"
    )

    list_resp = await client.get("/jobs", headers=_auth(org_user["access_token"]))
    job_id = list_resp.json()["items"][0]["id"]

    cb = await client.post(
        "/internal/extraction/callback",
        json={
            "file_id": file_id,
            "job_id": job_id,
            "status": "failed",
            "error": "UNSUPPORTED_SCHEMA: IFC4X1",
            "finished_at": "2026-05-01T10:01:00Z",
        },
        headers=_bearer(),
    )
    assert cb.status_code == 200

    resp = await client.get(f"/jobs/{job_id}", headers=_auth(org_user["access_token"]))
    body = resp.json()
    assert body["status"] == "failed"
    assert body["error"] == "UNSUPPORTED_SCHEMA: IFC4X1"


async def test_callback_without_job_id_still_updates_file(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    """Backward compat: old extractor (no job_id) still updates ProjectFile."""
    client, fake = fake_storage_client
    project_id, model_id, file_id = await _ready_ifc(
        client, fake, org_user, name="no-jobid.ifc"
    )

    cb = await client.post(
        "/internal/extraction/callback",
        json={"file_id": file_id, "status": "running"},
        headers=_bearer(),
    )
    assert cb.status_code == 200
    assert cb.json()["extraction_status"] == "running"


async def test_callback_terminal_job_is_idempotent(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, fake = fake_storage_client
    _project_id, _model_id, file_id = await _ready_ifc(
        client, fake, org_user, name="idem-job.ifc"
    )

    list_resp = await client.get("/jobs", headers=_auth(org_user["access_token"]))
    job_id = list_resp.json()["items"][0]["id"]

    await client.post(
        "/internal/extraction/callback",
        json={
            "file_id": file_id,
            "job_id": job_id,
            "status": "succeeded",
            "fragments_key": "projects/x/y.frag",
        },
        headers=_bearer(),
    )

    # Second terminal callback should not change status.
    await client.post(
        "/internal/extraction/callback",
        json={
            "file_id": file_id,
            "job_id": job_id,
            "status": "failed",
            "error": "should-be-ignored",
        },
        headers=_bearer(),
    )

    resp = await client.get(f"/jobs/{job_id}", headers=_auth(org_user["access_token"]))
    assert resp.json()["status"] == "succeeded"


# ---------------------------------------------------------------------------
# Filtering
# ---------------------------------------------------------------------------


async def test_list_jobs_filter_by_project_id(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, fake = fake_storage_client
    project_a_id, _, _ = await _ready_ifc(client, fake, org_user, name="filter-a.ifc")
    await _ready_ifc(client, fake, org_user, name="filter-b.ifc")

    resp = await client.get(
        f"/jobs?project_id={project_a_id}", headers=_auth(org_user["access_token"])
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 1
    assert body["items"][0]["project_id"] == project_a_id


async def test_list_jobs_filter_by_status(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, fake = fake_storage_client
    await _ready_ifc(client, fake, org_user, name="status-a.ifc")
    await _ready_ifc(client, fake, org_user, name="status-b.ifc")

    resp = await client.get("/jobs?status=pending", headers=_auth(org_user["access_token"]))
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 2
    assert all(j["status"] == "pending" for j in body["items"])


async def test_list_jobs_pagination(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, fake = fake_storage_client
    for i in range(3):
        await _ready_ifc(client, fake, org_user, name=f"page-{i}.ifc")

    resp = await client.get("/jobs?limit=2&offset=0", headers=_auth(org_user["access_token"]))
    body = resp.json()
    assert body["total"] == 3
    assert len(body["items"]) == 2
    assert body["limit"] == 2
    assert body["offset"] == 0

    resp2 = await client.get("/jobs?limit=2&offset=2", headers=_auth(org_user["access_token"]))
    body2 = resp2.json()
    assert len(body2["items"]) == 1


# ---------------------------------------------------------------------------
# Tenant isolation
# ---------------------------------------------------------------------------


async def test_jobs_cross_org_isolation(
    org_user: dict[str, str],
    other_org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    """Jobs from org A must not be visible to org B."""
    client, fake = fake_storage_client
    await _ready_ifc(client, fake, org_user, name="org-a.ifc")

    resp = await client.get("/jobs", headers=_auth(other_org_user["access_token"]))
    assert resp.status_code == 200
    assert resp.json()["total"] == 0


# ---------------------------------------------------------------------------
# Dispatch failure creates failed job
# ---------------------------------------------------------------------------


async def test_dispatch_failure_creates_failed_job(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    async def _boom(*_args: object, **_kwargs: object) -> None:
        raise ExtractionDispatchError("unreachable")

    set_extraction_dispatcher(_boom)

    client, fake = fake_storage_client
    project = await _create_project(client, org_user["access_token"], name="fail-dispatch-p")
    model = await _create_model(client, org_user["access_token"], project["id"], name="fail-dispatch-m")
    init = (
        await client.post(
            f"/projects/{project['id']}/models/{model['id']}/files/initiate",
            json={
                "filename": "fail.ifc",
                "size_bytes": len(VALID_IFC_HEADER),
                "content_type": "application/octet-stream",
            },
            headers=_auth(org_user["access_token"]),
        )
    ).json()
    fake.objects[init["storage_key"]] = VALID_IFC_HEADER
    await client.post(
        f"/projects/{project['id']}/models/{model['id']}/files/{init['file_id']}/complete",
        headers=_auth(org_user["access_token"]),
    )

    resp = await client.get("/jobs", headers=_auth(org_user["access_token"]))
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 1
    job = body["items"][0]
    assert job["status"] == "failed"
    assert job["error"] is not None
    assert "DISPATCH_FAILED" in job["error"]
