"""Postgres advisory-lock helper for cross-instance leader election.

Used by the background sweepers so that, when more than one API instance is
running, only ONE executes a given sweep cycle. Transaction-scoped
(`pg_try_advisory_xact_lock`) so the lock auto-releases when the holding
connection's transaction ends — there is no TTL to tune, and a crashed
instance frees the lock as soon as its connection drops.
"""

from __future__ import annotations

import hashlib
from contextlib import asynccontextmanager
from typing import TYPE_CHECKING

from sqlalchemy import text

from bimdossier_api.db import get_engine

if TYPE_CHECKING:
    from collections.abc import AsyncIterator


def lock_id_for(key: str) -> int:
    """Map a lock name to a signed 64-bit int for `pg_advisory_*` (which take a
    bigint). A blake2b digest keeps the mapping stable across processes/runs."""
    digest = hashlib.blake2b(key.encode("utf-8"), digest_size=8).digest()
    return int.from_bytes(digest, "big", signed=True)


@asynccontextmanager
async def advisory_lock(key: str) -> AsyncIterator[bool]:
    """Try to acquire a transaction-scoped Postgres advisory lock for `key`.

    Yields True if acquired (released automatically when the block exits),
    False if another session already holds it. Never blocks waiting.

    The lock is held for the duration of the `async with` body, so callers
    should keep that body to the actual guarded work.
    """
    lock_id = lock_id_for(key)
    async with get_engine().begin() as conn:
        acquired = bool(
            await conn.scalar(text("SELECT pg_try_advisory_xact_lock(:k)"), {"k": lock_id})
        )
        yield acquired
