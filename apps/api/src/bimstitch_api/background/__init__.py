"""Background task primitives shared by the lifespan-managed sweepers:
periodic sweeper base, cross-instance leader-election lock, and a
bounded-concurrency fan-out helper."""

from bimstitch_api.background.concurrency import map_bounded
from bimstitch_api.background.locks import advisory_lock
from bimstitch_api.background.periodic import PeriodicSweeper

__all__ = ["PeriodicSweeper", "advisory_lock", "map_bounded"]
