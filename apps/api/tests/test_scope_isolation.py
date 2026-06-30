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

import inspect
from types import SimpleNamespace
from typing import TYPE_CHECKING
from uuid import UUID, uuid4

import pytest
from sqlalchemy import func, select, text
from sqlalchemy.exc import ProgrammingError

from bimdossier_api.models.free_finding import FreeFinding
from bimdossier_api.models.free_project import FreeProject
from bimdossier_api.models.free_project_file import FreeProjectFile
from bimdossier_api.models.user import User
from bimdossier_api.routers.free_access import (
    free_owner_used_bytes,
    user_has_org_membership,
)
from bimdossier_api.routers.free_documents import FreeFindingCreate
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


# ---------------------------------------------------------------------------
# H4 — superuser free probes are owner-scoped (RLS is OFF on these, so the
# hand-written owner predicate is the ONLY thing scoping the read).
# ---------------------------------------------------------------------------


async def test_free_owner_used_bytes_probe_is_owner_scoped(
    free_tier_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """`free_owner_used_bytes` runs on a SUPERUSER session (RLS bypassed) and must
    attribute storage only to its `owner_user_id` argument — drop that predicate
    and it would sum every user's bytes. Regression guard for the hard rule in
    `free_access.py`."""
    fclient, _ = free_tier_storage_client
    token_a = await _free_token(fclient, session_maker, "h4-a@example.com")
    a_id = await _user_id(session_maker, "h4-a@example.com")
    # A second free owner who owns none of A's data.
    await _free_token(fclient, session_maker, "h4-b@example.com")
    b_id = await _user_id(session_maker, "h4-b@example.com")

    pid = await _create_project(fclient, token_a)
    did = await _create_document(fclient, token_a, pid)
    # Attribute some storage to A directly (the upload flow is exercised elsewhere;
    # here we only need owner-keyed bytes for the probe).
    async with session_maker() as s, s.begin():
        s.add(
            FreeProjectFile(
                owner_user_id=a_id,
                free_document_id=UUID(did),
                version_number=1,
                storage_key=f"free/{a_id}/{did}/{uuid4()}/source.ifc",
                original_filename="m.ifc",
                size_bytes=1234,
            )
        )

    async with session_maker() as s:
        assert await free_owner_used_bytes(s, a_id) == 1234
        # B owns nothing — if the owner predicate were dropped this would leak A's
        # 1234 bytes into B's usage total.
        assert await free_owner_used_bytes(s, b_id) == 0

    # The org-membership probe is user-keyed too; both are org-less free accounts.
    assert (await user_has_org_membership(a_id)) is False
    assert (await user_has_org_membership(b_id)) is False


# ---------------------------------------------------------------------------
# H5 — the free-finding quota/isolation key (owner_user_id) is server-derived,
# never client-supplied (defense-in-depth over the owner-OR-member WITH CHECK).
# ---------------------------------------------------------------------------


async def test_free_finding_owner_is_server_derived_not_client_supplied(
    free_tier_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """The create contract exposes no owner/author field, and the router pins
    `owner_user_id` to the project owner (the RLS + quota key) — so a member filing
    a snag can never mis-key its quota attribution to themselves."""
    assert "owner_user_id" not in FreeFindingCreate.model_fields
    assert "created_by_user_id" not in FreeFindingCreate.model_fields

    fclient, _ = free_tier_storage_client
    token_a = await _free_token(fclient, session_maker, "h5-a@example.com")
    a_id = await _user_id(session_maker, "h5-a@example.com")
    pid = await _create_project(fclient, token_a)
    did = await _create_document(fclient, token_a, pid)
    resp = await fclient.post(
        f"/free/documents/{did}/findings",
        json={"title": "x", "severity": "high"},
        headers=_auth(token_a),
    )
    assert resp.status_code == 201, resp.text
    async with open_free_session(a_id) as s:
        owner = await s.scalar(
            select(FreeFinding.owner_user_id).where(
                FreeFinding.id == UUID(resp.json()["id"])
            )
        )
    assert owner == a_id


# ---------------------------------------------------------------------------
# H6 — the control-plane `free_user_limits` table is unreadable by bim_app. Its
# isolation is an explicit REVOKE, not the mere absence of a GRANT.
# ---------------------------------------------------------------------------


async def test_bim_app_session_cannot_read_free_user_limits(
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """A pooled free (bim_app) session must be permission-denied on
    `free_user_limits` — the table carries no RLS, so a stray bim_app grant would
    expose every user's override row. Mirrors the production grant set (conftest
    REVOKEs it after the blanket test grant; migration 0002 REVOKEs it too)."""
    uid = await make_test_user(session_maker, email="h6@example.com", is_verified=True)
    with pytest.raises(ProgrammingError):
        async with open_free_session(UUID(uid)) as s:
            await s.execute(text("SELECT count(*) FROM public.free_user_limits"))


# ---------------------------------------------------------------------------
# H7 — static guards for the two load-bearing session/RLS invariants.
# ---------------------------------------------------------------------------


def test_security_definer_helpers_pin_search_path() -> None:
    """An unpinned SECURITY DEFINER function is a real cross-tenant bypass (a caller
    could point search_path at a malicious schema). Every SECURITY DEFINER helper in
    `_rls_sql.py` MUST pin `search_path`."""
    import bimdossier_api._rls_sql as rls

    # The generated SQL is the real guard — the only place definer functions are made.
    for stmt in rls.free_member_function_statements():
        if "SECURITY DEFINER" in stmt:
            assert "SET search_path = public, pg_temp" in stmt, stmt
    # Source backstop: every SQL `SECURITY DEFINER` line (keyword on its own line,
    # not a prose mention) must be followed within a few lines by the pinned
    # search_path — catches a NEW unpinned helper added in any generator here.
    lines = inspect.getsource(rls).splitlines()
    for i, line in enumerate(lines):
        if line.strip() == "SECURITY DEFINER":
            window = "\n".join(lines[i : i + 4])
            assert "SET search_path = public, pg_temp" in window, f"unpinned near line {i + 1}"


def test_tenancy_session_layer_never_commits_explicitly() -> None:
    """`open_free_session` / `open_tenant_session` commit via the wrapping
    `session.begin()`; an explicit `session.commit()` inside the tenancy layer would
    drop the SET LOCAL ROLE + search_path + GUCs and leak tenant context to the next
    pooled request (the classic SET-vs-SET-LOCAL pooling footgun)."""
    import ast

    import bimdossier_api.tenancy as tenancy_mod

    tree = ast.parse(inspect.getsource(tenancy_mod))
    # Actual `<x>.commit()` call expressions (AST ignores docstrings/comments, which
    # DO mention the forbidden call in prose).
    commits = [
        node.lineno
        for node in ast.walk(tree)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and node.func.attr == "commit"
    ]
    assert not commits, f"explicit .commit() call(s) in tenancy.py at lines {commits}"
    begins = [
        node
        for node in ast.walk(tree)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and node.func.attr == "begin"
    ]
    assert begins, "tenancy session builders must open a transaction via session.begin()"
