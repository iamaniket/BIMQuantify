"""M-en3: per-(org,user) WebSocket connection cap.

The ConnectionManager refuses sockets past ``max_per_user`` for a given
(org, user) so one authenticated member can't open unbounded sockets (in-org
DoS / memory growth). These unit tests drive the manager directly with a fake
socket — no DB or live WebSocket needed.
"""

from __future__ import annotations

from unittest.mock import AsyncMock
from uuid import uuid4

from bimdossier_api.notifications.manager import ConnectionManager


def _fake_ws() -> AsyncMock:
    ws = AsyncMock()
    ws.accept = AsyncMock()
    return ws


async def test_connect_caps_per_user() -> None:
    mgr = ConnectionManager()
    org, user = uuid4(), uuid4()

    for _ in range(3):
        ws = _fake_ws()
        assert await mgr.connect(ws, org, user, max_per_user=3) is True
        ws.accept.assert_awaited_once()

    # The 4th is refused WITHOUT being accepted (the handshake is rejected).
    overflow = _fake_ws()
    assert await mgr.connect(overflow, org, user, max_per_user=3) is False
    overflow.accept.assert_not_awaited()


async def test_cap_is_per_user_not_per_org() -> None:
    mgr = ConnectionManager()
    org, alice, bob = uuid4(), uuid4(), uuid4()

    assert await mgr.connect(_fake_ws(), org, alice, max_per_user=1) is True
    # Alice is at her cap...
    assert await mgr.connect(_fake_ws(), org, alice, max_per_user=1) is False
    # ...but Bob in the same org is unaffected (cap is per-user, not per-org).
    assert await mgr.connect(_fake_ws(), org, bob, max_per_user=1) is True


async def test_disconnect_frees_a_slot() -> None:
    mgr = ConnectionManager()
    org, user = uuid4(), uuid4()

    ws1 = _fake_ws()
    assert await mgr.connect(ws1, org, user, max_per_user=1) is True
    assert await mgr.connect(_fake_ws(), org, user, max_per_user=1) is False

    # Closing the live socket frees the slot, so a reconnect succeeds.
    mgr.disconnect(ws1, org)
    assert await mgr.connect(_fake_ws(), org, user, max_per_user=1) is True
