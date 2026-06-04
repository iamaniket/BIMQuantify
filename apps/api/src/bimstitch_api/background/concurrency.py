"""Bounded-concurrency fan-out for the per-org sweeps.

The deadline and job-reconcile sweeps walk every active org schema. Doing that
serially makes one slow tenant block the rest and scales poorly as org count
grows; running them all at once would exhaust the DB connection pool. This caps
how many run concurrently.
"""

from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable, Sequence


async def map_bounded[T, R](
    items: Sequence[T],
    fn: Callable[[T], Awaitable[R]],
    *,
    limit: int,
) -> list[R]:
    """Run `fn(item)` for every item with at most `limit` running at once.

    Results are returned in input order. `fn` is expected to handle its own
    errors (e.g. log and return a default) — an exception propagates and
    cancels the rest, matching the previous serial loop's per-item try/except.
    """
    if limit <= 1 or len(items) <= 1:
        return [await fn(item) for item in items]

    sem = asyncio.Semaphore(limit)

    async def _run(item: T) -> R:
        async with sem:
            return await fn(item)

    return await asyncio.gather(*[_run(item) for item in items])
