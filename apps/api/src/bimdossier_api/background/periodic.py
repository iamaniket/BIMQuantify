"""Shared base for the lifespan-managed background sweepers.

A sweeper is an asyncio task that, on an interval, optionally acquires a
cross-instance lock and runs one pass. Extracting this removes the identical
loop/start/stop boilerplate the three sweepers used to copy, and gives all of
them leader-election (only one app instance runs a given cycle) for free.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging

from bimdossier_api.background.locks import advisory_lock

logger = logging.getLogger(__name__)


class PeriodicSweeper:
    """Runs `run_once` on an interval inside the API process.

    `start()` schedules the task, `stop()` cancels and awaits it. Set
    `interval_seconds <= 0` to disable. When `lock_key` is set, each cycle is
    guarded by a Postgres advisory lock so only one instance runs it.
    """

    def __init__(
        self,
        *,
        name: str,
        interval_seconds: float,
        lock_key: str | None = None,
    ) -> None:
        self.name = name
        self.interval_seconds = interval_seconds
        self.lock_key = lock_key
        self._task: asyncio.Task[None] | None = None

    async def run_once(self) -> None:
        """One sweep pass. Subclasses override."""
        raise NotImplementedError

    async def _run_guarded(self) -> None:
        """Run one pass, holding the cross-instance lock if configured. If
        another instance already holds it, skip this cycle."""
        if self.lock_key is None:
            await self.run_once()
            return
        async with advisory_lock(self.lock_key) as acquired:
            if not acquired:
                logger.debug("%s: another instance holds the lock; skipping cycle", self.name)
                return
            await self.run_once()

    async def _loop(self) -> None:
        while True:
            try:
                await asyncio.sleep(self.interval_seconds)
                await self._run_guarded()
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("%s loop iteration failed", self.name)

    def start(self) -> None:
        if self.interval_seconds <= 0:
            logger.info("%s disabled (interval=0)", self.name)
            return
        if self._task is not None:
            return
        self._task = asyncio.create_task(self._loop(), name=self.name)

    async def stop(self) -> None:
        if self._task is None:
            return
        self._task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await self._task
        self._task = None
