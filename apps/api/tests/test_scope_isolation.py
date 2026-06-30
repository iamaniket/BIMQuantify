"""Phase B — the cross-surface isolation INVARIANT (the refactor's safety net).

This is the regression guard that makes the free/paid unification safe: no matter
how the routes/handlers are later collapsed onto ``get_scoped_session``, these two
boundaries must hold —

  1. An org-less (free) JWT can NEVER open a tenant schema session — it only ever
     gets the pooled ``public`` session.
  2. An org JWT can NEVER read another user's pooled ``free_*`` rows — the pooled
     owner-OR-member RLS still filters, even from a tenant session that reaches
     ``public.free_*`` via the search_path fallback.

Asserted at BOTH layers: the resolver (search_path never lands on ``org_*`` for a
free token) and the DB layer as the non-superuser ``bim_app`` role (cross-surface
reads return zero rows). Complements ``test_free_paid_parity.py`` (value-set
lockstep) and ``test_scoped_session.py`` (resolver branch behaviour).
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import func, select, text

from bimdossier_api.models.free_finding import FreeFinding
from bimdossier_api.models.free_project import FreeProject
from bimdossier_api.models.user import User
from bimdossier_api.tenancy import (
    get_scoped_session,
    open_free_session,
    open_tenant_session,
    schema_name_for,
)
from tests.conftest import make_test_user
from tests.test_free_viewer import _create_document, _create_project, _free_token

if TYPE_CHECKING:
    from httpx import AsyncClient
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

    from tests.conftest import FakeStorage


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _user_id(session_maker: async_sessionmaker[AsyncSession], email: str) -> UUID:
    async with session_maker() as s:
        uid = await s.scalar(select(User.id).where(User.email == email))
    assert uid is not None
    return uid


# ---------------------------------------------------------------------------
# Layer 1 — resolver: a free token never lands on a tenant schema.
# ---------------------------------------------------------------------------


async def test_org_less_token_never_resolves_a_tenant_schema(
    client: AsyncClient, session_maker: async_sessionmaker[AsyncSession]
) -> None:
    uid = await make_test_user(session_maker, email="iso-free@example.com", is_verified=True)
    async with session_maker() as ms:
        user = await ms.get(User, UUID(uid))
        agen = get_scoped_session(
            request=SimpleNamespace(state=SimpleNamespace()),
            user=user,
            org_id=None,
            master_session=ms,
        )
        session = await agen.__anext__()
        try:
            search_path = await session.scalar(text("SHOW search_path"))
        finally:
            await agen.aclose()
    # The pooled free session is public-only — never any org_<hex> schema.
    assert "org_" not in (search_path or "")


# ---------------------------------------------------------------------------
# Layer 2 — DB as bim_app: cross-surface reads return zero rows.
# ---------------------------------------------------------------------------


async def test_free_session_cannot_read_other_free_users_pooled_rows(
    free_tier_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """Owner B's pooled free project/finding are invisible to a different free
    user C's bim_app session (the pooled owner-OR-member boundary)."""
    fclient, _ = free_tier_storage_client
    token_b = await _free_token(fclient, session_maker, "iso-b@example.com")
    await _free_token(fclient, session_maker, "iso-c@example.com")
    c_id = await _user_id(session_maker, "iso-c@example.com")

    pid_b = await _create_project(fclient, token_b)
    did_b = await _create_document(fclient, token_b, pid_b)
    snag = await fclient.post(
        f"/free/documents/{did_b}/findings",
        json={"title": "B-secret", "severity": "high"},
        headers=_auth(token_b),
    )
    assert snag.status_code == 201, snag.text

    # C's pooled session sees none of B's rows — RLS keys on app.current_user_id=C.
    async with open_free_session(c_id) as s:
        n_proj = await s.scalar(select(func.count()).select_from(FreeProject))
        n_find = await s.scalar(select(func.count()).select_from(FreeFinding))
    assert n_proj == 0
    assert n_find == 0


async def test_org_token_cannot_read_pooled_free_rows(
    free_tier_storage_client: tuple[AsyncClient, FakeStorage],
    client: AsyncClient,
    session_maker: async_sessionmaker[AsyncSession],
    org_user: dict[str, str],
) -> None:
    """An org (tenant) session reaches ``public.free_*`` via the search_path
    fallback, but the pooled RLS still filters it to zero — a paid user can never
    read another user's free data even if a handler erroneously queried it."""
    fclient, _ = free_tier_storage_client
    token_b = await _free_token(fclient, session_maker, "iso-paid-b@example.com")
    pid_b = await _create_project(fclient, token_b)
    did_b = await _create_document(fclient, token_b, pid_b)
    snag = await fclient.post(
        f"/free/documents/{did_b}/findings",
        json={"title": "B-secret", "severity": "high"},
        headers=_auth(token_b),
    )
    assert snag.status_code == 201, snag.text

    org_id = UUID(org_user["organization_id"])
    a_id = UUID(org_user["id"])
    schema = schema_name_for(org_id)
    # Tenant session for org user A: free_* resolves to public via fallback, but
    # RLS (keyed on app.current_user_id=A) yields zero of B's rows.
    async with open_tenant_session(schema, org_id, a_id) as s:
        n_proj = await s.scalar(select(func.count()).select_from(FreeProject))
        n_find = await s.scalar(select(func.count()).select_from(FreeFinding))
    assert n_proj == 0
    assert n_find == 0


# ---------------------------------------------------------------------------
# RLS coverage lint — every pooled free table is ENABLE + FORCE + policied.
# ---------------------------------------------------------------------------

# Control-plane free tables that intentionally carry NO RLS (no bim_app grant;
# read only on a superuser session). A new pooled DATA table must NOT land here.
_FREE_RLS_EXCEPTIONS = {"free_user_limits"}


async def test_every_pooled_free_table_has_rls_forced_and_policied(
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """Default-deny only kicks in once RLS is ENABLED + FORCED + has a policy. A
    new ``free_*`` data table added without it would have zero isolation — this
    fails CI before that ships (research §5 #3)."""
    async with session_maker() as s:
        rows = (
            await s.execute(
                text(
                    "SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity, "
                    "  (SELECT count(*) FROM pg_policies p "
                    "   WHERE p.schemaname = 'public' AND p.tablename = c.relname) AS npol "
                    "FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
                    "WHERE n.nspname = 'public' AND c.relkind = 'r' "
                    "  AND c.relname LIKE 'free\\_%' ESCAPE '\\' "
                    "ORDER BY c.relname"
                )
            )
        ).all()

    found = {r[0] for r in rows}
    # Sanity: the core pooled tables actually exist in the test schema.
    assert {
        "free_projects",
        "free_findings",
        "free_documents",
        "free_project_files",
    } <= found, f"core free tables missing from schema: {found}"

    offenders = [
        (relname, bool(rls), bool(force), npol)
        for relname, rls, force, npol in rows
        if relname not in _FREE_RLS_EXCEPTIONS and not (rls and force and npol > 0)
    ]
    assert not offenders, (
        "pooled free tables missing RLS ENABLE/FORCE/policy "
        f"(add RLS or document the exception): {offenders}"
    )
