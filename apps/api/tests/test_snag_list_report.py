"""Tests for the per-recipient snag-list report (#G2).

POST /projects/{p}/reports with report_type=snag_list creates a Report + Job
and dispatches a `snag_list_report` worker job. The full loop is exercised via
the recording job-dispatcher stub from conftest (no real worker / S3 / Redis).
"""

from __future__ import annotations

from typing import TYPE_CHECKING
from uuid import uuid4

from tests.conftest import FakeStorage, _auth, _create_project

if TYPE_CHECKING:
    from httpx import AsyncClient


async def _create_finding(
    client: AsyncClient,
    token: str,
    project_id: str,
    *,
    title: str = "Bevinding",
    severity: str = "medium",
) -> dict:
    resp = await client.post(
        f"/projects/{project_id}/findings",
        json={"title": title, "description": "Test", "severity": severity},
        headers=_auth(token),
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


async def test_create_snag_list_report_dispatches(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
    job_dispatch_calls: list[dict[str, object]],
) -> None:
    client, _ = fake_storage_client
    token = org_user["access_token"]
    project = await _create_project(client, token, name="snag-p")
    await _create_finding(client, token, project["id"], title="Snag A", severity="high")
    await _create_finding(client, token, project["id"], title="Snag B", severity="low")

    job_dispatch_calls.clear()
    resp = await client.post(
        f"/projects/{project['id']}/reports",
        json={"report_type": "snag_list", "locale": "nl"},
        headers=_auth(token),
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["report_type"] == "snag_list"
    assert body["source_job_id"] is None  # not derived from a source job

    assert len(job_dispatch_calls) == 1
    call = job_dispatch_calls[0]
    assert call["job_type"] == "snag_list_report"
    payload = call["payload"]
    assert isinstance(payload, dict)
    assert payload["report_id"] == body["id"]
    assert payload["locale"] == "nl"
    findings = payload["findings"]
    assert isinstance(findings, list) and len(findings) == 2
    # No assignee filter → no recipient on the cover.
    assert payload["recipient"] is None
    assert payload["filters"] == {"status": None, "severity": None}


async def test_create_snag_list_report_recipient_and_filter(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
    job_dispatch_calls: list[dict[str, object]],
) -> None:
    client, _ = fake_storage_client
    token = org_user["access_token"]
    project = await _create_project(client, token, name="snag-recip")
    mine = await _create_finding(client, token, project["id"], title="Mine", severity="high")
    await _create_finding(client, token, project["id"], title="Theirs", severity="high")

    # Assign one finding to the org user (a project member); stays a draft.
    patch = await client.patch(
        f"/projects/{project['id']}/findings/{mine['id']}",
        json={"assignee_user_id": org_user["id"]},
        headers=_auth(token),
    )
    assert patch.status_code == 200, patch.text

    job_dispatch_calls.clear()
    resp = await client.post(
        f"/projects/{project['id']}/reports",
        json={
            "report_type": "snag_list",
            "params": {"assignee_user_id": org_user["id"], "severity": "high"},
        },
        headers=_auth(token),
    )
    assert resp.status_code == 201, resp.text

    assert len(job_dispatch_calls) == 1
    payload = job_dispatch_calls[0]["payload"]
    assert isinstance(payload, dict)
    findings = payload["findings"]
    assert isinstance(findings, list) and len(findings) == 1
    assert findings[0]["title"] == "Mine"
    recipient = payload["recipient"]
    assert isinstance(recipient, dict)
    assert recipient["email"] == org_user["email"]
    assert payload["filters"]["severity"] == "high"


async def test_create_snag_list_report_invalid_filter_422(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, _ = fake_storage_client
    token = org_user["access_token"]
    project = await _create_project(client, token, name="snag-badfilter")

    resp = await client.post(
        f"/projects/{project['id']}/reports",
        json={"report_type": "snag_list", "params": {"status": "not-a-status"}},
        headers=_auth(token),
    )
    assert resp.status_code == 422, resp.text
    assert resp.json()["detail"] == "INVALID_FINDING_FILTER"


async def test_create_snag_list_report_assignee_not_member_422(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, _ = fake_storage_client
    token = org_user["access_token"]
    project = await _create_project(client, token, name="snag-nonmember")

    resp = await client.post(
        f"/projects/{project['id']}/reports",
        json={"report_type": "snag_list", "params": {"assignee_user_id": str(uuid4())}},
        headers=_auth(token),
    )
    assert resp.status_code == 422, resp.text
    assert resp.json()["detail"] == "ASSIGNEE_NOT_A_PROJECT_MEMBER"
