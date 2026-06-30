"""Phase C — notifications unified onto get_scoped_session.

A free user reads/marks/dismisses notifications on the CANONICAL `/notifications`
path (no `/free` prefix); the legacy `/pooled/notifications` alias still works; the
paid behaviour is unchanged (covered by test_notifications.py). The free branch
maps the pooled per-recipient `PooledNotification` onto the same `NotificationOut`.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from tests.test_free_notifications import _seed_succeeded_model
from tests.test_free_viewer import _auth, _free_token

if TYPE_CHECKING:
    from httpx import AsyncClient
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

    from tests.conftest import FakeStorage


async def test_pooled_notifications_read_flow_via_unified_path(
    free_tier_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    client, fake = free_tier_storage_client
    owner = await _free_token(client, session_maker, "notif-free@example.com")
    # Drives a succeeded extraction callback → emits one free notification to the owner.
    await _seed_succeeded_model(client, fake, owner)

    # LIST via the CANONICAL path — one unread item, paid NotificationOut shape.
    listed = await client.get("/notifications", headers=_auth(owner))
    assert listed.status_code == 200, listed.text
    body = listed.json()
    assert body["total"] == 1
    assert body["unread_count"] == 1
    item = body["items"][0]
    assert item["is_read"] is False
    # Free rows carry the sentinel org + null job in the shared shape.
    assert item["organization_id"] == "00000000-0000-0000-0000-000000000000"
    assert item["job_id"] is None
    notif_id = item["id"]

    # unread-count via the canonical path.
    cnt = await client.get("/notifications/unread-count", headers=_auth(owner))
    assert cnt.status_code == 200 and cnt.json()["count"] == 1

    # mark-read via the canonical path → unread drops to 0.
    mr = await client.patch(f"/notifications/{notif_id}/read", headers=_auth(owner))
    assert mr.status_code == 204, mr.text
    cnt2 = await client.get("/notifications/unread-count", headers=_auth(owner))
    assert cnt2.json()["count"] == 0

    # clear via the canonical path → feed empties.
    cl = await client.post("/notifications/clear", headers=_auth(owner))
    assert cl.status_code == 204, cl.text
    after = await client.get("/notifications", headers=_auth(owner))
    assert after.json()["total"] == 0


async def test_pooled_notifications_alias_still_works(
    free_tier_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    client, fake = free_tier_storage_client
    owner = await _free_token(client, session_maker, "notif-alias@example.com")
    await _seed_succeeded_model(client, fake, owner)

    # The legacy alias returns the same feed as the canonical path.
    alias = await client.get("/pooled/notifications", headers=_auth(owner))
    canonical = await client.get("/notifications", headers=_auth(owner))
    assert alias.status_code == 200 and canonical.status_code == 200
    assert alias.json()["total"] == canonical.json()["total"] == 1
    assert [i["id"] for i in alias.json()["items"]] == [i["id"] for i in canonical.json()["items"]]


async def test_paid_notifications_list_unchanged(
    client: AsyncClient,
    org_user: dict[str, str],
) -> None:
    """A paid user still hits /notifications (the unified router's paid branch)."""
    resp = await client.get("/notifications", headers=_auth(org_user["access_token"]))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["total"] == 0
    assert body["unread_count"] == 0
    assert body["items"] == []
