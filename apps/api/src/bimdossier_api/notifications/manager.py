import asyncio
import contextlib
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

    async def connect(self, ws: WebSocket, org_id: UUID) -> None:
        await ws.accept()
        self._connections.setdefault(org_id, set()).add(ws)

    def disconnect(self, ws: WebSocket, org_id: UUID) -> None:
        conns = self._connections.get(org_id)
        if conns is not None:
            conns.discard(ws)
            if not conns:
                del self._connections[org_id]

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

            dead: list[WebSocket] = []
            for ws in conns:
                try:
                    await ws.send_text(data)
                except Exception:
                    dead.append(ws)

            for ws in dead:
                conns.discard(ws)
            if not conns:
                self._connections.pop(org_id, None)


_manager: ConnectionManager | None = None


def get_manager() -> ConnectionManager:
    global _manager
    if _manager is None:
        _manager = ConnectionManager()
    return _manager
