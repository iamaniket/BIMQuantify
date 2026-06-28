"""Unread-count caching for the notification badge.

The standalone `/notifications/unread-count` endpoint caches its result per
(org, user) in Redis with a short TTL, since the badge is polled on every
dashboard load and the underlying COUNT is a full scan at scale. The user's
own read actions must invalidate that cache so the badge never shows a stale
(too-high) count after they clear it.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING
from uuid import UUID, uuid4

from sqlalchemy import text

from tests.conftest import _auth, _create_attachment_row, _create_project

if TYPE_CHECKING:
    from httpx import AsyncClient
    from redis.asyncio import Redis
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker


async def _emit_finding_notification(
    client: AsyncClient, token: str, project_id: str, assignee_user_id: str
) -> None:
    """Create a draft finding and promote it to `open`.

    Promotion (draft → open) is what emits the `finding_created` notification
    (see routers/finding.py); a bare draft create does not.
    """
    created = (
        await client.post(
            f"/projects/{project_id}/findings",
            json={"title": "Cache test finding", "description": "x"},
            headers=_auth(token),
        )
    ).json()
    resp = await client.patch(
        f"/projects/{project_id}/findings/{created['id']}",
        json={
            "status": "open",
            "deadline_date": "2026-08-01",
            "assignee_user_id": assignee_user_id,
        },
        headers=_auth(token),
    )
    assert resp.status_code == 200, resp.text


async def test_unread_count_cached_and_invalidated_on_mark_all_read(
    client: AsyncClient,
    org_user: dict[str, str],
    redis_client: Redis,
) -> None:
    token = org_user["access_token"]
    project = await _create_project(client, token)
    await _emit_finding_notification(client, token, project["id"], org_user["id"])

    # First read populates the per-(org, user) cache key.
    first = await client.get("/notifications/unread-count", headers=_auth(token))
    assert first.status_code == 200, first.text
    count = first.json()["count"]
    assert count >= 1

    keys = await redis_client.keys("notif:unread:*")
    assert len(keys) == 1
    assert await redis_client.get(keys[0]) == str(count)

    # Marking all read must drop the cache key, not leave a stale count behind.
    marked = await client.post("/notifications/mark-all-read", headers=_auth(token))
    assert marked.status_code == 204, marked.text
    assert await redis_client.keys("notif:unread:*") == []

    # The recomputed count is fresh (0) — proving no stale cache was served.
    after = await client.get("/notifications/unread-count", headers=_auth(token))
    assert after.status_code == 200, after.text
    assert after.json()["count"] == 0


# ---------------------------------------------------------------------------
# Per-user dismiss / clear
#
# Notifications are org-shared (no `user_id` column); dismissal must be
# per-user, mirroring read state. Dismissing hides the row for the caller
# only — teammates still see it — and never hard-deletes the shared row.
# ---------------------------------------------------------------------------


async def _list_notifications(client: AsyncClient, token: str) -> dict:
    resp = await client.get("/notifications", headers=_auth(token))
    assert resp.status_code == 200, resp.text
    return resp.json()


async def _emit_resolved_notification(
    client: AsyncClient, token: str, project_id: str, assignee_user_id: str
) -> str:
    """Create → promote → resolve a finding, returning the org-wide
    `finding_resolved` notification's id.

    The per-user dismiss/clear tests need a notification every org member can
    see. Promotion now emits an *assignee-scoped* `finding_created` (only the
    assignee sees it), so it's no longer the org-wide vehicle — resolution is.
    `finding_resolved` is still a project-wide fan-out (no `recipient_user_id`).
    """
    created = (
        await client.post(
            f"/projects/{project_id}/findings",
            json={"title": "Dismiss test finding", "description": "x"},
            headers=_auth(token),
        )
    ).json()
    finding_id = created["id"]
    # Promote (draft → open) requires a deadline + assignee.
    promote = await client.patch(
        f"/projects/{project_id}/findings/{finding_id}",
        json={
            "status": "open",
            "deadline_date": "2026-08-01",
            "assignee_user_id": assignee_user_id,
        },
        headers=_auth(token),
    )
    assert promote.status_code == 200, promote.text
    # Resolve (open → resolved) requires a note + ≥1 evidence attachment.
    evidence = [await _create_attachment_row(project_id)]
    resolve = await client.patch(
        f"/projects/{project_id}/findings/{finding_id}",
        json={
            "status": "resolved",
            "resolution_note": "Afgekit en visueel gecontroleerd.",
            "resolution_evidence_ids": evidence,
        },
        headers=_auth(token),
    )
    assert resolve.status_code == 200, resolve.text
    feed = await _list_notifications(client, token)
    resolved = next(n for n in feed["items"] if n["event_type"] == "finding_resolved")
    return resolved["id"]


async def test_dismiss_hides_notification_for_caller_only(
    client: AsyncClient,
    org_user: dict[str, str],
    same_org_user: dict[str, str],
) -> None:
    token = org_user["access_token"]
    project = await _create_project(client, token)
    notif_id = await _emit_resolved_notification(client, token, project["id"], org_user["id"])

    # Both members of the org see the same org-wide `finding_resolved` row.
    owner_before = await _list_notifications(client, token)
    assert any(n["id"] == notif_id for n in owner_before["items"])

    other_token = same_org_user["access_token"]
    other_before = await _list_notifications(client, other_token)
    assert any(n["id"] == notif_id for n in other_before["items"])

    # Owner dismisses it.
    resp = await client.post(f"/notifications/{notif_id}/dismiss", headers=_auth(token))
    assert resp.status_code == 204, resp.text

    # Gone from the owner's feed...
    owner_after = await _list_notifications(client, token)
    assert all(n["id"] != notif_id for n in owner_after["items"])

    # ...but the teammate is unaffected (per-user dismissal, not a hard delete).
    other_after = await _list_notifications(client, other_token)
    assert any(n["id"] == notif_id for n in other_after["items"])
    assert other_after["total"] == other_before["total"]


async def test_dismiss_is_idempotent(
    client: AsyncClient,
    org_user: dict[str, str],
) -> None:
    token = org_user["access_token"]
    project = await _create_project(client, token)
    await _emit_finding_notification(client, token, project["id"], org_user["id"])
    notif_id = (await _list_notifications(client, token))["items"][0]["id"]

    first = await client.post(f"/notifications/{notif_id}/dismiss", headers=_auth(token))
    assert first.status_code == 204, first.text
    second = await client.post(f"/notifications/{notif_id}/dismiss", headers=_auth(token))
    assert second.status_code == 204, second.text

    assert (await _list_notifications(client, token))["total"] == 0


async def test_dismiss_unknown_id_returns_404(
    client: AsyncClient,
    org_user: dict[str, str],
) -> None:
    from uuid import uuid4

    resp = await client.post(
        f"/notifications/{uuid4()}/dismiss", headers=_auth(org_user["access_token"])
    )
    assert resp.status_code == 404, resp.text


async def test_clear_empties_caller_feed_only(
    client: AsyncClient,
    org_user: dict[str, str],
    same_org_user: dict[str, str],
) -> None:
    token = org_user["access_token"]
    project = await _create_project(client, token)
    # Two org-wide `finding_resolved` notifications: one will be read, one left
    # unread — clear must drop both for the caller. (Each create→promote→resolve
    # also emits an assignee-scoped `finding_created` to the actor, which clear
    # likewise removes from their own feed but never from the teammate's.)
    first_id = await _emit_resolved_notification(client, token, project["id"], org_user["id"])
    second_id = await _emit_resolved_notification(client, token, project["id"], org_user["id"])

    other_token = same_org_user["access_token"]
    other_before = await _list_notifications(client, other_token)
    # The teammate sees the two org-wide resolved rows (not the scoped created ones).
    assert any(n["id"] == first_id for n in other_before["items"])
    assert any(n["id"] == second_id for n in other_before["items"])

    # Read one of the owner's resolved notifications, then clear — clear drops
    # read and unread alike.
    marked = await client.patch(f"/notifications/{first_id}/read", headers=_auth(token))
    assert marked.status_code == 204, marked.text

    cleared = await client.post("/notifications/clear", headers=_auth(token))
    assert cleared.status_code == 204, cleared.text

    owner_after = await _list_notifications(client, token)
    assert owner_after["total"] == 0
    assert owner_after["unread_count"] == 0

    # The teammate still has both resolved notifications.
    other_after = await _list_notifications(client, other_token)
    assert any(n["id"] == first_id for n in other_after["items"])
    assert any(n["id"] == second_id for n in other_after["items"])


async def test_dismiss_invalidates_unread_count_cache(
    client: AsyncClient,
    org_user: dict[str, str],
    redis_client: Redis,
) -> None:
    token = org_user["access_token"]
    project = await _create_project(client, token)
    await _emit_finding_notification(client, token, project["id"], org_user["id"])

    # Populate the per-(org, user) cache key.
    first = await client.get("/notifications/unread-count", headers=_auth(token))
    assert first.status_code == 200, first.text
    assert first.json()["count"] == 1
    assert len(await redis_client.keys("notif:unread:*")) == 1

    notif_id = (await _list_notifications(client, token))["items"][0]["id"]
    resp = await client.post(f"/notifications/{notif_id}/dismiss", headers=_auth(token))
    assert resp.status_code == 204, resp.text

    # Dismiss dropped the cache key; the recomputed count is fresh (0).
    assert await redis_client.keys("notif:unread:*") == []
    after = await client.get("/notifications/unread-count", headers=_auth(token))
    assert after.json()["count"] == 0


# ---------------------------------------------------------------------------
# Keyset ("load more") pagination on the notifications feed (S7)
# ---------------------------------------------------------------------------


async def _seed_notifications(
    session_maker: async_sessionmaker[AsyncSession],
    organization_id: UUID,
    project_id: str,
    n: int,
    base: datetime,
) -> list[str]:
    """Insert n org-wide notifications with strictly increasing created_at.
    Returns ids in ascending-created_at order (so reversed() is newest-first)."""
    schema = f"org_{str(organization_id).replace('-', '')}"
    ids: list[str] = []
    async with session_maker() as session, session.begin():
        await session.execute(text(f'SET LOCAL search_path TO "{schema}", public'))
        for i in range(n):
            nid = str(uuid4())
            ids.append(nid)
            await session.execute(
                text(
                    "INSERT INTO notifications (id, event_type, title, body, "
                    "project_id, created_at) VALUES (:id, "
                    "CAST(:et AS notificationeventtype), :title, :body, :pid, :ts)"
                ),
                {
                    "id": nid,
                    "et": "finding_created",
                    "title": f"N{i}",
                    "body": "b",
                    "pid": project_id,
                    "ts": base + timedelta(minutes=i),
                },
            )
    return ids


async def test_notifications_keyset_cursor_pages_without_overlap(
    client: AsyncClient,
    org_user: dict[str, str],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """Cursor paging walks the whole feed newest-first with no overlap or gaps,
    and the total/unread counts stay exact on every page (not just the first)."""
    token = org_user["access_token"]
    project = await _create_project(client, token)
    base = datetime(2026, 5, 1, 9, 0, tzinfo=UTC)
    ids = await _seed_notifications(
        session_maker, UUID(org_user["organization_id"]), project["id"], 5, base
    )
    expected = [i for i in reversed(ids)]  # newest-first

    # First page via the default offset path; it still hands back a cursor.
    first = await client.get("/notifications?limit=2", headers=_auth(token))
    assert first.status_code == 200, first.text
    body = first.json()
    assert body["total"] == 5
    assert body["unread_count"] == 5
    assert body["next_cursor"] is not None
    seen = [it["id"] for it in body["items"]]

    # Remaining pages via the keyset cursor.
    cursor = body["next_cursor"]
    while cursor is not None:
        resp = await client.get(
            f"/notifications?limit=2&cursor={cursor}", headers=_auth(token)
        )
        assert resp.status_code == 200, resp.text
        page = resp.json()
        assert page["total"] == 5  # exact counts on every keyset page
        seen += [it["id"] for it in page["items"]]
        cursor = page["next_cursor"]

    assert seen == expected  # full coverage, newest-first, no dupes
    assert len(set(seen)) == 5


async def test_notifications_invalid_cursor_is_422(
    client: AsyncClient,
    org_user: dict[str, str],
) -> None:
    token = org_user["access_token"]
    await _create_project(client, token)
    resp = await client.get(
        "/notifications?cursor=not-a-real-cursor", headers=_auth(token)
    )
    assert resp.status_code == 422, resp.text
