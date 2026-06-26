"""Worker failure classification flows onto the Job via the callback."""

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


async def test_failed_callback_records_retriable_classification(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, fake = fake_storage_client
    project_id, _document_id, file_id = await _ready_file(client, fake, org_user, name="cls1.ifc")
    job = await _latest_job(client, org_user["access_token"], project_id)

    cb = await client.post(
        "/internal/jobs/callback",
        json={
            "file_id": file_id,
            "job_id": job["id"],
            "organization_id": org_user["organization_id"],
            "status": "failed",
            "error": "S3 timeout",
            "retriable": True,
            "error_kind": "network",
        },
        headers=_bearer(),
    )
    assert cb.status_code == 200, cb.text

    after = await _latest_job(client, org_user["access_token"], project_id)
    assert after["status"] == "failed"
    assert after["retriable"] is True
    assert after["error_kind"] == "network"


async def test_failed_callback_defaults_to_permanent(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, fake = fake_storage_client
    project_id, _document_id, file_id = await _ready_file(client, fake, org_user, name="cls2.ifc")
    job = await _latest_job(client, org_user["access_token"], project_id)

    cb = await client.post(
        "/internal/jobs/callback",
        json={
            "file_id": file_id,
            "job_id": job["id"],
            "organization_id": org_user["organization_id"],
            "status": "failed",
            "error": "corrupt geometry",
        },
        headers=_bearer(),
    )
    assert cb.status_code == 200, cb.text

    after = await _latest_job(client, org_user["access_token"], project_id)
    assert after["status"] == "failed"
    assert after["retriable"] is False
    assert after["error_kind"] is None
