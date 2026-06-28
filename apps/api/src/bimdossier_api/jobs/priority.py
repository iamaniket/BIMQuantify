"""Per-user-type job priority for the single BullMQ ``jobs`` queue.

The processor runs one queue at a small concurrency, shared by every tenant. To
keep paying customers ahead of the free tier without splitting queues, each
dispatched job carries a BullMQ ``priority`` derived from the requester's tier.
BullMQ priority is ``0`` (highest) … ``2_097_152`` (lowest); lower = more urgent.

The tier is decided by the *dispatch path*, not by any field on the org: every
existing (tenant) dispatch is ``paying``; the future free-tier dispatch passes
``free``. Adding a paid sub-tier later is a new enum member + a config value, no
schema change — the configured paying/free values deliberately leave a gap.

See ``docs/free-wedge-implementation-plan.md`` (decision D5).
"""

from __future__ import annotations

from enum import StrEnum
from typing import TYPE_CHECKING
from uuid import UUID

if TYPE_CHECKING:
    from bimdossier_api.config import Settings


# Sentinel organization id for free-tier dispatches. `dispatch_job` requires a
# non-null org UUID and `_http_dispatch` stringifies it, so free jobs (which
# have no org) pass this all-zeros UUID. The free job carries `callback_path` so
# the worker calls back to the free callback, which IGNORES the org entirely —
# the standard tenant callback must never receive a free job (it would try to
# resolve a tenant schema for the sentinel and 404).
FREE_TIER_SENTINEL_ORG = UUID(int=0)

# Path the processor calls back to for free extractions. Threaded through the
# job payload (the processor reads `payload.callback_path`); distinct from the
# hardcoded tenant `/internal/jobs/callback`.
FREE_CALLBACK_PATH = "/internal/jobs/free-callback"


class JobTier(StrEnum):
    """Who a job is for, which sets its queue priority."""

    paying = "paying"
    free = "free"


def resolve_priority(tier: JobTier, settings: Settings) -> int:
    """Map a tier to its BullMQ priority. Unknown tiers fall back to paying."""
    if tier is JobTier.free:
        return settings.job_priority_free
    return settings.job_priority_paying
