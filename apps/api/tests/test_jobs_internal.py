"""Storage-key scoping guard on the worker → API callbacks (TENANCY-1).

The processor is trusted via the shared secret, but the callbacks persist
worker-supplied object keys onto rows that are later handed to users as
presigned GET URLs. A compromised worker (or a leaked shared secret) must not
be able to point a row at *another* tenant's object. `jobs_internal._assert_key_scoped`
rejects any artifact key not under the row's own `projects/{project_id}/` (or, for
reports, `reports/{org_id}/{project_id}/`) prefix. See docs/SECURITY_READINESS.md.
"""

from __future__ import annotations

from typing import TYPE_CHECKING
from uuid import uuid4

from tests.test_project_files_extraction import _bearer, _ready_file
from tests.test_reports_endpoint import _create_queued_report

if TYPE_CHECKING:
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
    project_id, _document_id, file_id = await _ready_file(
        client, fake, org_user, name="scoped.ifc"
    )

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
