"""Storage-key scoping guard on the worker → API callbacks (TENANCY-1).

The processor is trusted via the shared secret, but the callbacks persist
worker-supplied object keys onto rows that are later handed to users as
presigned GET URLs. A compromised worker (or a leaked shared secret) must not
be able to point a row at *another* tenant's object. `storage.scoping.assert_key_scoped`
rejects any artifact key not under the row's own `projects/{project_id}/` (or, for
reports, `reports/{org_id}/{project_id}/`) prefix. See docs/SECURITY_READINESS.md.
"""

from __future__ import annotations

from typing import TYPE_CHECKING
from uuid import uuid4

from tests.conftest import _create_project
from tests.test_attachments import _complete_att, _initiate_att
from tests.test_project_files_extraction import _bearer, _ready_file
from tests.test_reports_endpoint import _create_queued_report

if TYPE_CHECKING:
    import pytest
    from httpx import AsyncClient
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

    from tests.conftest import FakeStorage


async def test_extraction_callback_rejects_cross_project_key(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    """A succeeded callback whose artifact key points outside the file's own
    project is rejected, and the row is not advanced to a terminal state."""
    client, fake = fake_storage_client
    project_id, _document_id, file_id = await _ready_file(client, fake, org_user, name="scoped.ifc")

    # fragments_key under a DIFFERENT project — a compromised worker pointing at
    # another tenant's object.
    foreign = await client.post(
        "/internal/jobs/callback",
        json={
            "file_id": file_id,
            "organization_id": org_user["organization_id"],
            "status": "succeeded",
            "fragments_key": f"projects/{uuid4()}/evil.frag",
            "metadata_key": f"projects/{project_id}/{file_id}.metadata.json",
        },
        headers=_bearer(),
    )
    assert foreign.status_code == 400, foreign.text
    assert foreign.json()["detail"] == "INVALID_STORAGE_KEY"

    # The rejected callback must not have persisted anything or locked the row:
    # a correctly-scoped callback afterward still succeeds.
    ok = await client.post(
        "/internal/jobs/callback",
        json={
            "file_id": file_id,
            "organization_id": org_user["organization_id"],
            "status": "succeeded",
            "fragments_key": f"projects/{project_id}/{file_id}.frag",
        },
        headers=_bearer(),
    )
    assert ok.status_code == 200, ok.text
    assert ok.json()["extraction_status"] == "succeeded"


async def test_report_callback_rejects_cross_org_key(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """A ready report callback whose storage_key is not under this org+project's
    `reports/{org}/{project}/` prefix is rejected."""
    client, _fake = fake_storage_client
    report = await _create_queued_report(client, org_user, "P-scoped", session_maker)

    bad = await client.post(
        "/internal/jobs/reports/callback",
        json={
            "report_id": report["id"],
            "organization_id": org_user["organization_id"],
            "job_id": report["job_id"],
            "status": "ready",
            "storage_key": f"reports/{uuid4()}/{uuid4()}/evil.pdf",
        },
        headers=_bearer(),
    )
    assert bad.status_code == 400, bad.text
    assert bad.json()["detail"] == "INVALID_STORAGE_KEY"


# ---------------------------------------------------------------------------
# Crash-isolation of post-commit work (audit finding #9)
#
# Each callback commits the terminal state inside `async with session.begin()`
# (the in-memory object is also refreshed there, so it carries server-computed
# columns and stays serializable after commit via expire_on_commit=False). The
# genuine side-effect — the in-app notification — runs *post-commit* and is the
# only thing that can fail after the row is terminal. A failure there must NOT
# 500 the callback: a 500 makes the worker retry, hit the terminal-state guard,
# return early, and never re-emit. These tests fail-inject the notification and
# assert the callback still returns 2xx with the committed terminal state.
# ---------------------------------------------------------------------------


async def _boom(*_args: object, **_kwargs: object) -> object:
    """Async stand-in that always raises — used to fail-inject post-commit work."""
    raise RuntimeError("injected post-commit failure")


async def test_extraction_callback_survives_notification_failure(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client, fake = fake_storage_client
    project_id, _document_id, file_id = await _ready_file(
        client, fake, org_user, name="notif-fail.ifc"
    )

    # Inject only after setup so the upload path is unaffected.
    monkeypatch.setattr("bimdossier_api.routers.jobs_internal._emit_notification", _boom)

    body = {
        "file_id": file_id,
        "organization_id": org_user["organization_id"],
        "status": "succeeded",
        "fragments_key": f"projects/{project_id}/{file_id}.frag",
    }
    resp = await client.post("/internal/jobs/callback", json=body, headers=_bearer())
    assert resp.status_code == 200, resp.text
    assert resp.json()["extraction_status"] == "succeeded"

    # Terminal state is durably committed: a second (idempotent) callback
    # short-circuits on the terminal guard and reports succeeded.
    again = await client.post("/internal/jobs/callback", json=body, headers=_bearer())
    assert again.status_code == 200, again.text
    assert again.json()["extraction_status"] == "succeeded"


async def test_report_callback_survives_notification_failure(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client, _fake = fake_storage_client
    report = await _create_queued_report(client, org_user, "P-notif-fail", session_maker)

    monkeypatch.setattr("bimdossier_api.routers.jobs_internal.upsert_job_notification", _boom)

    resp = await client.post(
        "/internal/jobs/reports/callback",
        json={
            "report_id": report["id"],
            "organization_id": org_user["organization_id"],
            "job_id": report["job_id"],
            "status": "ready",
            "storage_key": (f"reports/{org_user['organization_id']}/{report['project_id']}/r.pdf"),
        },
        headers=_bearer(),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "ready"


async def test_attachment_callback_serializes_uploader(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    """Regression for the in-transaction reload: the attachment callback builds
    its response from the committed in-memory row, which must carry both the
    server-computed `updated_at` and the eager-loaded `uploaded_by_user` that
    `AttachmentRead.uploaded_by_name` reads off the `lazy="raise"` relationship.
    A broken reload would surface as a ResponseValidationError (500) here."""
    client, fake = fake_storage_client
    project = await _create_project(client, org_user["access_token"])
    att = await _initiate_att(client, org_user["access_token"], project["id"])
    await _complete_att(client, fake, org_user["access_token"], project["id"], att)

    resp = await client.post(
        "/internal/jobs/attachments/callback",
        json={
            "attachment_id": att["attachment_id"],
            "organization_id": org_user["organization_id"],
            "job_id": str(uuid4()),
            "status": "succeeded",
            "server_metadata": {"gps": {"latitude": 52.0, "longitude": 5.0}},
        },
        headers=_bearer(),
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["server_metadata"]["gps"]["latitude"] == 52.0
    assert "uploaded_by_name" in data
    assert data["updated_at"] is not None
