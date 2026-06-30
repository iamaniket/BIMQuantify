"""Tests for the free-tier notification stack (pooled `public.pooled_notifications`).

Covers: emission on terminal extraction states (succeeded/failed), no emission on
`running`, fan-out to owner + invited members, per-recipient RLS isolation, the read
API (list / unread-count / read / dismiss / mark-all-read / clear), retry dedup, and
per-recipient localization.
"""

from uuid import uuid4

from httpx import AsyncClient
from sqlalchemy import func, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from bimdossier_api.config import get_settings
from bimdossier_api.models.user import User
from tests.conftest import FakeStorage
from tests.test_free_viewer import (
    _auth,
    _callback_succeeded,
    _create_document,
    _create_project,
    _free_token,
    _upload,
)

_SENTINEL_ORG = "00000000-0000-0000-0000-000000000000"


async def _callback_failed(client: AsyncClient, file_id: str, error: str = "boom") -> None:
    secret = get_settings().processor_shared_secret
    resp = await client.post(
        "/internal/jobs/pooled-callback",
        json={"file_id": file_id, "status": "failed", "error": error},
        headers={"Authorization": f"Bearer {secret}"},
    )
    assert resp.status_code == 200, resp.text


async def _callback_running(client: AsyncClient, file_id: str) -> None:
    secret = get_settings().processor_shared_secret
    resp = await client.post(
        "/internal/jobs/pooled-callback",
        json={"file_id": file_id, "status": "running"},
        headers={"Authorization": f"Bearer {secret}"},
    )
    assert resp.status_code == 200, resp.text


async def _set_locale(
    session_maker: async_sessionmaker[AsyncSession], email: str, locale: str
) -> None:
    async with session_maker() as session:
        await session.execute(
            update(User).where(func.lower(User.email) == email.lower()).values(locale=locale)
        )
        await session.commit()


async def _invite_member(
    client: AsyncClient, owner: str, pid: str, email: str, role: str = "editor"
) -> None:
    resp = await client.post(
        f"/pooled/projects/{pid}/members",
        json={"email": email, "role": role},
        headers=_auth(owner),
    )
    assert resp.status_code == 201, resp.text


async def _list(client: AsyncClient, token: str) -> dict:
    resp = await client.get("/pooled/notifications", headers=_auth(token))
    assert resp.status_code == 200, resp.text
    return resp.json()


async def _seed_succeeded_model(
    client: AsyncClient, fake: FakeStorage, owner: str
) -> tuple[str, dict]:
    """Owner uploads + completes a model and drives the succeeded callback. Returns
    (project_id, completed-file-with-storage_key)."""
    pid = await _create_project(client, owner)
    did = await _create_document(client, owner, pid)
    file = await _upload(client, fake, owner, pid, did)
    await _callback_succeeded(client, file["id"], file["storage_key"])
    return pid, file


async def test_notification_emitted_on_succeeded(
    free_tier_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    client, fake = free_tier_storage_client
    owner = await _free_token(client, session_maker, "notif-ok@example.com")
    _, file = await _seed_succeeded_model(client, fake, owner)

    feed = await _list(client, owner)
    assert feed["total"] == 1
    assert feed["unread_count"] == 1
    item = feed["items"][0]
    assert item["event_type"] == "job_succeeded"
    assert item["job_id"] is None
    assert item["organization_id"] == _SENTINEL_ORG
    assert item["file_id"] == file["id"]
    assert "house.ifc" in item["body"]
    assert item["is_read"] is False


async def test_notification_emitted_on_failed(
    free_tier_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    client, fake = free_tier_storage_client
    owner = await _free_token(client, session_maker, "notif-fail@example.com")
    pid = await _create_project(client, owner)
    did = await _create_document(client, owner, pid)
    file = await _upload(client, fake, owner, pid, did)
    await _callback_failed(client, file["id"], error="bad geometry")

    feed = await _list(client, owner)
    assert feed["total"] == 1
    item = feed["items"][0]
    assert item["event_type"] == "job_failed"
    assert "bad geometry" in item["body"]


async def test_no_notification_on_running(
    free_tier_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    client, fake = free_tier_storage_client
    owner = await _free_token(client, session_maker, "notif-running@example.com")
    pid = await _create_project(client, owner)
    did = await _create_document(client, owner, pid)
    file = await _upload(client, fake, owner, pid, did)
    await _callback_running(client, file["id"])

    feed = await _list(client, owner)
    assert feed["total"] == 0


async def test_notification_fans_out_to_members(
    free_tier_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    client, fake = free_tier_storage_client
    owner = await _free_token(client, session_maker, "fan-owner@example.com")
    member = await _free_token(client, session_maker, "fan-member@example.com")
    other = await _free_token(client, session_maker, "fan-other@example.com")

    pid = await _create_project(client, owner)
    await _invite_member(client, owner, pid, "fan-member@example.com")
    did = await _create_document(client, owner, pid)
    file = await _upload(client, fake, owner, pid, did)
    await _callback_succeeded(client, file["id"], file["storage_key"])

    # Owner AND the invited member each get their own row.
    assert (await _list(client, owner))["total"] == 1
    assert (await _list(client, member))["total"] == 1
    # A non-participant sees nothing (RLS).
    assert (await _list(client, other))["total"] == 0


async def test_read_dismiss_clear_flow(
    free_tier_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    client, fake = free_tier_storage_client
    owner = await _free_token(client, session_maker, "notif-flow@example.com")
    await _seed_succeeded_model(client, fake, owner)
    notif_id = (await _list(client, owner))["items"][0]["id"]

    # unread-count reflects the new row.
    count = await client.get("/pooled/notifications/unread-count", headers=_auth(owner))
    assert count.json()["count"] == 1

    # mark-read drops the unread count but keeps the row.
    r = await client.patch(f"/pooled/notifications/{notif_id}/read", headers=_auth(owner))
    assert r.status_code == 204
    feed = await _list(client, owner)
    assert feed["unread_count"] == 0
    assert feed["total"] == 1
    assert feed["items"][0]["is_read"] is True

    # dismiss removes it from the feed.
    d = await client.post(f"/pooled/notifications/{notif_id}/dismiss", headers=_auth(owner))
    assert d.status_code == 204
    assert (await _list(client, owner))["total"] == 0


async def test_mark_all_read_and_clear(
    free_tier_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    client, fake = free_tier_storage_client
    owner = await _free_token(client, session_maker, "notif-bulk@example.com")
    # Two separate models → two notifications.
    await _seed_succeeded_model(client, fake, owner)
    await _seed_succeeded_model(client, fake, owner)
    assert (await _list(client, owner))["unread_count"] == 2

    r = await client.post("/pooled/notifications/mark-all-read", headers=_auth(owner))
    assert r.status_code == 204
    assert (await _list(client, owner))["unread_count"] == 0

    c = await client.post("/pooled/notifications/clear", headers=_auth(owner))
    assert c.status_code == 204
    assert (await _list(client, owner))["total"] == 0


async def test_rls_isolation_between_users(
    free_tier_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    client, fake = free_tier_storage_client
    owner = await _free_token(client, session_maker, "iso-owner@example.com")
    intruder = await _free_token(client, session_maker, "iso-intruder@example.com")
    await _seed_succeeded_model(client, fake, owner)
    notif_id = (await _list(client, owner))["items"][0]["id"]

    # The intruder can neither read nor mutate the owner's notification.
    assert (await _list(client, intruder))["total"] == 0
    r = await client.patch(f"/pooled/notifications/{notif_id}/read", headers=_auth(intruder))
    assert r.status_code == 404
    d = await client.post(f"/pooled/notifications/{notif_id}/dismiss", headers=_auth(intruder))
    assert d.status_code == 404


async def test_unknown_notification_404(
    free_tier_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    client, _ = free_tier_storage_client
    owner = await _free_token(client, session_maker, "notif-404@example.com")
    r = await client.patch(f"/pooled/notifications/{uuid4()}/read", headers=_auth(owner))
    assert r.status_code == 404


async def test_retry_dedups_into_one_row(
    free_tier_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    client, fake = free_tier_storage_client
    owner = await _free_token(client, session_maker, "notif-retry@example.com")
    pid = await _create_project(client, owner)
    did = await _create_document(client, owner, pid)
    file = await _upload(client, fake, owner, pid, did)

    # First attempt fails → one job_failed row.
    await _callback_failed(client, file["id"])
    feed = await _list(client, owner)
    assert feed["total"] == 1
    assert feed["items"][0]["event_type"] == "job_failed"

    # Read it so we can prove the retry resurfaces it as unread.
    notif_id = feed["items"][0]["id"]
    await client.patch(f"/pooled/notifications/{notif_id}/read", headers=_auth(owner))

    # Retry → re-dispatch → succeeded callback. Same (recipient, file) → upsert, not
    # a second row; resurfaced as unread + flipped to job_succeeded.
    retry = await client.post(
        f"/pooled/projects/{pid}/documents/{did}/files/{file['id']}/retry-extraction",
        headers=_auth(owner),
    )
    assert retry.status_code == 200, retry.text
    await _callback_succeeded(client, file["id"], file["storage_key"])

    feed = await _list(client, owner)
    assert feed["total"] == 1  # still ONE row (upserted)
    assert feed["unread_count"] == 1  # resurfaced as unread
    assert feed["items"][0]["event_type"] == "job_succeeded"


async def test_per_recipient_locale(
    free_tier_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    client, fake = free_tier_storage_client
    owner = await _free_token(client, session_maker, "loc-owner@example.com")
    member = await _free_token(client, session_maker, "loc-member@example.com")
    await _set_locale(session_maker, "loc-owner@example.com", "nl")
    await _set_locale(session_maker, "loc-member@example.com", "en")

    pid = await _create_project(client, owner)
    await _invite_member(client, owner, pid, "loc-member@example.com")
    did = await _create_document(client, owner, pid)
    file = await _upload(client, fake, owner, pid, did)
    await _callback_succeeded(client, file["id"], file["storage_key"])

    owner_title = (await _list(client, owner))["items"][0]["title"]
    member_title = (await _list(client, member))["items"][0]["title"]
    # EN title is the catalog's "Extraction completed"; NL differs — assert they're
    # localized per recipient rather than both rendered in one language.
    assert member_title == "Extraction completed"
    assert owner_title != member_title
