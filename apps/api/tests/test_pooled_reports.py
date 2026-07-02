"""Free-tier snag-list PDF reports (`/pooled/projects/{id}/reports`).

Covers: create → detached job dispatch (payload shape incl. the pooled callback
path + watermark footer), role gating (owner/editor create, viewer read-only,
non-participant hidden), the worker callback (running → ready with key-scoping,
idempotent terminal, failed), list/get + presigned download for participants,
dispatch-failure marking, the ready notification to the requester, the
concurrent-report guard, and the stuck-report reconcile backstop.
"""

from uuid import UUID, uuid4

from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from bimdossier_api.config import get_settings
from tests.conftest import FakeStorage
from tests.test_pooled_attachments import _create_finding, _upload_attachment
from tests.test_pooled_viewer import (
    _auth,
    _create_document,
    _create_project,
    _free_token,
)


def _worker_auth() -> dict[str, str]:
    return {"Authorization": f"Bearer {get_settings().processor_shared_secret}"}


async def _create_report(client: AsyncClient, token: str, project_id: str) -> dict:
    resp = await client.post(
        f"/pooled/projects/{project_id}/reports", json={}, headers=_auth(token)
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


async def test_create_dispatches_snag_list_job(
    free_tier_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
    job_dispatch_calls: list[dict[str, object]],
) -> None:
    client, fake = free_tier_storage_client
    email = "free-report@example.com"
    token = await _free_token(client, session_maker, email)
    pid = await _create_project(client, token)
    did = await _create_document(client, token, pid, name="Model A")
    att = await _upload_attachment(client, fake, token, pid)
    snag = await _create_finding(client, token, did, photo_ids=[att["id"]])

    body = await _create_report(client, token, pid)
    assert body["status"] == "queued"
    assert body["report_type"] == "snag_list"
    assert body["project_id"] == pid
    assert body["job_id"] is not None

    dispatched = [c for c in job_dispatch_calls if c["job_type"] == "snag_list_report"]
    assert len(dispatched) == 1, job_dispatch_calls
    payload = dispatched[0]["payload"]
    assert payload["report_id"] == body["id"]
    assert payload["callback_path"] == "/internal/jobs/pooled-report-callback"
    # Key scoped under the OWNER's free prefix + this report's reports/ namespace.
    assert isinstance(payload["storage_key"], str)
    assert payload["storage_key"].startswith("free/")
    assert f"reports/{pid}/{body['id']}.pdf" in payload["storage_key"]
    # Findings travel in the worker's snag-list shape, photo keys included.
    findings = payload["findings"]
    assert len(findings) == 1
    assert findings[0]["title"] == snag["title"]
    assert findings[0]["severity"] == "high"
    assert findings[0]["photos"][0]["storage_key"] == att["storage_key"]
    assert payload["recipient"] is None
    assert payload["filters"] == {"status": None, "severity": None}
    # Free watermark rides the branding seam.
    assert "BimDossier" in payload["template"]["branding"]["footer_text"]
    assert payload["project"]["name"]


async def test_report_role_gating(
    free_tier_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    from bimdossier_api.models.pooled_project_member import PooledProjectMember

    client, _ = free_tier_storage_client
    owner_token = await _free_token(client, session_maker, "rep-owner@example.com")
    editor_token = await _free_token(client, session_maker, "rep-editor@example.com")
    viewer_token = await _free_token(client, session_maker, "rep-viewer@example.com")
    outsider_token = await _free_token(client, session_maker, "rep-out@example.com")
    pid = await _create_project(client, owner_token)

    async with session_maker() as s:
        from sqlalchemy import select

        from bimdossier_api.models.user import User

        editor_id = await s.scalar(
            select(User.id).where(User.email == "rep-editor@example.com")
        )
        viewer_id = await s.scalar(
            select(User.id).where(User.email == "rep-viewer@example.com")
        )
        s.add(
            PooledProjectMember(
                pooled_project_id=UUID(pid), user_id=editor_id, role="editor"
            )
        )
        s.add(
            PooledProjectMember(
                pooled_project_id=UUID(pid), user_id=viewer_id, role="viewer"
            )
        )
        await s.commit()

    # Editor may create.
    created = await client.post(
        f"/pooled/projects/{pid}/reports", json={}, headers=_auth(editor_token)
    )
    assert created.status_code == 201, created.text

    # Viewer may NOT create…
    denied = await client.post(
        f"/pooled/projects/{pid}/reports", json={}, headers=_auth(viewer_token)
    )
    assert denied.status_code == 403
    assert denied.json()["detail"] == "FREE_FORBIDDEN"

    # …but may list (same audience as the CSV export).
    listed = await client.get(
        f"/pooled/projects/{pid}/reports", headers=_auth(viewer_token)
    )
    assert listed.status_code == 200
    assert listed.json()["total"] == 1

    # A non-participant sees nothing (404 hides existence).
    hidden = await client.post(
        f"/pooled/projects/{pid}/reports", json={}, headers=_auth(outsider_token)
    )
    assert hidden.status_code == 404
    hidden_list = await client.get(
        f"/pooled/projects/{pid}/reports", headers=_auth(outsider_token)
    )
    assert hidden_list.status_code == 404


async def test_callback_lifecycle_and_key_scoping(
    free_tier_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    client, _ = free_tier_storage_client
    email = "rep-cb@example.com"
    token = await _free_token(client, session_maker, email)
    pid = await _create_project(client, token)
    body = await _create_report(client, token, pid)
    rid = body["id"]

    async with session_maker() as s:
        owner_id = await s.scalar(
            text("SELECT owner_user_id FROM pooled_reports WHERE id = :id"),
            {"id": UUID(rid)},
        )
    good_key = f"free/{owner_id}/reports/{pid}/{rid}.pdf"

    # No/bad bearer → 401.
    unauth = await client.post(
        "/internal/jobs/pooled-report-callback",
        json={"report_id": rid, "status": "running"},
    )
    assert unauth.status_code == 401

    # Unknown report id → 404.
    missing = await client.post(
        "/internal/jobs/pooled-report-callback",
        json={"report_id": str(uuid4()), "status": "running"},
        headers=_worker_auth(),
    )
    assert missing.status_code == 404
    assert missing.json()["detail"] == "FREE_REPORT_NOT_FOUND"

    # running → row running.
    running = await client.post(
        "/internal/jobs/pooled-report-callback",
        json={"report_id": rid, "status": "running"},
        headers=_worker_auth(),
    )
    assert running.status_code == 200
    got = await client.get(
        f"/pooled/projects/{pid}/reports/{rid}", headers=_auth(token)
    )
    assert got.json()["status"] == "running"

    # ready with a foreign-owner key → 400 (the no-RLS boundary).
    foreign = await client.post(
        "/internal/jobs/pooled-report-callback",
        json={
            "report_id": rid,
            "status": "ready",
            "storage_key": f"free/{uuid4()}/reports/{pid}/{rid}.pdf",
        },
        headers=_worker_auth(),
    )
    assert foreign.status_code == 400
    assert foreign.json()["detail"] == "INVALID_FREE_STORAGE_KEY"

    # ready under the right owner but outside this report's project prefix → 400.
    wrong_prefix = await client.post(
        "/internal/jobs/pooled-report-callback",
        json={
            "report_id": rid,
            "status": "ready",
            "storage_key": f"free/{owner_id}/reports/{uuid4()}/{rid}.pdf",
        },
        headers=_worker_auth(),
    )
    assert wrong_prefix.status_code == 400

    # ready without a key → 400.
    keyless = await client.post(
        "/internal/jobs/pooled-report-callback",
        json={"report_id": rid, "status": "ready"},
        headers=_worker_auth(),
    )
    assert keyless.status_code == 400
    assert keyless.json()["detail"] == "MISSING_STORAGE_KEY"

    # Correctly-scoped ready → row ready with integrity metadata + presigned URLs.
    ready = await client.post(
        "/internal/jobs/pooled-report-callback",
        json={
            "report_id": rid,
            "status": "ready",
            "storage_key": good_key,
            "byte_size": 1234,
            "sha256": "a" * 64,
        },
        headers=_worker_auth(),
    )
    assert ready.status_code == 200, ready.text
    got = (
        await client.get(f"/pooled/projects/{pid}/reports/{rid}", headers=_auth(token))
    ).json()
    assert got["status"] == "ready"
    assert got["byte_size"] == 1234
    assert got["download_url"]
    assert got["view_url"]

    # Terminal state is idempotent — a late failed callback is a no-op.
    replay = await client.post(
        "/internal/jobs/pooled-report-callback",
        json={"report_id": rid, "status": "failed", "error": "late"},
        headers=_worker_auth(),
    )
    assert replay.status_code == 200
    still = (
        await client.get(f"/pooled/projects/{pid}/reports/{rid}", headers=_auth(token))
    ).json()
    assert still["status"] == "ready"

    # The requester got a ready notification.
    async with session_maker() as s:
        n = await s.scalar(
            text(
                "SELECT count(*) FROM pooled_notifications "
                "WHERE event_type = 'job_succeeded' AND pooled_project_id = :pid "
                "AND pooled_file_id IS NULL"
            ),
            {"pid": UUID(pid)},
        )
    assert n == 1


async def test_callback_failed_persists_error(
    free_tier_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    client, _ = free_tier_storage_client
    token = await _free_token(client, session_maker, "rep-fail@example.com")
    pid = await _create_project(client, token)
    rid = (await _create_report(client, token, pid))["id"]

    failed = await client.post(
        "/internal/jobs/pooled-report-callback",
        json={"report_id": rid, "status": "failed", "error": "puppeteer crashed"},
        headers=_worker_auth(),
    )
    assert failed.status_code == 200
    got = (
        await client.get(f"/pooled/projects/{pid}/reports/{rid}", headers=_auth(token))
    ).json()
    assert got["status"] == "failed"
    assert "puppeteer crashed" in got["error"]


async def test_concurrent_report_guard(
    free_tier_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    client, _ = free_tier_storage_client
    token = await _free_token(client, session_maker, "rep-busy@example.com")
    pid = await _create_project(client, token)
    await _create_report(client, token, pid)
    await _create_report(client, token, pid)
    third = await client.post(
        f"/pooled/projects/{pid}/reports", json={}, headers=_auth(token)
    )
    assert third.status_code == 429
    assert third.json()["detail"] == "FREE_REPORT_BUSY"


async def test_dispatch_failure_marks_report_failed(
    free_tier_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    from bimdossier_api.jobs import reset_job_dispatcher, set_job_dispatcher
    from bimdossier_api.jobs.dispatcher import DispatchJobError

    client, _ = free_tier_storage_client
    token = await _free_token(client, session_maker, "rep-dispatch@example.com")
    pid = await _create_project(client, token)

    async def _boom(*_args: object, **_kwargs: object) -> None:
        raise DispatchJobError("processor unreachable")

    set_job_dispatcher(_boom)
    try:
        resp = await client.post(
            f"/pooled/projects/{pid}/reports", json={}, headers=_auth(token)
        )
    finally:
        reset_job_dispatcher()
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["status"] == "failed"
    assert body["error"].startswith("DISPATCH_FAILED:")


async def test_stuck_report_reconcile_backstop(
    free_tier_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    from bimdossier_api.pooled_reconcile import sweep_stuck_pooled_reports

    client, _ = free_tier_storage_client
    token = await _free_token(client, session_maker, "rep-stuck@example.com")
    pid = await _create_project(client, token)
    rid = (await _create_report(client, token, pid))["id"]

    async with session_maker() as s:
        await s.execute(
            text(
                "UPDATE pooled_reports SET updated_at = now() - interval '2 hours' "
                "WHERE id = :id"
            ),
            {"id": UUID(rid)},
        )
        await s.commit()

    flipped = await sweep_stuck_pooled_reports(60)
    assert flipped >= 1
    got = (
        await client.get(f"/pooled/projects/{pid}/reports/{rid}", headers=_auth(token))
    ).json()
    assert got["status"] == "failed"
