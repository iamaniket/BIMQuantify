"""Unread-count caching for the notification badge.

The standalone `/notifications/unread-count` endpoint caches its result per
(org, user) in Redis with a short TTL, since the badge is polled on every
dashboard load and the underlying COUNT is a full scan at scale. The user's
own read actions must invalidate that cache so the badge never shows a stale
(too-high) count after they clear it.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from tests.conftest import _auth, _create_project

if TYPE_CHECKING:
    from httpx import AsyncClient
    from redis.asyncio import Redis


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
