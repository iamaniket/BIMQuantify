"""Background task primitives shared by the lifespan-managed sweepers:
periodic sweeper base, cross-instance leader-election lock, and a
bounded-concurrency fan-out helper."""

from bimdossier_api.background.concurrency import map_bounded
from bimdossier_api.background.locks import advisory_lock
from bimdossier_api.background.periodic import PeriodicSweeper

__all__ = ["PeriodicSweeper", "advisory_lock", "map_bounded"]
