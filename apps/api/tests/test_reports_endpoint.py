"""Tests for the /projects/{p}/reports user-facing endpoint and the
worker callback at /internal/jobs/reports/callback.

The full UI loop is exercised via FakeStorage + the recording
job-dispatcher stub from conftest. No real worker / S3 / Redis required.
"""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

import pytest
from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, AsyncSession

from tests.conftest import FakeStorage, _auth, _create_project

SECRET = "dev-shared-secret-change-me"


def _bearer(secret: str = SECRET) -> dict[str, str]:
    return {"Authorization": f"Bearer {secret}"}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


_DEFAULT_COMPLIANCE_RESULT = {
    "checked_at": "2026-05-12T09:00:00Z",
    "framework": "bbl",
    "total_rules": 4,
    "total_elements_checked": 12,
    "rules_summary": [
        {
            "rule_id": "R-1",
            "article": "BBL-2.1",
            "title": "Fire safety",
            "title_nl": "Brandveiligheid",
            "category": "fire_safety",
            "severity": "high",
            "pass_count": 3,
            "fail_count": 1,
            "warn_count": 0,
            "skip_count": 0,
        }
    ],
    "category_summary": [
        {
            "category": "fire_safety",
            "total_rules": 1,
            "total_checks": 4,
            "passed": 3,
            "failed": 1,
            "warned": 0,
        }
    ],
    "details": [],
}


async def _seed_succeeded_compliance_job(
    session_maker: async_sessionmaker[AsyncSession],
    organization_id: UUID,
    project_id: UUID,
    *,
    framework: str = "bbl",
    result: dict | None = None,
) -> UUID:
    """Insert a succeeded compliance Job directly via raw SQL so the report
    endpoint has something to render. Bypasses RLS — the seed runs as the
    superuser session. Framework lives in payload after the jurisdiction
    foundation migration; the helper signature mirrors that."""
    from uuid import uuid4
    import json as _json

    job_id = uuid4()
    payload = {"framework": framework}
    schema = f"org_{str(organization_id).replace('-', '')}"
    async with session_maker() as session, session.begin():
        await session.execute(text(f'SET LOCAL search_path TO "{schema}", public'))
        await session.execute(
            text(
                "INSERT INTO jobs (id, project_id, job_type, "
                "status, payload, result, finished_at) "
                "VALUES (:id, :p, 'compliance_check', 'succeeded', "
                "CAST(:pl AS jsonb), CAST(:r AS jsonb), now())"
            ),
            {
                "id": str(job_id),
                "p": str(project_id),
                "pl": _json.dumps(payload),
                "r": _json.dumps(result or _DEFAULT_COMPLIANCE_RESULT),
            },
        )
    return job_id


# ---------------------------------------------------------------------------
# POST /projects/{p}/reports
# ---------------------------------------------------------------------------


async def test_create_report_422_when_no_compliance_data(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, _ = fake_storage_client
    project = await _create_project(client, org_user["access_token"], name="P-no-compl")

    resp = await client.post(
        f"/projects/{project['id']}/reports",
        json={"report_type": "compliance_report"},
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 422, resp.text
    assert resp.json()["detail"] == "NO_COMPLIANCE_DATA"


async def test_create_report_dispatches_with_compliance_payload(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
    job_dispatch_calls: list[dict[str, object]],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    client, _ = fake_storage_client
    project = await _create_project(client, org_user["access_token"], name="P-dispatch")

    source_job_id = await _seed_succeeded_compliance_job(
        session_maker,
        UUID(org_user["organization_id"]),
        UUID(project["id"]),
    )

    job_dispatch_calls.clear()
    resp = await client.post(
        f"/projects/{project['id']}/reports",
        json={"report_type": "compliance_report", "locale": "nl"},
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["status"] == "queued"
    assert body["report_type"] == "compliance_report"
    assert body["locale"] == "nl"
    assert body["source_job_id"] == str(source_job_id)
    assert body["job_id"] is not None
    assert body["download_url"] is None  # not ready yet

    # Dispatcher was called with a Job whose payload contains the compliance
    # snapshot and project metadata — the worker is stateless.
    assert len(job_dispatch_calls) == 1
    call = job_dispatch_calls[0]
    assert call["job_type"] == "compliance_report"
    payload = call["payload"]
    assert payload["report_id"] == body["id"]  # type: ignore[index]
    assert payload["locale"] == "nl"  # type: ignore[index]
    assert "project" in payload  # type: ignore[operator]
    assert "compliance" in payload  # type: ignore[operator]
    assert payload["compliance"]["framework"] == "bbl"  # type: ignore[index]
    assert payload["storage_key"].startswith(  # type: ignore[index]
        f"reports/{org_user['organization_id']}/{project['id']}/"
    )


async def test_create_report_dispatch_failure_marks_failed(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    from bimstitch_api.jobs import DispatchJobError, set_job_dispatcher

    async def _boom(*_args: object, **_kwargs: object) -> None:
        raise DispatchJobError("worker unreachable")

    set_job_dispatcher(_boom)

    client, _ = fake_storage_client
    project = await _create_project(client, org_user["access_token"], name="P-boom")
    await _seed_succeeded_compliance_job(
        session_maker,
        UUID(org_user["organization_id"]),
        UUID(project["id"]),
    )

    resp = await client.post(
        f"/projects/{project['id']}/reports",
        json={"report_type": "compliance_report"},
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["status"] == "failed"
    assert body["error"] is not None
    assert "DISPATCH_FAILED" in body["error"]


# ---------------------------------------------------------------------------
# GET list / GET one
# ---------------------------------------------------------------------------


async def test_list_reports_empty(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, _ = fake_storage_client
    project = await _create_project(client, org_user["access_token"], name="P-empty")

    resp = await client.get(
        f"/projects/{project['id']}/reports",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 200
    assert resp.json() == {"items": [], "total": 0}


async def test_list_reports_returns_newest_first(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    client, _ = fake_storage_client
    project = await _create_project(client, org_user["access_token"], name="P-list")
    await _seed_succeeded_compliance_job(
        session_maker,
        UUID(org_user["organization_id"]),
        UUID(project["id"]),
    )

    # Generate two reports.
    await client.post(
        f"/projects/{project['id']}/reports",
        json={"report_type": "compliance_report"},
        headers=_auth(org_user["access_token"]),
    )
    await client.post(
        f"/projects/{project['id']}/reports",
        json={"report_type": "compliance_report"},
        headers=_auth(org_user["access_token"]),
    )

    resp = await client.get(
        f"/projects/{project['id']}/reports",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 2
    assert len(body["items"]) == 2
    # Newest first.
    ts_a = body["items"][0]["created_at"]
    ts_b = body["items"][1]["created_at"]
    assert ts_a >= ts_b


async def test_get_report_404_for_other_project_report(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    client, _ = fake_storage_client
    project_a = await _create_project(client, org_user["access_token"], name="P-A")
    project_b = await _create_project(client, org_user["access_token"], name="P-B")
    await _seed_succeeded_compliance_job(
        session_maker,
        UUID(org_user["organization_id"]),
        UUID(project_a["id"]),
    )

    create_resp = await client.post(
        f"/projects/{project_a['id']}/reports",
        json={"report_type": "compliance_report"},
        headers=_auth(org_user["access_token"]),
    )
    report_id = create_resp.json()["id"]

    # Asking under project B should 404.
    resp = await client.get(
        f"/projects/{project_b['id']}/reports/{report_id}",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 404


async def test_cross_org_cannot_see_report(
    org_user: dict[str, str],
    other_org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    client, _ = fake_storage_client
    project = await _create_project(client, org_user["access_token"], name="P-iso")
    await _seed_succeeded_compliance_job(
        session_maker,
        UUID(org_user["organization_id"]),
        UUID(project["id"]),
    )
    await client.post(
        f"/projects/{project['id']}/reports",
        json={"report_type": "compliance_report"},
        headers=_auth(org_user["access_token"]),
    )

    # other_org_user can't see the project at all → 404 on list.
    resp = await client.get(
        f"/projects/{project['id']}/reports",
        headers=_auth(other_org_user["access_token"]),
    )
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Worker callback at /internal/jobs/reports/callback
# ---------------------------------------------------------------------------


async def _create_queued_report(
    client: AsyncClient,
    org_user: dict[str, str],
    project_name: str,
    session_maker: async_sessionmaker[AsyncSession],
) -> dict[str, object]:
    project = await _create_project(client, org_user["access_token"], name=project_name)
    await _seed_succeeded_compliance_job(
        session_maker,
        UUID(org_user["organization_id"]),
        UUID(project["id"]),
    )
    resp = await client.post(
        f"/projects/{project['id']}/reports",
        json={"report_type": "compliance_report"},
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    body["project_id"] = project["id"]
    return body


async def test_report_callback_requires_bearer_token(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    client, _ = fake_storage_client
    report = await _create_queued_report(client, org_user, "P-auth", session_maker)

    resp = await client.post(
        "/internal/jobs/reports/callback",
        json={
            "report_id": report["id"],
            "organization_id": org_user["organization_id"],
            "job_id": report["job_id"],
            "status": "ready",
            "storage_key": "reports/x/y/z.pdf",
        },
    )
    assert resp.status_code == 401


async def test_report_callback_transitions_to_ready(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    client, fake = fake_storage_client
    report = await _create_queued_report(client, org_user, "P-ready", session_maker)
    storage_key = (
        f"reports/{org_user['organization_id']}/{report['project_id']}/{report['id']}.pdf"
    )
    fake.objects[storage_key] = b"%PDF-1.7\nfake\n"

    cb = await client.post(
        "/internal/jobs/reports/callback",
        json={
            "report_id": report["id"],
            "organization_id": org_user["organization_id"],
            "job_id": report["job_id"],
            "status": "ready",
            "storage_key": storage_key,
            "byte_size": 14,
            "sha256": "a" * 64,
            "finished_at": datetime.now(timezone.utc).isoformat(),
        },
        headers=_bearer(),
    )
    assert cb.status_code == 200, cb.text
    body = cb.json()
    assert body["status"] == "ready"
    assert body["storage_key"] == storage_key
    assert body["byte_size"] == 14

    # Re-fetch via the user-facing endpoint — download_url should now be populated.
    fetch = await client.get(
        f"/projects/{report['project_id']}/reports/{report['id']}",
        headers=_auth(org_user["access_token"]),
    )
    fb = fetch.json()
    assert fb["status"] == "ready"
    assert fb["download_url"] is not None
    assert fb["download_url"].startswith("http://fake-storage/")


async def test_report_callback_records_failure(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    client, _ = fake_storage_client
    report = await _create_queued_report(client, org_user, "P-fail", session_maker)

    cb = await client.post(
        "/internal/jobs/reports/callback",
        json={
            "report_id": report["id"],
            "organization_id": org_user["organization_id"],
            "job_id": report["job_id"],
            "status": "failed",
            "error": "PUPPETEER_TIMEOUT",
            "finished_at": datetime.now(timezone.utc).isoformat(),
        },
        headers=_bearer(),
    )
    assert cb.status_code == 200
    body = cb.json()
    assert body["status"] == "failed"
    assert body["error"] == "PUPPETEER_TIMEOUT"


async def test_report_callback_idempotent_after_terminal(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    client, fake = fake_storage_client
    report = await _create_queued_report(client, org_user, "P-idem", session_maker)
    storage_key = (
        f"reports/{org_user['organization_id']}/{report['project_id']}/{report['id']}.pdf"
    )
    fake.objects[storage_key] = b"x"

    first = await client.post(
        "/internal/jobs/reports/callback",
        json={
            "report_id": report["id"],
            "organization_id": org_user["organization_id"],
            "job_id": report["job_id"],
            "status": "ready",
            "storage_key": storage_key,
            "byte_size": 1,
            "sha256": "b" * 64,
        },
        headers=_bearer(),
    )
    assert first.status_code == 200
    assert first.json()["status"] == "ready"

    # Second (e.g. retried delivery) is no-op.
    second = await client.post(
        "/internal/jobs/reports/callback",
        json={
            "report_id": report["id"],
            "organization_id": org_user["organization_id"],
            "job_id": report["job_id"],
            "status": "failed",
            "error": "should-be-ignored",
        },
        headers=_bearer(),
    )
    assert second.status_code == 200
    assert second.json()["status"] == "ready"  # unchanged


async def test_report_callback_unknown_report_404(
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    from uuid import uuid4

    client, _ = fake_storage_client
    resp = await client.post(
        "/internal/jobs/reports/callback",
        json={
            "report_id": str(uuid4()),
            "organization_id": org_user["organization_id"],
            "job_id": str(uuid4()),
            "status": "ready",
            "storage_key": "reports/x/y/z.pdf",
        },
        headers=_bearer(),
    )
    assert resp.status_code == 404
    assert resp.json()["detail"] == "REPORT_NOT_FOUND"


# ---------------------------------------------------------------------------
# Callback side-effects: Job row sync + notification emission
# ---------------------------------------------------------------------------


async def test_report_callback_ready_mirrors_status_onto_job_row(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """The Job row is the system-of-record for background work. A ready
    callback must transition the linked Job to succeeded with `result`
    populated, otherwise the /jobs UI will show the work as still pending."""
    client, fake = fake_storage_client
    report = await _create_queued_report(client, org_user, "P-job-sync", session_maker)
    storage_key = (
        f"reports/{org_user['organization_id']}/{report['project_id']}/{report['id']}.pdf"
    )
    fake.objects[storage_key] = b"x"

    cb = await client.post(
        "/internal/jobs/reports/callback",
        json={
            "report_id": report["id"],
            "organization_id": org_user["organization_id"],
            "job_id": report["job_id"],
            "status": "ready",
            "storage_key": storage_key,
            "byte_size": 42,
            "sha256": "c" * 64,
            "started_at": "2026-05-12T10:00:00Z",
            "finished_at": "2026-05-12T10:00:05Z",
        },
        headers=_bearer(),
    )
    assert cb.status_code == 200

    # Pull the Job via the user-facing /jobs endpoint to verify status + result.
    jobs_resp = await client.get(
        f"/jobs/{report['job_id']}", headers=_auth(org_user["access_token"])
    )
    assert jobs_resp.status_code == 200, jobs_resp.text
    job_body = jobs_resp.json()
    assert job_body["status"] == "succeeded"
    assert job_body["result"]["storage_key"] == storage_key
    assert job_body["result"]["byte_size"] == 42
    assert job_body["result"]["sha256"] == "c" * 64
    assert job_body["finished_at"] is not None


async def test_report_callback_failed_mirrors_status_onto_job_row(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    client, _ = fake_storage_client
    report = await _create_queued_report(client, org_user, "P-job-fail", session_maker)

    cb = await client.post(
        "/internal/jobs/reports/callback",
        json={
            "report_id": report["id"],
            "organization_id": org_user["organization_id"],
            "job_id": report["job_id"],
            "status": "failed",
            "error": "CHROMIUM_OOM",
            "finished_at": "2026-05-12T10:01:00Z",
        },
        headers=_bearer(),
    )
    assert cb.status_code == 200

    job_resp = await client.get(
        f"/jobs/{report['job_id']}", headers=_auth(org_user["access_token"])
    )
    body = job_resp.json()
    assert body["status"] == "failed"
    assert body["error"] == "CHROMIUM_OOM"


async def test_report_callback_emits_notification(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """A ready callback must surface a job_succeeded notification carrying the
    job_id so the portal can light up the Reports tab without polling."""
    client, fake = fake_storage_client
    report = await _create_queued_report(client, org_user, "P-notif", session_maker)
    storage_key = (
        f"reports/{org_user['organization_id']}/{report['project_id']}/{report['id']}.pdf"
    )
    fake.objects[storage_key] = b"x"

    # Drain the job_started notification produced by report creation so we can
    # assert specifically on the callback-emitted one below.
    before = await client.get("/notifications", headers=_auth(org_user["access_token"]))
    started_count = before.json()["total"]

    cb = await client.post(
        "/internal/jobs/reports/callback",
        json={
            "report_id": report["id"],
            "organization_id": org_user["organization_id"],
            "job_id": report["job_id"],
            "status": "ready",
            "storage_key": storage_key,
            "byte_size": 1,
            "sha256": "d" * 64,
        },
        headers=_bearer(),
    )
    assert cb.status_code == 200

    after = await client.get("/notifications", headers=_auth(org_user["access_token"]))
    assert after.status_code == 200
    items = after.json()["items"]
    assert after.json()["total"] >= started_count + 1

    # Find the job_succeeded notification for this job.
    matched = [
        n
        for n in items
        if n["event_type"] == "job_succeeded" and n["job_id"] == report["job_id"]
    ]
    assert len(matched) == 1, f"expected one job_succeeded notification, got {matched!r}"
    assert "Rapport gereed" in matched[0]["title"]
    assert matched[0]["project_id"] == report["project_id"]


async def test_report_callback_failed_emits_failure_notification(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    client, _ = fake_storage_client
    report = await _create_queued_report(client, org_user, "P-fail-notif", session_maker)

    cb = await client.post(
        "/internal/jobs/reports/callback",
        json={
            "report_id": report["id"],
            "organization_id": org_user["organization_id"],
            "job_id": report["job_id"],
            "status": "failed",
            "error": "RENDER_TIMEOUT_5MIN",
        },
        headers=_bearer(),
    )
    assert cb.status_code == 200

    notifs = await client.get("/notifications", headers=_auth(org_user["access_token"]))
    items = notifs.json()["items"]
    matched = [
        n for n in items if n["event_type"] == "job_failed" and n["job_id"] == report["job_id"]
    ]
    assert len(matched) == 1
    # The error snippet is included in the body so the user sees what went wrong.
    assert "RENDER_TIMEOUT_5MIN" in matched[0]["body"]


async def test_report_callback_ready_missing_storage_key_400(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """A callback claiming `ready` with no `storage_key` is a contract
    violation — there's nothing to download. Reject explicitly so the worker
    surfaces a clear error rather than leaving the row in a half-baked state."""
    client, _ = fake_storage_client
    report = await _create_queued_report(client, org_user, "P-no-key", session_maker)

    cb = await client.post(
        "/internal/jobs/reports/callback",
        json={
            "report_id": report["id"],
            "organization_id": org_user["organization_id"],
            "job_id": report["job_id"],
            "status": "ready",
            # storage_key intentionally omitted
        },
        headers=_bearer(),
    )
    assert cb.status_code == 400
    assert cb.json()["detail"] == "MISSING_STORAGE_KEY"


# ---------------------------------------------------------------------------
# Listing: pagination + type filter
# ---------------------------------------------------------------------------


async def test_list_reports_paginates(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    client, _ = fake_storage_client
    project = await _create_project(client, org_user["access_token"], name="P-page")
    await _seed_succeeded_compliance_job(
        session_maker,
        UUID(org_user["organization_id"]),
        UUID(project["id"]),
    )
    # Generate three reports.
    for _ in range(3):
        await client.post(
            f"/projects/{project['id']}/reports",
            json={"report_type": "compliance_report"},
            headers=_auth(org_user["access_token"]),
        )

    page1 = await client.get(
        f"/projects/{project['id']}/reports?limit=2&offset=0",
        headers=_auth(org_user["access_token"]),
    )
    assert page1.status_code == 200
    page1_body = page1.json()
    assert page1_body["total"] == 3
    assert len(page1_body["items"]) == 2

    page2 = await client.get(
        f"/projects/{project['id']}/reports?limit=2&offset=2",
        headers=_auth(org_user["access_token"]),
    )
    page2_body = page2.json()
    assert page2_body["total"] == 3
    assert len(page2_body["items"]) == 1

    # No id appears on both pages — actual pagination, not just total/items
    # coincidence.
    page1_ids = {r["id"] for r in page1_body["items"]}
    page2_ids = {r["id"] for r in page2_body["items"]}
    assert page1_ids.isdisjoint(page2_ids)


async def test_list_reports_filters_by_report_type(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    client, _ = fake_storage_client
    project = await _create_project(client, org_user["access_token"], name="P-filter")
    await _seed_succeeded_compliance_job(
        session_maker,
        UUID(org_user["organization_id"]),
        UUID(project["id"]),
    )
    await client.post(
        f"/projects/{project['id']}/reports",
        json={"report_type": "compliance_report"},
        headers=_auth(org_user["access_token"]),
    )

    # Filter by the only valid value — should round-trip the row.
    matched = await client.get(
        f"/projects/{project['id']}/reports?report_type=compliance_report",
        headers=_auth(org_user["access_token"]),
    )
    assert matched.status_code == 200
    assert matched.json()["total"] == 1

    # Bogus type → 422 from FastAPI's enum coercion.
    bogus = await client.get(
        f"/projects/{project['id']}/reports?report_type=not_a_real_type",
        headers=_auth(org_user["access_token"]),
    )
    assert bogus.status_code == 422


# ---------------------------------------------------------------------------
# Generation snapshot — payload contents
# ---------------------------------------------------------------------------


async def test_create_report_snapshot_includes_project_and_contractor(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
    job_dispatch_calls: list[dict[str, object]],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """The worker is stateless — every field it needs to render the cover
    page must live in `payload.project`. Verify address, contractor, and
    permit number are snapshotted into the dispatched payload."""
    from uuid import uuid4

    client, _ = fake_storage_client

    # Build a project with a contractor + permit number directly via SQL so
    # we don't depend on the project wizard's optional-field behaviour.
    org_id = UUID(org_user["organization_id"])
    user_id = UUID(org_user["id"])
    project_id = uuid4()
    contractor_id = uuid4()
    schema = f"org_{str(org_id).replace('-', '')}"
    async with session_maker() as session, session.begin():
        await session.execute(text(f'SET LOCAL search_path TO "{schema}", public'))
        await session.execute(
            text(
                "INSERT INTO contractors (id, name, kvk_number) "
                "VALUES (:id, 'Bouwbedrijf X', '99887766')"
            ),
            {"id": str(contractor_id)},
        )
        await session.execute(
            text(
                "INSERT INTO projects (id, name, owner_id, "
                "contractor_id, street, house_number, postal_code, city, "
                "permit_number) "
                "VALUES (:id, 'P-snap', :owner, :contractor, "
                "'Hoofdstraat', '12', '1011 AB', 'Amsterdam', 'OMG-2026-001')"
            ),
            {
                "id": str(project_id),
                "owner": str(user_id),
                "contractor": str(contractor_id),
            },
        )
        # Owner membership — required by _require_membership.
        await session.execute(
            text(
                "INSERT INTO project_members (project_id, user_id, role) "
                "VALUES (:p, :u, 'owner')"
            ),
            {"p": str(project_id), "u": str(user_id)},
        )

    await _seed_succeeded_compliance_job(session_maker, org_id, project_id)

    job_dispatch_calls.clear()
    resp = await client.post(
        f"/projects/{project_id}/reports",
        json={"report_type": "compliance_report"},
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 201, resp.text

    assert len(job_dispatch_calls) == 1
    payload = job_dispatch_calls[0]["payload"]
    assert isinstance(payload, dict)
    project_snap = payload["project"]
    assert isinstance(project_snap, dict)
    assert project_snap["name"] == "P-snap"
    assert project_snap["permit_number"] == "OMG-2026-001"
    addr = project_snap["address"]
    assert isinstance(addr, dict)
    assert addr["street"] == "Hoofdstraat"
    assert addr["house_number"] == "12"
    assert addr["city"] == "Amsterdam"

    contractor = project_snap["contractor"]
    assert isinstance(contractor, dict)
    assert contractor["name"] == "Bouwbedrijf X"
    assert contractor["kvk_number"] == "99887766"
