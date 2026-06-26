"""Tests for the generic `POST /jobs/{job_id}/cancel` lifecycle endpoint."""

from __future__ import annotations

from typing import TYPE_CHECKING

from bimdossier_api.jobs import set_job_canceller
from tests.conftest import FakeStorage, _auth
from tests.test_project_files_extraction import _bearer, _ready_file

if TYPE_CHECKING:
    from httpx import AsyncClient


async def _latest_job(client: AsyncClient, token: str, project_id: str) -> dict:
    resp = await client.get(
        f"/jobs?project_id={project_id}",
        headers=_auth(token),
    )
    assert resp.status_code == 200, resp.text
    items = resp.json()["items"]
    assert items, "expected at least one job"
    return items[0]


async def test_cancel_pending_job(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
    job_cancel_calls: list[dict[str, object]],
) -> None:
    client, fake = fake_storage_client
    project_id, document_id, _file_id = await _ready_file(client, fake, org_user, name="c1.ifc")
    job = await _latest_job(client, org_user["access_token"], project_id)
    assert job["status"] == "pending"

    resp = await client.post(
        f"/jobs/{job['id']}/cancel",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "cancelled"
    assert body["finished_at"] is not None
    assert len(job_cancel_calls) == 1
    assert job_cancel_calls[0]["job_id"] == job["id"]

    # The linked file leaves its non-terminal state with a CANCELLED marker.
    listing = await client.get(
        f"/projects/{project_id}/documents/{document_id}/files?status=all",
        headers=_auth(org_user["access_token"]),
    )
    [row] = listing.json()
    assert row["extraction_status"] == "failed"
    assert row["extraction_error"] == "CANCELLED"


async def test_cancel_running_job_rejected(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, fake = fake_storage_client
    project_id, _document_id, file_id = await _ready_file(client, fake, org_user, name="c2.ifc")
    job = await _latest_job(client, org_user["access_token"], project_id)

    running = await client.post(
        "/internal/jobs/callback",
        json={
            "file_id": file_id,
            "job_id": job["id"],
            "organization_id": org_user["organization_id"],
            "status": "running",
            "progress": 40,
        },
        headers=_bearer(),
    )
    assert running.status_code == 200, running.text

    resp = await client.post(
        f"/jobs/{job['id']}/cancel",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 409
    assert resp.json()["detail"] == "JOB_NOT_CANCELLABLE"


async def test_cancel_terminal_job_rejected(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, fake = fake_storage_client
    project_id, _document_id, file_id = await _ready_file(client, fake, org_user, name="c3.ifc")
    job = await _latest_job(client, org_user["access_token"], project_id)

    cb = await client.post(
        "/internal/jobs/callback",
        json={
            "file_id": file_id,
            "job_id": job["id"],
            "organization_id": org_user["organization_id"],
            "status": "succeeded",
            "fragments_key": "x/y.frag",
        },
        headers=_bearer(),
    )
    assert cb.status_code == 200, cb.text

    resp = await client.post(
        f"/jobs/{job['id']}/cancel",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 409
    assert resp.json()["detail"] == "JOB_NOT_CANCELLABLE"


async def test_cancel_already_running_on_processor(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, fake = fake_storage_client
    project_id, _document_id, _file_id = await _ready_file(client, fake, org_user, name="c4.ifc")
    job = await _latest_job(client, org_user["access_token"], project_id)

    async def _already_running(_job_id: object, _settings: object) -> str:
        return "already_running"

    set_job_canceller(_already_running)

    resp = await client.post(
        f"/jobs/{job['id']}/cancel",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 409
    assert resp.json()["detail"] == "JOB_ALREADY_RUNNING"

    # The job must NOT be marked cancelled — the worker owns its terminal state.
    after = await _latest_job(client, org_user["access_token"], project_id)
    assert after["status"] == "pending"
