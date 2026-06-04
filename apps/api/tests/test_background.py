"""Tests for the shared background primitives:
- PeriodicSweeper start/stop/cancel and the lock-guarded cycle
- advisory_lock leader election (second holder is excluded)
- map_bounded ordering + concurrency cap
"""

from __future__ import annotations

import asyncio

import pytest

from bimstitch_api.background.concurrency import map_bounded
from bimstitch_api.background.locks import advisory_lock
from bimstitch_api.background.periodic import PeriodicSweeper


@pytest.fixture
def wired_engine(engine, session_maker):
    """Point db.get_engine()/get_session_maker() at the test engine for the
    duration of a test (advisory_lock and the guarded loop call get_engine())."""
    from bimstitch_api import db as db_module

    prev_engine = db_module._engine
    prev_maker = db_module._session_maker
    db_module._engine = engine
    db_module._session_maker = session_maker
    yield engine
    db_module._engine = prev_engine
    db_module._session_maker = prev_maker


# ---------------------------------------------------------------------------
# PeriodicSweeper
# ---------------------------------------------------------------------------


async def test_periodic_sweeper_runs_then_stops() -> None:
    calls = 0

    class _S(PeriodicSweeper):
        async def run_once(self) -> None:
            nonlocal calls
            calls += 1

    sweeper = _S(name="t", interval_seconds=0.01)  # no lock_key -> no DB needed
    sweeper.start()
    assert sweeper._task is not None
    await asyncio.sleep(0.05)
    await sweeper.stop()

    assert calls >= 1
    assert sweeper._task is None


async def test_periodic_sweeper_disabled_when_interval_zero() -> None:
    class _S(PeriodicSweeper):
        async def run_once(self) -> None:  # pragma: no cover - never scheduled
            raise AssertionError("should not run")

    sweeper = _S(name="t", interval_seconds=0)
    sweeper.start()
    assert sweeper._task is None
    await sweeper.stop()  # no-op, must not raise


async def test_run_guarded_skips_when_lock_already_held(wired_engine) -> None:
    calls = 0

    class _S(PeriodicSweeper):
        async def run_once(self) -> None:
            nonlocal calls
            calls += 1

    sweeper = _S(name="t", interval_seconds=60, lock_key="sweep:test_guard")

    # Hold the lock from another session -> the guarded run is skipped.
    async with advisory_lock("sweep:test_guard") as held:
        assert held is True
        await sweeper._run_guarded()
    assert calls == 0

    # Lock free now -> the guarded run executes.
    await sweeper._run_guarded()
    assert calls == 1


# ---------------------------------------------------------------------------
# advisory_lock
# ---------------------------------------------------------------------------


async def test_advisory_lock_excludes_second_holder(wired_engine) -> None:
    async with advisory_lock("sweep:test_excl") as first:
        assert first is True
        async with advisory_lock("sweep:test_excl") as second:
            assert second is False
    # After release, it can be acquired again.
    async with advisory_lock("sweep:test_excl") as again:
        assert again is True


# ---------------------------------------------------------------------------
# map_bounded
# ---------------------------------------------------------------------------


async def test_map_bounded_preserves_input_order() -> None:
    async def fn(x: int) -> int:
        await asyncio.sleep(0)
        return x * 2

    assert await map_bounded([1, 2, 3], fn, limit=2) == [2, 4, 6]


async def test_map_bounded_serial_when_limit_one() -> None:
    order: list[int] = []

    async def fn(x: int) -> int:
        order.append(x)
        return x

    await map_bounded([3, 1, 2], fn, limit=1)
    assert order == [3, 1, 2]


async def test_map_bounded_caps_concurrency() -> None:
    current = 0
    peak = 0

    async def fn(x: int) -> int:
        nonlocal current, peak
        current += 1
        peak = max(peak, current)
        await asyncio.sleep(0.01)
        current -= 1
        return x

    results = await map_bounded(list(range(10)), fn, limit=3)
    assert results == list(range(10))
    assert peak <= 3
