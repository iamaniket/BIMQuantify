"""Phase A — the ``get_scoped_session`` bridge-model resolver.

Proves the SINGLE server-side tenancy branch that the whole free/paid
unification is built on: an org-less (free) JWT opens the pooled free session
(public schema, owner-keyed ``app.current_user_id`` GUC, no org GUC); an org JWT
opens the tenant schema session (``search_path = org_<hex>``, both GUCs); and the
paid branch keeps the exact membership/suspension gating of
``require_active_organization``.

The resolver ONLY selects between the two existing context managers
(``open_free_session`` / ``open_tenant_session``) — it never merges the sessions
or the RLS boundary. The cross-surface isolation INVARIANT (free token can never
reach a tenant schema, org token can never read pooled ``free_*`` rows) lives in
``test_scope_isolation.py``.
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import TYPE_CHECKING
from uuid import UUID, uuid4

import pytest
from sqlalchemy import text, update

from bimdossier_api.models.organization import Organization, OrganizationStatus
from bimdossier_api.models.user import User
from bimdossier_api.tenancy import (
    ScopeContext,
    get_scope_context,
    get_scoped_session,
    schema_name_for,
)
from tests.conftest import make_test_user

if TYPE_CHECKING:
    from httpx import AsyncClient
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker


def _request() -> SimpleNamespace:
    """Minimal stand-in for a Starlette Request — the resolver only touches
    ``request.state`` (to stash the verified schema on the paid branch)."""
    return SimpleNamespace(state=SimpleNamespace())


async def test_free_branch_opens_pooled_public_session(
    client: AsyncClient, session_maker: async_sessionmaker[AsyncSession]
) -> None:
    """Org-less user → free pooled session: public schema, bim_app role, only the
    owner GUC set."""
    uid = await make_test_user(session_maker, email="scope-free@example.com", is_verified=True)
    async with session_maker() as ms:
        user = await ms.get(User, UUID(uid))
        agen = get_scoped_session(request=_request(), user=user, org_id=None, master_session=ms)
        session = await agen.__anext__()
        try:
            cur_user = await session.scalar(
                text("SELECT current_setting('app.current_user_id', true)")
            )
            cur_org = await session.scalar(
                text("SELECT current_setting('app.current_org_id', true)")
            )
            schema = await session.scalar(text("SELECT current_schema()"))
            role = await session.scalar(text("SELECT current_user"))
        finally:
            await agen.aclose()

    assert cur_user == uid
    assert cur_org in (None, "")  # org GUC is never set on the free branch
    assert schema == "public"
    assert role == "bim_app"


async def test_paid_branch_opens_tenant_schema_session(
    client: AsyncClient,
    session_maker: async_sessionmaker[AsyncSession],
    org_user: dict[str, str],
) -> None:
    """Org claim → tenant schema session: search_path on the org schema, both
    GUCs set, and the verified schema stashed on request.state."""
    org_id = UUID(org_user["organization_id"])
    req = _request()
    async with session_maker() as ms:
        user = await ms.get(User, UUID(org_user["id"]))
        agen = get_scoped_session(request=req, user=user, org_id=org_id, master_session=ms)
        session = await agen.__anext__()
        try:
            cur_user = await session.scalar(
                text("SELECT current_setting('app.current_user_id', true)")
            )
            cur_org = await session.scalar(
                text("SELECT current_setting('app.current_org_id', true)")
            )
            schema = await session.scalar(text("SELECT current_schema()"))
        finally:
            await agen.aclose()

    assert cur_user == org_user["id"]
    assert cur_org == org_user["organization_id"]
    assert schema == schema_name_for(org_id)
    assert req.state.active_schema == schema_name_for(org_id)


async def test_paid_branch_rejects_non_member(
    client: AsyncClient,
    session_maker: async_sessionmaker[AsyncSession],
    org_user: dict[str, str],
) -> None:
    """An org claim the caller does not belong to → 403, exactly like
    ``require_active_organization``."""
    from fastapi import HTTPException

    stranger_org = uuid4()
    async with session_maker() as ms:
        user = await ms.get(User, UUID(org_user["id"]))
        agen = get_scoped_session(
            request=_request(), user=user, org_id=stranger_org, master_session=ms
        )
        with pytest.raises(HTTPException) as exc:
            await agen.__anext__()

    assert exc.value.status_code == 403
    assert exc.value.detail == "ORG_MEMBERSHIP_REQUIRED"


async def test_paid_branch_rejects_suspended_org(
    client: AsyncClient,
    session_maker: async_sessionmaker[AsyncSession],
    org_user: dict[str, str],
) -> None:
    """A suspended org blocks tenant access with ORG_SUSPENDED (membership ok)."""
    from fastapi import HTTPException

    org_id = UUID(org_user["organization_id"])
    async with session_maker() as ms:
        await ms.execute(
            update(Organization)
            .where(Organization.id == org_id)
            .values(status=OrganizationStatus.suspended)
        )
        await ms.commit()
        user = await ms.get(User, UUID(org_user["id"]))
        agen = get_scoped_session(request=_request(), user=user, org_id=org_id, master_session=ms)
        with pytest.raises(HTTPException) as exc:
            await agen.__anext__()

    assert exc.value.status_code == 403
    assert exc.value.detail == "ORG_SUSPENDED"


async def test_scope_context_tier_signal() -> None:
    """ScopeContext.is_free is the tier-blind signal handlers branch cross-cutting
    concerns (audit/notify/permissions) on — org_id None ⇒ free."""
    free = ScopeContext(user=SimpleNamespace(id=uuid4()), org_id=None)  # type: ignore[arg-type]
    paid = ScopeContext(user=SimpleNamespace(id=uuid4()), org_id=uuid4())  # type: ignore[arg-type]
    assert free.is_free is True
    assert paid.is_free is False


async def test_get_scope_context_reads_org_claim() -> None:
    """get_scope_context just packages the verified user + (optional) org id from
    the JWT claim; it does NOT verify membership (the data path does that)."""
    user = SimpleNamespace(id=uuid4())
    org = uuid4()
    free_ctx = await get_scope_context(user=user, org_id=None)  # type: ignore[arg-type]
    paid_ctx = await get_scope_context(user=user, org_id=org)  # type: ignore[arg-type]
    assert free_ctx.is_free is True and free_ctx.org_id is None
    assert paid_ctx.is_free is False and paid_ctx.org_id == org
