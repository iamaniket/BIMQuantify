"""Job notification deduplication — one notification per job, latest status wins."""

from __future__ import annotations

from typing import TYPE_CHECKING

from tests.conftest import (
    VALID_IFC_HEADER,
    FakeStorage,
    _auth,
    _create_model,
    _create_project,
)

if TYPE_CHECKING:
    from httpx import AsyncClient

SECRET = "dev-shared-secret-change-me"


def _bearer(secret: str = SECRET) -> dict[str, str]:
    return {"Authorization": f"Bearer {secret}"}


async def _ready_file(
    client: AsyncClient,
    fake: FakeStorage,
    org_user: dict[str, str],
    name: str = "dedup.ifc",
) -> tuple[str, str, str]:
    """Create project + model + initiate + complete a file.
    Returns (project_id, model_id, file_id).
    """
    project = await _create_project(client, org_user["access_token"], name=name + "-p")
    model = await _create_model(
        client, org_user["access_token"], project["id"], name=name + "-m"
    )
    init = (
        await client.post(
            f"/projects/{project['id']}/models/{model['id']}/files/initiate",
            json={
                "filename": name,
                "size_bytes": len(VALID_IFC_HEADER),
                "content_type": "application/octet-stream",
                "content_sha256": "6ef80f63974c453f39da279f6ee263111ae09ac0e884a6f3a148a0da0b8583be",
            },
            headers=_auth(org_user["access_token"]),
        )
    ).json()
    fake.objects[init["storage_key"]] = VALID_IFC_HEADER
    complete = await client.post(
        f"/projects/{project['id']}/models/{model['id']}/files/{init['file_id']}/complete",
        headers=_auth(org_user["access_token"]),
    )
    assert complete.status_code == 200, complete.text
    return project["id"], model["id"], init["file_id"]


async def _get_notifications(client: AsyncClient, token: str) -> dict:
    resp = await client.get("/notifications", headers=_auth(token))
    assert resp.status_code == 200, resp.text
    return resp.json()


# ---------------------------------------------------------------------------
# Extraction callback dedup
# ---------------------------------------------------------------------------


async def test_extraction_running_then_succeeded_produces_one_notification(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, fake = fake_storage_client
    project_id, _model_id, file_id = await _ready_file(
        client, fake, org_user, name="dedup-ok.ifc"
    )

    # Fetch the job_id from the jobs list.
    jobs = (
        await client.get("/jobs", headers=_auth(org_user["access_token"]))
    ).json()["items"]
    job_id = jobs[0]["id"]

    # "running" callback → emits job_started notification.
    running = await client.post(
        "/internal/jobs/callback",
        json={
            "file_id": file_id,
            "organization_id": org_user["organization_id"],
            "job_id": job_id,
            "status": "running",
            "started_at": "2026-04-29T12:00:00Z",
        },
        headers=_bearer(),
    )
    assert running.status_code == 200, running.text

    feed_after_start = await _get_notifications(client, org_user["access_token"])
    started_items = [
        n
        for n in feed_after_start["items"]
        if n["job_id"] == job_id and n["event_type"] == "job_started"
    ]
    assert len(started_items) == 1
    notif_id = started_items[0]["id"]

    # "succeeded" callback → upserts the SAME notification row.
    succeeded = await client.post(
        "/internal/jobs/callback",
        json={
            "file_id": file_id,
            "organization_id": org_user["organization_id"],
            "job_id": job_id,
            "status": "succeeded",
            "fragments_key": f"projects/{project_id}/{file_id}.frag",
            "finished_at": "2026-04-29T12:00:30Z",
        },
        headers=_bearer(),
    )
    assert succeeded.status_code == 200

    feed_after_done = await _get_notifications(client, org_user["access_token"])
    job_notifs = [n for n in feed_after_done["items"] if n["job_id"] == job_id]
    assert len(job_notifs) == 1, f"expected 1 notification per job, got {len(job_notifs)}"
    assert job_notifs[0]["id"] == notif_id, "same notification row was updated, not a new one"
    assert job_notifs[0]["event_type"] == "job_succeeded"
    assert "ready to view" in job_notifs[0]["body"]


async def test_extraction_running_then_failed_produces_one_notification(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, fake = fake_storage_client
    _project_id, _model_id, file_id = await _ready_file(
        client, fake, org_user, name="dedup-fail.ifc"
    )

    jobs = (
        await client.get("/jobs", headers=_auth(org_user["access_token"]))
    ).json()["items"]
    job_id = jobs[0]["id"]

    await client.post(
        "/internal/jobs/callback",
        json={
            "file_id": file_id,
            "organization_id": org_user["organization_id"],
            "job_id": job_id,
            "status": "running",
        },
        headers=_bearer(),
    )

    await client.post(
        "/internal/jobs/callback",
        json={
            "file_id": file_id,
            "organization_id": org_user["organization_id"],
            "job_id": job_id,
            "status": "failed",
            "error": "OOM_KILLED",
        },
        headers=_bearer(),
    )

    feed = await _get_notifications(client, org_user["access_token"])
    job_notifs = [n for n in feed["items"] if n["job_id"] == job_id]
    assert len(job_notifs) == 1
    assert job_notifs[0]["event_type"] == "job_failed"
    assert "OOM_KILLED" in job_notifs[0]["body"]


async def test_upsert_clears_read_state_on_update(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    """When a job_started notification is read and the job then completes,
    the updated notification should resurface as unread."""
    client, fake = fake_storage_client
    project_id, _model_id, file_id = await _ready_file(
        client, fake, org_user, name="dedup-read.ifc"
    )

    jobs = (
        await client.get("/jobs", headers=_auth(org_user["access_token"]))
    ).json()["items"]
    job_id = jobs[0]["id"]

    # Emit "running" notification.
    await client.post(
        "/internal/jobs/callback",
        json={
            "file_id": file_id,
            "organization_id": org_user["organization_id"],
            "job_id": job_id,
            "status": "running",
        },
        headers=_bearer(),
    )

    feed = await _get_notifications(client, org_user["access_token"])
    notif = [n for n in feed["items"] if n["job_id"] == job_id][0]
    assert notif["is_read"] is False

    # Mark it as read.
    mark = await client.patch(
        f"/notifications/{notif['id']}/read",
        headers=_auth(org_user["access_token"]),
    )
    assert mark.status_code == 204

    feed2 = await _get_notifications(client, org_user["access_token"])
    notif2 = [n for n in feed2["items"] if n["job_id"] == job_id][0]
    assert notif2["is_read"] is True

    # Now the job succeeds → upsert clears the read state.
    await client.post(
        "/internal/jobs/callback",
        json={
            "file_id": file_id,
            "organization_id": org_user["organization_id"],
            "job_id": job_id,
            "status": "succeeded",
            "fragments_key": f"projects/{project_id}/{file_id}.frag",
        },
        headers=_bearer(),
    )

    feed3 = await _get_notifications(client, org_user["access_token"])
    notif3 = [n for n in feed3["items"] if n["job_id"] == job_id][0]
    assert notif3["is_read"] is False, "updated notification should resurface as unread"
    assert notif3["event_type"] == "job_succeeded"


async def test_upsert_clears_dismissal_on_update(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    """A dismissed job_started notification should reappear when the job completes."""
    client, fake = fake_storage_client
    project_id, _model_id, file_id = await _ready_file(
        client, fake, org_user, name="dedup-dismiss.ifc"
    )

    jobs = (
        await client.get("/jobs", headers=_auth(org_user["access_token"]))
    ).json()["items"]
    job_id = jobs[0]["id"]

    await client.post(
        "/internal/jobs/callback",
        json={
            "file_id": file_id,
            "organization_id": org_user["organization_id"],
            "job_id": job_id,
            "status": "running",
        },
        headers=_bearer(),
    )

    feed = await _get_notifications(client, org_user["access_token"])
    notif = [n for n in feed["items"] if n["job_id"] == job_id][0]

    # Dismiss it.
    dismiss = await client.post(
        f"/notifications/{notif['id']}/dismiss",
        headers=_auth(org_user["access_token"]),
    )
    assert dismiss.status_code == 204

    feed2 = await _get_notifications(client, org_user["access_token"])
    assert all(n["id"] != notif["id"] for n in feed2["items"]), "dismissed notification should be hidden"

    # Job completes → upsert clears the dismissal.
    await client.post(
        "/internal/jobs/callback",
        json={
            "file_id": file_id,
            "organization_id": org_user["organization_id"],
            "job_id": job_id,
            "status": "succeeded",
            "fragments_key": f"projects/{project_id}/{file_id}.frag",
        },
        headers=_bearer(),
    )

    feed3 = await _get_notifications(client, org_user["access_token"])
    job_notifs = [n for n in feed3["items"] if n["job_id"] == job_id]
    assert len(job_notifs) == 1, "dismissed notification should reappear after upsert"
    assert job_notifs[0]["event_type"] == "job_succeeded"
