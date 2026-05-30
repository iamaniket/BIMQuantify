"""Worker-reported progress flows onto the Job via the running callback."""

from __future__ import annotations

from typing import TYPE_CHECKING

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


async def test_running_callback_records_progress(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, fake = fake_storage_client
    project_id, _model_id, file_id = await _ready_file(client, fake, org_user, name="prog1.ifc")
    job = await _latest_job(client, org_user["access_token"], project_id)
    assert job["progress"] == 0

    running = await client.post(
        "/internal/jobs/callback",
        json={
            "file_id": file_id,
            "job_id": job["id"],
            "organization_id": org_user["organization_id"],
            "status": "running",
            "progress": 55,
        },
        headers=_bearer(),
    )
    assert running.status_code == 200, running.text

    after = await _latest_job(client, org_user["access_token"], project_id)
    assert after["status"] == "running"
    assert after["progress"] == 55


async def test_succeeded_callback_sets_progress_complete(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, fake = fake_storage_client
    project_id, _model_id, file_id = await _ready_file(client, fake, org_user, name="prog2.ifc")
    job = await _latest_job(client, org_user["access_token"], project_id)

    succeeded = await client.post(
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
    assert succeeded.status_code == 200, succeeded.text

    after = await _latest_job(client, org_user["access_token"], project_id)
    assert after["status"] == "succeeded"
    assert after["progress"] == 100
