"""Unit tests for the plan/entitlement resolver (the TIER axis).

`resolve_plan` is the single server-side source of truth for tier, kept ORTHOGONAL
to the schema-per-tenant ISOLATION axis: org-less → free, an org → its stored plan.
"""

from __future__ import annotations

from types import SimpleNamespace

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from bimdossier_api.entitlements import PLAN_FREE, PLAN_PAID, resolve_plan
from bimdossier_api.routers.free_access import resolve_user_plan
from tests.conftest import FakeStorage
from tests.test_free_limits import _add_org, _auth, _login, _make_user


def test_resolve_plan_orgless_is_free() -> None:
    assert resolve_plan(None) == PLAN_FREE == "free"


def test_resolve_plan_uses_the_orgs_stored_plan() -> None:
    assert resolve_plan(SimpleNamespace(plan="paid")) == "paid"  # type: ignore[arg-type]
    # The value set is open (String, not an enum) — a richer plan flows through.
    assert resolve_plan(SimpleNamespace(plan="enterprise")) == "enterprise"  # type: ignore[arg-type]


def test_resolve_plan_defaults_paid_for_org_with_blank_plan() -> None:
    assert resolve_plan(SimpleNamespace(plan="")) == PLAN_PAID == "paid"  # type: ignore[arg-type]
    assert resolve_plan(SimpleNamespace(plan=None)) == PLAN_PAID  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# resolve_user_plan — the server-side per-user tier source (M1 activation).
# Depends on `free_tier_storage_client` only to wire db._session_maker so the
# helper's internal SUPERUSER probe hits the test DB.
# ---------------------------------------------------------------------------


async def test_resolve_user_plan_orgless_is_free(
    free_tier_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    async with session_maker() as session:
        user = await _make_user(session, "ent-free@example.com")
    assert await resolve_user_plan(user) == PLAN_FREE


async def test_resolve_user_plan_org_member_is_paid(
    free_tier_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    async with session_maker() as session:
        user = await _make_user(session, "ent-paid@example.com")
        await _add_org(session, user)
    assert await resolve_user_plan(user) == PLAN_PAID


async def test_resolve_user_plan_superuser_is_paid(
    free_tier_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    # Org-less, but a platform operator → never resolved onto the free plane.
    async with session_maker() as session:
        root = await _make_user(session, "ent-root@example.com", is_superuser=True)
    assert await resolve_user_plan(root) == PLAN_PAID


async def test_superuser_cannot_create_pooled_content(
    free_tier_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """POOL-SUPERADMIN-TIER-1: an org-less super-admin is not a free principal —
    the free-content create gate blocks them (FREE_CREATE_FORBIDDEN)."""
    client, _ = free_tier_storage_client
    async with session_maker() as session:
        await _make_user(session, "root-pooled@example.com", is_superuser=True)
    token = await _login(client, "root-pooled@example.com")
    resp = await client.post("/pooled/projects", json={"name": "x"}, headers=_auth(token))
    assert resp.status_code == 403, resp.text
    assert resp.json()["detail"] == "FREE_CREATE_FORBIDDEN"
