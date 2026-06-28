import asyncio
import contextlib
import json
import logging
from typing import TYPE_CHECKING
from uuid import UUID

from fastapi import WebSocket
from redis.asyncio import Redis

if TYPE_CHECKING:
    from redis.asyncio.client import PubSub

from bimdossier_api.notifications.service import CHANNEL_PREFIX

logger = logging.getLogger(__name__)


class ConnectionManager:
    def __init__(self) -> None:
        self._connections: dict[UUID, set[WebSocket]] = {}
        # Per-socket authenticated user id, so a *targeted* notification
        # (recipient_user_id set) is delivered only to that user's sockets and
        # not broadcast to the whole org (L9).
        self._socket_user: dict[WebSocket, UUID] = {}
        # Per-(org, user) socket sets — the denominator for the connection cap
        # (M-en3). Mirrors _connections but keyed by the pair, so one member can't
        # open unbounded sockets in an org (in-org DoS / memory growth).
        self._user_connections: dict[tuple[UUID, UUID], set[WebSocket]] = {}
        self._subscriber_task: asyncio.Task[None] | None = None
        self._pubsub: PubSub | None = None

    async def start(self, redis: Redis) -> None:
        self._pubsub = redis.pubsub()
        await self._pubsub.psubscribe(f"{CHANNEL_PREFIX}*")
        self._subscriber_task = asyncio.create_task(self._listener())

    async def stop(self) -> None:
        if self._subscriber_task is not None:
            self._subscriber_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._subscriber_task
            self._subscriber_task = None

        if self._pubsub is not None:
            await self._pubsub.punsubscribe()
            await self._pubsub.aclose()
            self._pubsub = None

        for conns in self._connections.values():
            for ws in list(conns):
                with contextlib.suppress(Exception):
                    await ws.close()
        self._connections.clear()
        self._socket_user.clear()
        self._user_connections.clear()

    async def connect(
        self,
        ws: WebSocket,
        org_id: UUID,
        user_id: UUID,
        *,
        max_per_user: int,
        subprotocol: str | None = None,
    ) -> bool:
        """Accept and register a socket, unless this (org, user) is already at
        ``max_per_user`` live sockets — then register nothing and return False so
        the caller can refuse the handshake (M-en3).

        ``subprotocol`` is echoed on accept so a browser that opened the socket
        with a ``Sec-WebSocket-Protocol`` credential handshake (M-ws) gets a
        completed negotiation instead of a failed connection.

        The slot is reserved synchronously BEFORE ``await ws.accept()`` so two
        racing handshakes for the same user can't both slip past the check and
        overshoot the cap.
        """
        key = (org_id, user_id)
        user_conns = self._user_connections.setdefault(key, set())
        if len(user_conns) >= max_per_user:
            if not user_conns:  # max_per_user <= 0: drop the empty set we just made
                self._user_connections.pop(key, None)
            return False
        user_conns.add(ws)
        try:
            await ws.accept(subprotocol=subprotocol)
        except Exception:
            user_conns.discard(ws)
            if not user_conns:
                self._user_connections.pop(key, None)
            raise
        self._connections.setdefault(org_id, set()).add(ws)
        self._socket_user[ws] = user_id
        return True

    def disconnect(self, ws: WebSocket, org_id: UUID) -> None:
        self._forget(ws, org_id)

    def _forget(self, ws: WebSocket, org_id: UUID) -> None:
        """Drop a socket from all three indexes (org fan-out set, per-user cap
        set, socket→user map), pruning now-empty buckets."""
        conns = self._connections.get(org_id)
        if conns is not None:
            conns.discard(ws)
            if not conns:
                self._connections.pop(org_id, None)
        user_id = self._socket_user.pop(ws, None)
        if user_id is not None:
            key = (org_id, user_id)
            user_conns = self._user_connections.get(key)
            if user_conns is not None:
                user_conns.discard(ws)
                if not user_conns:
                    self._user_connections.pop(key, None)

    async def _listener(self) -> None:
        assert self._pubsub is not None
        while True:
            try:
                message = await self._pubsub.get_message(
                    ignore_subscribe_messages=True, timeout=1.0
                )
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("Error reading from Redis pubsub")
                await asyncio.sleep(1)
                continue

            if message is None:
                continue

            if message["type"] != "pmessage":
                continue

            channel: str = message["channel"]
            if isinstance(channel, bytes):
                channel = channel.decode()

            org_id_str = channel.removeprefix(CHANNEL_PREFIX)
            try:
                org_id = UUID(org_id_str)
            except ValueError:
                continue

            conns = self._connections.get(org_id)
            if not conns:
                continue

            data = message["data"]
            if isinstance(data, bytes):
                data = data.decode()

            # Per-recipient scoping (L9): a payload carrying a recipient_user_id
            # is targeted — deliver it ONLY to that user's sockets. A missing /
            # null recipient_user_id (or an unparseable payload) is org-wide and
            # goes to everyone, the original behaviour.
            recipient_id: UUID | None = None
            try:
                raw = json.loads(data).get("recipient_user_id")
                if raw:
                    recipient_id = UUID(raw)
            except (ValueError, TypeError, json.JSONDecodeError):
                recipient_id = None

            dead: list[WebSocket] = []
            for ws in conns:
                if recipient_id is not None and self._socket_user.get(ws) != recipient_id:
                    continue
                try:
                    await ws.send_text(data)
                except Exception:
                    dead.append(ws)

            for ws in dead:
                # _forget prunes the per-user cap set too, so a dead socket frees
                # its slot against the M-en3 cap (not just the org fan-out set).
                self._forget(ws, org_id)


_manager: ConnectionManager | None = None


def get_manager() -> ConnectionManager:
    global _manager
    if _manager is None:
        _manager = ConnectionManager()
    return _manager
