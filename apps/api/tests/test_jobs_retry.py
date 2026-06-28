"""Tests for the generic `POST /jobs/{job_id}/retry` lifecycle endpoint."""

from __future__ import annotations

from typing import TYPE_CHECKING

import bimdossier_api.jobs.lifecycle as lifecycle_mod
from bimdossier_api.jobs import DispatchJobError, set_job_dispatcher
from bimdossier_api.jobs.dispatcher import JobConcurrencyError
from tests.conftest import FakeStorage, _auth
from tests.test_project_files_extraction import _bearer, _ready_file

if TYPE_CHECKING:
    from httpx import AsyncClient


async def _jobs(client: AsyncClient, token: str, project_id: str) -> list[dict]:
    resp = await client.get(
        f"/jobs?project_id={project_id}",
        headers=_auth(token),
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["items"]


async def _latest_job(client: AsyncClient, token: str, project_id: str) -> dict:
    items = await _jobs(client, token, project_id)
    assert items, "expected at least one job"
    return items[0]


async def test_retry_retriable_job_creates_new_job(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
    job_dispatch_calls: list[dict[str, object]],
) -> None:
    async def _boom(*_args: object, **_kwargs: object) -> None:
        raise DispatchJobError("connection refused")

    set_job_dispatcher(_boom)
    client, fake = fake_storage_client
    project_id, _document_id, file_id = await _ready_file(client, fake, org_user, name="r1.ifc")

    failed = await _latest_job(client, org_user["access_token"], project_id)
    assert failed["status"] == "failed"
    assert failed["retriable"] is True
    assert failed["error_kind"] == "dispatch"

    # Recording dispatcher so the retry dispatch succeeds.
    job_dispatch_calls.clear()

    async def _record(job, _settings, organization_id) -> None:
        payload = dict(job.payload or {})
        entry: dict[str, object] = {"job_id": str(job.id), "payload": payload}
        for k in ("file_id", "project_id", "storage_key"):
            if k in payload:
                entry[k] = payload[k]
        job_dispatch_calls.append(entry)

    set_job_dispatcher(_record)

    resp = await client.post(
        f"/jobs/{failed['id']}/retry",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "pending"
    assert body["retry_of"] == failed["id"]
    assert body["attempt"] == failed["attempt"] + 1
    assert body["id"] != failed["id"]
    assert len(job_dispatch_calls) == 1
    assert job_dispatch_calls[0]["file_id"] == file_id


async def test_retry_permanent_failure_rejected(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, fake = fake_storage_client
    project_id, _document_id, file_id = await _ready_file(client, fake, org_user, name="r2.ifc")
    job = await _latest_job(client, org_user["access_token"], project_id)

    # Worker reports a permanent failure (retriable omitted → False).
    cb = await client.post(
        "/internal/jobs/callback",
        json={
            "file_id": file_id,
            "job_id": job["id"],
            "organization_id": org_user["organization_id"],
            "status": "failed",
            "error": "UNSUPPORTED_SCHEMA: IFC4X1",
        },
        headers=_bearer(),
    )
    assert cb.status_code == 200, cb.text

    resp = await client.post(
        f"/jobs/{job['id']}/retry",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 409
    assert resp.json()["detail"] == "JOB_NOT_RETRIABLE"


async def test_retry_non_failed_rejected(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, fake = fake_storage_client
    project_id, _document_id, _file_id = await _ready_file(client, fake, org_user, name="r3.ifc")
    job = await _latest_job(client, org_user["access_token"], project_id)
    assert job["status"] == "pending"

    resp = await client.post(
        f"/jobs/{job['id']}/retry",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 409
    assert resp.json()["detail"] == "JOB_NOT_FAILED"


async def test_retry_concurrency_limit_returns_429(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
    monkeypatch,
) -> None:
    async def _boom(*_args: object, **_kwargs: object) -> None:
        raise DispatchJobError("connection refused")

    set_job_dispatcher(_boom)
    client, fake = fake_storage_client
    project_id, _document_id, _file_id = await _ready_file(client, fake, org_user, name="r4.ifc")
    failed = await _latest_job(client, org_user["access_token"], project_id)

    async def _too_many(*_a: object, **_k: object) -> None:
        raise JobConcurrencyError("at limit")

    monkeypatch.setattr(lifecycle_mod, "check_job_concurrency", _too_many)

    resp = await client.post(
        f"/jobs/{failed['id']}/retry",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 429
    assert resp.json()["detail"] == "TOO_MANY_ACTIVE_JOBS"


async def test_retry_dispatch_failure_marks_new_job_failed(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    async def _boom(*_args: object, **_kwargs: object) -> None:
        raise DispatchJobError("connection refused")

    set_job_dispatcher(_boom)
    client, fake = fake_storage_client
    project_id, _document_id, _file_id = await _ready_file(client, fake, org_user, name="r5.ifc")
    failed = await _latest_job(client, org_user["access_token"], project_id)

    # Dispatcher still failing — the retry's fresh job should land failed but
    # remain retriable with the dispatch classification.
    resp = await client.post(
        f"/jobs/{failed['id']}/retry",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "failed"
    assert body["retriable"] is True
    assert body["error_kind"] == "dispatch"
    assert body["retry_of"] == failed["id"]


async def test_concurrent_retry_creates_single_job(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
    job_dispatch_calls: list[dict[str, object]],
) -> None:
    """M-con3: two retries of the same failed job race. The source job row is
    locked and marked non-retriable by the winner, so exactly one creates a new
    job (200) and the other is rejected (409 JOB_NOT_RETRIABLE) — never a
    duplicate extraction job.
    """
    import asyncio

    async def _boom(*_args: object, **_kwargs: object) -> None:
        raise DispatchJobError("connection refused")

    set_job_dispatcher(_boom)
    client, fake = fake_storage_client
    project_id, _document_id, _file_id = await _ready_file(client, fake, org_user, name="rc.ifc")
    failed = await _latest_job(client, org_user["access_token"], project_id)
    assert failed["status"] == "failed"
    assert failed["retriable"] is True

    # Recording dispatcher so the winning retry dispatches cleanly (lands pending).
    job_dispatch_calls.clear()

    async def _record(job, _settings: object, organization_id: object) -> None:
        job_dispatch_calls.append({"job_id": str(job.id)})

    set_job_dispatcher(_record)

    async def _retry() -> object:
        return await client.post(
            f"/jobs/{failed['id']}/retry",
            headers=_auth(org_user["access_token"]),
        )

    r1, r2 = await asyncio.gather(_retry(), _retry())

    statuses = sorted([r1.status_code, r2.status_code])
    assert statuses == [200, 409], (r1.text, r2.text)
    loser = r1 if r1.status_code == 409 else r2
    assert loser.json()["detail"] == "JOB_NOT_RETRIABLE"

    # Exactly one new job was dispatched — the duplicate was prevented.
    assert len(job_dispatch_calls) == 1


async def test_retry_job_rejected_when_project_archived(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    async def _boom(*_args: object, **_kwargs: object) -> None:
        raise DispatchJobError("connection refused")

    set_job_dispatcher(_boom)
    client, fake = fake_storage_client
    project_id, _document_id, _file_id = await _ready_file(client, fake, org_user, name="arch.ifc")

    failed = await _latest_job(client, org_user["access_token"], project_id)
    assert failed["status"] == "failed"

    archive = await client.post(
        f"/projects/{project_id}/archive",
        headers=_auth(org_user["access_token"]),
    )
    assert archive.status_code == 200

    resp = await client.post(
        f"/jobs/{failed['id']}/retry",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 409
    assert resp.json()["detail"] == "PROJECT_ARCHIVED"
