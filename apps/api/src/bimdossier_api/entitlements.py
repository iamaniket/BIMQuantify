"""Plan / entitlements — the TIER axis, kept orthogonal to tenant ISOLATION.

ISOLATION (which data plane a request resolves to: pooled ``public.free_*`` vs a
schema-per-tenant ``org_<hex>``) is decided ONLY by ``get_scoped_session`` from the
verified JWT ``org`` claim, and the client must never choose it. PLAN / ENTITLEMENT
(free vs paid tiers, feature gates) is a separate authorization concern: derived
from a trusted server-side source, surfaced to the client READ-ONLY (via
``/auth/me``) and re-checked server-side on every gated action. The two were
historically conflated (``free`` == org-less); this module makes the entitlement
explicit so a paid org can carry a richer plan and the two axes can diverge
without touching the isolation seam.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from bimdossier_api.models.organization import Organization

# Pooled free tier — an org-LESS account. Resolved by the ABSENCE of an org,
# never stored on a row (there is no free Organization).
PLAN_FREE = "free"
# Default plan for any organization (every org is a paid tenant) without an
# explicit plan set.
PLAN_PAID = "paid"


def resolve_plan(active_org: Organization | None) -> str:
    """The acting principal's PLAN (entitlement), decoupled from isolation.

    Org-less (a pooled free account) → ``"free"``. An org member → the org's
    stored plan (``Organization.plan``, defaulting to ``"paid"``). This is the
    single server-side source of truth for tier; the client must never infer it
    from org-presence.
    """
    if active_org is None:
        return PLAN_FREE
    return active_org.plan or PLAN_PAID
