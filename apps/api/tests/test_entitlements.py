"""Unit tests for the plan/entitlement resolver (the TIER axis).

`resolve_plan` is the single server-side source of truth for tier, kept ORTHOGONAL
to the schema-per-tenant ISOLATION axis: org-less → free, an org → its stored plan.
"""

from __future__ import annotations

from types import SimpleNamespace

from bimdossier_api.entitlements import PLAN_FREE, PLAN_PAID, resolve_plan


def test_resolve_plan_orgless_is_free() -> None:
    assert resolve_plan(None) == PLAN_FREE == "free"


def test_resolve_plan_uses_the_orgs_stored_plan() -> None:
    assert resolve_plan(SimpleNamespace(plan="paid")) == "paid"  # type: ignore[arg-type]
    # The value set is open (String, not an enum) — a richer plan flows through.
    assert resolve_plan(SimpleNamespace(plan="enterprise")) == "enterprise"  # type: ignore[arg-type]


def test_resolve_plan_defaults_paid_for_org_with_blank_plan() -> None:
    assert resolve_plan(SimpleNamespace(plan="")) == PLAN_PAID == "paid"  # type: ignore[arg-type]
    assert resolve_plan(SimpleNamespace(plan=None)) == PLAN_PAID  # type: ignore[arg-type]
