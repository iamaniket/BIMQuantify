"""Per-user free-tier limits + trial-window enforcement.

Covers the new surface added alongside the pooled free tier:
  * `free_limits.resolve_free_limits` — override ?? env default + trial state.
  * The 90-day trial gate making an expired free account READ-ONLY (writes 403
    FREE_ACCOUNT_EXPIRED; reads still 200; deletes still allowed).
  * Per-user cap overrides letting a single account exceed the global cap.
  * `PATCH /admin/users/free/{id}/limits` (super-admin only) set / clear / exempt.
  * `GET /pooled/account/limits` — the caller's own caps + days-left for the banner.

Free users are created directly via the master session (the shortcut the other
free/admin tests use), so we can stamp `created_at` to simulate an aged trial.
"""

from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest
from fastapi_users.password import PasswordHelper
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from bimdossier_api.config import get_settings
from bimdossier_api.free_limits import resolve_free_limits
from bimdossier_api.models.free_user_limits import FreeUserLimits
from bimdossier_api.models.organization import Organization, OrganizationStatus
from bimdossier_api.models.organization_member import (
    OrganizationMember,
    OrganizationMemberStatus,
)
from bimdossier_api.models.pooled_project_member import PooledProjectMember
from bimdossier_api.models.user import User
from bimdossier_api.tenancy import schema_name_for
from tests.conftest import FakeStorage
from tests.test_pooled_viewer import _create_document

PASSWORD = "correct-horse-battery"


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _make_user(
    session: AsyncSession,
    email: str,
    *,
    is_superuser: bool = False,
    created_at: datetime | None = None,
) -> User:
    user = User(
        email=email,
        hashed_password=PasswordHelper().hash(PASSWORD),
        full_name=email.split("@")[0],
        is_active=True,
        is_verified=True,
        is_superuser=is_superuser,
    )
    if created_at is not None:
        user.created_at = created_at
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user


async def _login(client: AsyncClient, email: str) -> str:
    resp = await client.post(
        "/auth/jwt/login", data={"username": email, "password": PASSWORD}
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["access_token"]


async def _add_org(session: AsyncSession, user: User) -> None:
    org_id = uuid4()
    session.add(
        Organization(
            id=org_id,
            name=f"Org-{org_id.hex[:8]}",
            schema_name=schema_name_for(org_id),
            status=OrganizationStatus.active,
            provisioned_at=datetime.now(UTC),
        )
    )
    await session.flush()
    session.add(
        OrganizationMember(
            user_id=user.id,
            organization_id=org_id,
            status=OrganizationMemberStatus.active,
            accepted_at=datetime.now(UTC),
        )
    )
    await session.commit()


async def _create_project(client: AsyncClient, token: str, name: str = "House") -> object:
    return await client.post("/pooled/projects", json={"name": name}, headers=_auth(token))


async def _create_finding(
    client: AsyncClient, token: str, document_id: str, *, title: str = "Snag", severity: str = "low"
) -> object:
    return await client.post(
        f"/pooled/documents/{document_id}/findings",
        json={"title": title, "severity": severity},
        headers=_auth(token),
    )


# ---------------------------------------------------------------------------
# resolve_free_limits — the unit under everything
# ---------------------------------------------------------------------------


async def test_resolver_defaults_and_override(
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    async with session_maker() as session:
        user = await _make_user(session, "resolver@example.com")
        # No override row → pure env defaults, fresh account is not expired.
        limits = await resolve_free_limits(user, session)
        s = get_settings()
        assert limits.max_projects == s.free_max_projects_per_user
        assert limits.storage_max_bytes == s.free_storage_max_bytes
        assert limits.is_expired is False
        assert limits.account_expires_at is not None
        assert limits.override_max_projects is None

        # Override row wins.
        session.add(
            FreeUserLimits(user_id=user.id, max_projects=42, expiry_exempt=False)
        )
        await session.commit()
        limits = await resolve_free_limits(user, session)
        assert limits.max_projects == 42
        assert limits.override_max_projects == 42
        # Untouched knobs still fall back to the default.
        assert limits.max_documents == s.free_max_documents_per_user


async def test_resolver_expiry_and_exempt(
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    async with session_maker() as session:
        s = get_settings()
        aged = datetime.now(UTC) - timedelta(days=s.free_account_max_age_days + 30)
        user = await _make_user(session, "aged@example.com", created_at=aged)

        limits = await resolve_free_limits(user, session)
        assert limits.is_expired is True
        assert limits.days_remaining == 0

        # Exempt → never expires regardless of age.
        session.add(FreeUserLimits(user_id=user.id, expiry_exempt=True))
        await session.commit()
        limits = await resolve_free_limits(user, session)
        assert limits.is_expired is False
        assert limits.account_expires_at is None
        assert limits.days_remaining is None


# ---------------------------------------------------------------------------
# Trial gate — expired free account is read-only
# ---------------------------------------------------------------------------


async def test_expired_account_is_read_only(
    free_tier_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    client, _ = free_tier_storage_client
    async with session_maker() as session:
        # First, while still inside the trial, the user creates a project.
        user = await _make_user(session, "trial@example.com")
    token = await _login(client, "trial@example.com")
    created = await _create_project(client, token, "Before")
    assert created.status_code == 201, created.text
    pid = created.json()["id"]

    # Now age the account past the trial window.
    async with session_maker() as session:
        u = await session.get(User, user.id)
        assert u is not None
        u.created_at = datetime.now(UTC) - timedelta(days=400)
        await session.commit()

    # Reads still work (read-only, not locked out).
    listed = await client.get("/pooled/projects", headers=_auth(token))
    assert listed.status_code == 200
    detail = await client.get(f"/pooled/projects/{pid}", headers=_auth(token))
    assert detail.status_code == 200

    # Writes are blocked with the dedicated code.
    blocked = await _create_project(client, token, "After")
    assert blocked.status_code == 403
    assert blocked.json()["detail"] == "FREE_ACCOUNT_EXPIRED"

    rename = await client.patch(
        f"/pooled/projects/{pid}", json={"name": "Renamed"}, headers=_auth(token)
    )
    assert rename.status_code == 403
    assert rename.json()["detail"] == "FREE_ACCOUNT_EXPIRED"

    # Deletes are still allowed (cleanup is never blocked).
    removed = await client.delete(f"/pooled/projects/{pid}", headers=_auth(token))
    assert removed.status_code == 204


# ---------------------------------------------------------------------------
# Per-user overrides via the admin endpoint
# ---------------------------------------------------------------------------


async def test_admin_override_raises_project_cap(
    free_tier_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client, _ = free_tier_storage_client
    async with session_maker() as session:
        user = await _make_user(session, "cap@example.com")
        await _make_user(session, "root-cap@example.com", is_superuser=True)
    token = await _login(client, "cap@example.com")
    admin_token = await _login(client, "root-cap@example.com")

    monkeypatch.setenv("FREE_MAX_PROJECTS_PER_USER", "1")
    get_settings.cache_clear()
    try:
        first = await _create_project(client, token, "p1")
        assert first.status_code == 201
        # Global cap is 1 → second is blocked.
        blocked = await _create_project(client, token, "p2")
        assert blocked.status_code == 403
        assert blocked.json()["detail"] == "FREE_PROJECT_CAP_REACHED"

        # Admin lifts THIS user's cap to 5.
        patched = await client.patch(
            f"/admin/users/free/{user.id}/limits",
            json={"max_projects": 5, "expiry_exempt": False},
            headers=_auth(admin_token),
        )
        assert patched.status_code == 200, patched.text
        body = patched.json()
        assert body["limits"]["max_projects"] == 5
        assert body["limits"]["override_max_projects"] == 5
        assert body["usage"]["project_cap"] == 5

        # Now the second project succeeds.
        ok = await _create_project(client, token, "p2")
        assert ok.status_code == 201, ok.text

        # Clearing the override (null) reverts to the global default (1).
        cleared = await client.patch(
            f"/admin/users/free/{user.id}/limits",
            json={"max_projects": None, "expiry_exempt": False},
            headers=_auth(admin_token),
        )
        assert cleared.status_code == 200
        assert cleared.json()["limits"]["override_max_projects"] is None
        assert cleared.json()["limits"]["max_projects"] == 1
    finally:
        monkeypatch.delenv("FREE_MAX_PROJECTS_PER_USER", raising=False)
        get_settings.cache_clear()


async def test_admin_extend_trial_unblocks_writes(
    free_tier_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    client, _ = free_tier_storage_client
    async with session_maker() as session:
        aged = datetime.now(UTC) - timedelta(days=200)
        user = await _make_user(session, "extend@example.com", created_at=aged)
        await _make_user(session, "root-ext@example.com", is_superuser=True)
    token = await _login(client, "extend@example.com")
    admin_token = await _login(client, "root-ext@example.com")

    # Aged account: blocked.
    blocked = await _create_project(client, token, "x")
    assert blocked.status_code == 403
    assert blocked.json()["detail"] == "FREE_ACCOUNT_EXPIRED"

    # Admin grants a 365-day window → 200d-old account is back inside it.
    patched = await client.patch(
        f"/admin/users/free/{user.id}/limits",
        json={"account_max_age_days": 365, "expiry_exempt": False},
        headers=_auth(admin_token),
    )
    assert patched.status_code == 200, patched.text
    assert patched.json()["limits"]["expired"] is False

    ok = await _create_project(client, token, "y")
    assert ok.status_code == 201, ok.text

    # Exemption also works (permanent free account).
    exempt = await client.patch(
        f"/admin/users/free/{user.id}/limits",
        json={"expiry_exempt": True},
        headers=_auth(admin_token),
    )
    assert exempt.status_code == 200
    assert exempt.json()["limits"]["expiry_exempt"] is True
    assert exempt.json()["limits"]["account_expires_at"] is None


# ---------------------------------------------------------------------------
# PATCH authz + validation
# ---------------------------------------------------------------------------


async def test_patch_limits_requires_superuser(
    free_tier_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    client, _ = free_tier_storage_client
    async with session_maker() as session:
        user = await _make_user(session, "noadmin@example.com")
    token = await _login(client, "noadmin@example.com")
    resp = await client.patch(
        f"/admin/users/free/{user.id}/limits",
        json={"max_projects": 9, "expiry_exempt": False},
        headers=_auth(token),
    )
    assert resp.status_code == 403


async def test_patch_limits_validation_and_org_guard(
    free_tier_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    client, _ = free_tier_storage_client
    async with session_maker() as session:
        target = await _make_user(session, "valid@example.com")
        paid = await _make_user(session, "paid-lim@example.com")
        await _add_org(session, paid)
        await _make_user(session, "root-val@example.com", is_superuser=True)
    admin_token = await _login(client, "root-val@example.com")

    # Non-positive override → 422.
    bad = await client.patch(
        f"/admin/users/free/{target.id}/limits",
        json={"max_projects": 0, "expiry_exempt": False},
        headers=_auth(admin_token),
    )
    assert bad.status_code == 422

    # A paid (org-bearing) account isn't a free user → 404.
    not_free = await client.patch(
        f"/admin/users/free/{paid.id}/limits",
        json={"max_projects": 5, "expiry_exempt": False},
        headers=_auth(admin_token),
    )
    assert not_free.status_code == 404


# ---------------------------------------------------------------------------
# Findings cap (POOL-FIND-CAP-2) — the only pooled write with no storage bytes,
# bounded by its own per-owner count cap + a write rate limiter.
# ---------------------------------------------------------------------------


async def test_pooled_finding_cap_respected(
    free_tier_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client, _ = free_tier_storage_client
    async with session_maker() as session:
        await _make_user(session, "findcap@example.com")
    token = await _login(client, "findcap@example.com")
    pid = (await _create_project(client, token, "Findings")).json()["id"]  # type: ignore[attr-defined]
    did = await _create_document(client, token, pid)

    monkeypatch.setenv("FREE_MAX_FINDINGS_PER_USER", "2")
    get_settings.cache_clear()
    try:
        for i in range(2):
            r = await _create_finding(client, token, did, title=f"f{i}")
            assert r.status_code == 201, r.text  # type: ignore[attr-defined]
        blocked = await _create_finding(client, token, did, title="overflow")
        assert blocked.status_code == 403  # type: ignore[attr-defined]
        assert blocked.json()["detail"] == "FREE_FINDING_CAP_REACHED"  # type: ignore[attr-defined]
    finally:
        monkeypatch.delenv("FREE_MAX_FINDINGS_PER_USER", raising=False)
        get_settings.cache_clear()


async def test_pooled_finding_cap_counts_owner_wide_for_a_member(
    free_tier_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A member filing a snag counts against the project OWNER's cap, including the
    owner's findings in projects the member can't see — the count runs on a SUPERUSER
    probe (owner-wide), not the member's RLS-scoped view (the undercount regression)."""
    client, _ = free_tier_storage_client
    async with session_maker() as session:
        await _make_user(session, "owner-wide@example.com")
        member = await _make_user(session, "member-wide@example.com")
    owner_token = await _login(client, "owner-wide@example.com")
    member_token = await _login(client, "member-wide@example.com")

    pid_a = (await _create_project(client, owner_token, "A")).json()["id"]  # type: ignore[attr-defined]
    pid_b = (await _create_project(client, owner_token, "B")).json()["id"]  # type: ignore[attr-defined]
    did_a = await _create_document(client, owner_token, pid_a)
    did_b = await _create_document(client, owner_token, pid_b)

    monkeypatch.setenv("FREE_MAX_FINDINGS_PER_USER", "2")
    get_settings.cache_clear()
    try:
        # Owner fills the cap entirely in project A (member is NOT in A).
        for i in range(2):
            r = await _create_finding(client, owner_token, did_a, title=f"a{i}")
            assert r.status_code == 201, r.text  # type: ignore[attr-defined]

        # Add the member to project B as an editor (may file snags).
        async with session_maker() as session:
            session.add(
                PooledProjectMember(
                    pooled_project_id=UUID(pid_b), user_id=member.id, role="editor"
                )
            )
            await session.commit()

        # The member's create in B is blocked: the owner is already at cap, even
        # though the member's RLS scope can't see project A's snags.
        blocked = await _create_finding(client, member_token, did_b, title="by-member")
        assert blocked.status_code == 403, blocked.text  # type: ignore[attr-defined]
        assert blocked.json()["detail"] == "FREE_FINDING_CAP_REACHED"  # type: ignore[attr-defined]
    finally:
        monkeypatch.delenv("FREE_MAX_FINDINGS_PER_USER", raising=False)
        get_settings.cache_clear()


# ---------------------------------------------------------------------------
# Self endpoint for the trial banner
# ---------------------------------------------------------------------------


async def test_account_limits_self_endpoint(
    free_tier_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    client, _ = free_tier_storage_client
    async with session_maker() as session:
        await _make_user(session, "self@example.com")
    token = await _login(client, "self@example.com")

    resp = await client.get("/pooled/account/limits", headers=_auth(token))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    s = get_settings()
    assert body["max_projects"] == s.free_max_projects_per_user
    assert body["expired"] is False
    # Fresh account: roughly the full window remains.
    assert body["days_remaining"] is not None
    assert s.free_account_max_age_days - 1 <= body["days_remaining"] <= s.free_account_max_age_days
