"""Tests for free-tier collaboration (members) + the create-gate + Free workspace.

Covers, as the real `bim_app` free session (so the owner-OR-member RLS is the
boundary under test):
  * create-gate — only org-less users may create free projects/models; a paid
    user (any org membership) is refused, and a free user who LATER joins an org
    loses create but keeps managing existing projects.
  * member invite (any email, incl. paid), the 3-member cap, self/owner removal.
  * shared access — a member reads the project/models/findings; a viewer can't write,
    an editor can; only the owner manages members / mutates the project; a member
    can't upload models or read non-shared models.
  * Free-workspace auth context — has_free_workspace on /auth/me + switch-to-free
    minting a no-org token.
"""

from datetime import UTC, datetime
from uuid import UUID, uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from bimdossier_api.config import get_settings
from tests.conftest import FakeStorage, make_test_user
from tests.test_free_viewer import (
    _IFC_HEADER,
    _auth,
    _create_document,
    _initiate_file,
)

_PW = "correct-horse-battery"


async def _free_user(
    client: AsyncClient, session_maker: async_sessionmaker[AsyncSession], email: str
) -> tuple[str, str]:
    """Create + log in an org-less (free) user. Returns (access_token, user_id)."""
    uid = await make_test_user(session_maker, email=email, is_verified=True)
    login = await client.post(
        "/auth/jwt/login", data={"username": email, "password": _PW}
    )
    assert login.status_code == 200, login.text
    return login.json()["access_token"], uid


async def _grant_org_membership(
    session_maker: async_sessionmaker[AsyncSession], user_id: str
) -> None:
    """Attach an active OrganizationMember (no tenant schema needed — the
    create-gate only probes membership existence). Turns a free user 'paid'."""
    from bimdossier_api.models.organization import Organization, OrganizationStatus
    from bimdossier_api.models.organization_member import (
        OrganizationMember,
        OrganizationMemberStatus,
    )
    from bimdossier_api.tenancy import schema_name_for

    async with session_maker() as session:
        oid = uuid4()
        session.add(
            Organization(
                id=oid,
                name=f"Org-{oid.hex[:8]}",
                schema_name=schema_name_for(oid),
                status=OrganizationStatus.active,
                provisioned_at=datetime.now(UTC),
            )
        )
        await session.flush()
        session.add(
            OrganizationMember(
                user_id=UUID(user_id),
                organization_id=oid,
                is_org_admin=True,
                status=OrganizationMemberStatus.active,
                accepted_at=datetime.now(UTC),
            )
        )
        await session.commit()


async def _paid_token(
    client: AsyncClient, session_maker: async_sessionmaker[AsyncSession], email: str
) -> tuple[str, str]:
    """Create a user WITH an org membership, log in (token carries the org
    claim). Returns (access_token, user_id)."""
    _, uid = await _free_user(client, session_maker, email)
    await _grant_org_membership(session_maker, uid)
    login = await client.post(
        "/auth/jwt/login", data={"username": email, "password": _PW}
    )
    assert login.status_code == 200, login.text
    return login.json()["access_token"], uid


async def _create_project(client: AsyncClient, token: str, *, name: str = "House") -> str:
    resp = await client.post("/free/projects", json={"name": name}, headers=_auth(token))
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


# ---------------------------------------------------------------------------
# Create-gate
# ---------------------------------------------------------------------------


async def test_paid_user_cannot_create_free_content(
    free_tier_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    client, _ = free_tier_storage_client
    paid, _ = await _paid_token(client, session_maker, "cg-paid@example.com")

    proj = await client.post("/free/projects", json={"name": "x"}, headers=_auth(paid))
    assert proj.status_code == 403, proj.text
    assert proj.json()["detail"] == "FREE_CREATE_FORBIDDEN"

    # A genuinely org-less user still can.
    free, _ = await _free_user(client, session_maker, "cg-free@example.com")
    assert (
        await client.post("/free/projects", json={"name": "ok"}, headers=_auth(free))
    ).status_code == 201


async def test_free_user_who_joins_org_loses_create_keeps_manage(
    free_tier_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    client, _ = free_tier_storage_client
    token, uid = await _free_user(client, session_maker, "former-free@example.com")
    pid = await _create_project(client, token, name="Mine")

    # They join an org → now 'paid'. The access token is unchanged, but the
    # create-gate probes membership directly.
    await _grant_org_membership(session_maker, uid)

    assert (
        await client.post("/free/projects", json={"name": "new"}, headers=_auth(token))
    ).status_code == 403
    # …but they still manage their existing project.
    patched = await client.patch(
        f"/free/projects/{pid}", json={"name": "Renamed"}, headers=_auth(token)
    )
    assert patched.status_code == 200, patched.text
    assert patched.json()["name"] == "Renamed"


async def test_complete_blocked_after_joining_org(
    free_tier_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """The create-gate is re-applied at completion: a file initiated while
    org-less must not be completed (dispatched) after the user joins an org."""
    client, fake = free_tier_storage_client
    token, uid = await _free_user(client, session_maker, "complete-gate@example.com")
    pid = await _create_project(client, token)
    did = await _create_document(client, token, pid)
    init = await _initiate_file(client, token, pid, did)
    fake.objects[init["storage_key"]] = _IFC_HEADER

    # User joins an org between initiate and complete.
    await _grant_org_membership(session_maker, uid)

    resp = await client.post(
        f"/free/projects/{pid}/documents/{did}/files/{init['file_id']}/complete",
        headers=_auth(token),
    )
    assert resp.status_code == 403, resp.text
    assert resp.json()["detail"] == "FREE_CREATE_FORBIDDEN"


# ---------------------------------------------------------------------------
# Member invite + shared access + role gating
# ---------------------------------------------------------------------------


async def test_invite_member_shared_access_and_role_gating(
    free_tier_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    client, _ = free_tier_storage_client
    owner, owner_id = await _free_user(client, session_maker, "m-owner@example.com")
    bob, bob_id = await _free_user(client, session_maker, "m-bob@example.com")
    pid = await _create_project(client, owner, name="Shared")

    # Owner creates a container in the project (members can't, tested below).
    did = await _create_document(client, owner, pid, name="Arch")

    # Invite Bob as viewer.
    inv = await client.post(
        f"/free/projects/{pid}/members",
        json={"email": "m-bob@example.com", "role": "viewer"},
        headers=_auth(owner),
    )
    assert inv.status_code == 201, inv.text
    assert inv.json()["role"] == "viewer"
    assert inv.json()["user_id"] == bob_id

    # Bob sees it under his projects list, badged with his role + the real owner.
    listed = await client.get("/free/projects", headers=_auth(bob))
    assert listed.status_code == 200
    shared = [p for p in listed.json() if p["id"] == pid]
    assert len(shared) == 1
    assert shared[0]["my_role"] == "viewer"
    assert shared[0]["owner_id"] == owner_id  # it's shared, not his

    # Bob can read the project, its documents/findings/overview, and the container.
    for path in (
        f"/free/projects/{pid}",
        f"/free/projects/{pid}/documents",
        f"/free/projects/{pid}/findings",
        f"/free/projects/{pid}/overview",
        f"/free/projects/{pid}/documents/{did}",
        f"/free/documents/{did}/findings",
    ):
        assert (await client.get(path, headers=_auth(bob))).status_code == 200, path

    # Viewer Bob CANNOT write a snag, manage members, mutate or own the project,
    # or create a container in it.
    assert (
        await client.post(
            f"/free/documents/{did}/findings", json={"title": "no"}, headers=_auth(bob)
        )
    ).status_code == 403
    assert (
        await client.post(
            f"/free/projects/{pid}/members",
            json={"email": "x@example.com"},
            headers=_auth(bob),
        )
    ).status_code == 403
    # PATCH/DELETE project are owner-only → 404 (hidden) for a member.
    assert (
        await client.patch(
            f"/free/projects/{pid}", json={"name": "hax"}, headers=_auth(bob)
        )
    ).status_code == 404
    # Bob (org-less) passes the create-gate but can't create a container in a
    # project he doesn't own.
    assert (
        await client.post(
            f"/free/projects/{pid}/documents", json={"name": "z"}, headers=_auth(bob)
        )
    ).status_code == 404

    # Promote Bob to editor → he can now file a snag, attributed to him.
    up = await client.patch(
        f"/free/projects/{pid}/members/{bob_id}",
        json={"role": "editor"},
        headers=_auth(owner),
    )
    assert up.status_code == 200, up.text
    assert up.json()["role"] == "editor"

    snag = await client.post(
        f"/free/documents/{did}/findings", json={"title": "by bob"}, headers=_auth(bob)
    )
    assert snag.status_code == 201, snag.text
    board = await client.get(f"/free/projects/{pid}/findings", headers=_auth(owner))
    feed = {f["id"]: f for f in board.json()}
    assert feed[snag.json()["id"]]["created_by_user_id"] == bob_id

    # Members list (owner-synthesized + Bob).
    members = await client.get(f"/free/projects/{pid}/members", headers=_auth(owner))
    assert members.status_code == 200
    roles = {m["user_id"]: m["role"] for m in members.json()}
    assert roles[owner_id] == "owner"
    assert roles[bob_id] == "editor"


async def test_snag_assignment_to_member_and_board_feed(
    free_tier_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """A snag can be assigned to a project participant (the invited member), the
    assignment + deadline surface on the board feed (FindingRead adapter), and an
    editor can assign too — but only to a participant; an outsider is a 422."""
    client, _ = free_tier_storage_client
    owner, owner_id = await _free_user(client, session_maker, "a-owner@example.com")
    bob, bob_id = await _free_user(client, session_maker, "a-bob@example.com")
    # Charlie exists but is never invited → not a participant.
    _charlie, charlie_id = await _free_user(client, session_maker, "a-charlie@example.com")
    pid = await _create_project(client, owner, name="Assign")
    did = await _create_document(client, owner, pid, name="Arch")

    inv = await client.post(
        f"/free/projects/{pid}/members",
        json={"email": "a-bob@example.com", "role": "editor"},
        headers=_auth(owner),
    )
    assert inv.status_code == 201, inv.text

    # Owner assigns a snag to Bob with a deadline.
    snag = await client.post(
        f"/free/documents/{did}/findings",
        json={
            "title": "Fix beam",
            "assigned_to_user_id": bob_id,
            "deadline_date": "2026-11-30",
        },
        headers=_auth(owner),
    )
    assert snag.status_code == 201, snag.text
    snag_id = snag.json()["id"]

    # The board feed (paid FindingRead shape) carries assignee + deadline.
    board = await client.get(f"/free/projects/{pid}/findings", headers=_auth(owner))
    assert board.status_code == 200
    feed = {f["id"]: f for f in board.json()}
    assert feed[snag_id]["assignee_user_id"] == bob_id
    assert feed[snag_id]["deadline_date"] == "2026-11-30"

    # Bob (editor) can re-assign to the owner (also a participant).
    reassign = await client.patch(
        f"/free/findings/{snag_id}",
        json={"assigned_to_user_id": owner_id},
        headers=_auth(bob),
    )
    assert reassign.status_code == 200, reassign.text
    assert reassign.json()["assigned_to_user_id"] == owner_id

    # Assigning to a non-participant (Charlie) is a 422, from either writer.
    for writer in (owner, bob):
        bad = await client.patch(
            f"/free/findings/{snag_id}",
            json={"assigned_to_user_id": charlie_id},
            headers=_auth(writer),
        )
        assert bad.status_code == 422, bad.text
        assert bad.json()["detail"] == "ASSIGNEE_NOT_A_PROJECT_MEMBER"


async def test_non_member_cannot_read_container_by_id(
    free_tier_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """The participant container loader drops the owner filter, so RLS is the ONLY
    thing scoping it — verify a stranger gets 404, not the row."""
    client, _ = free_tier_storage_client
    owner, _ = await _free_user(client, session_maker, "rls-owner@example.com")
    stranger, _ = await _free_user(client, session_maker, "rls-stranger@example.com")
    pid = await _create_project(client, owner)
    did = await _create_document(client, owner, pid)

    assert (
        await client.get(
            f"/free/projects/{pid}/documents/{did}", headers=_auth(stranger)
        )
    ).status_code == 404
    assert (
        await client.get(f"/free/documents/{did}/findings", headers=_auth(stranger))
    ).status_code == 404
    assert (
        await client.get(
            f"/free/projects/{pid}/documents/{did}", headers=_auth(owner)
        )
    ).status_code == 200


async def test_member_cap(
    free_tier_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    client, _ = free_tier_storage_client
    owner, _ = await _free_user(client, session_maker, "cap-owner@example.com")
    pid = await _create_project(client, owner)

    cap = get_settings().free_max_members_per_project

    for i in range(cap):
        await make_test_user(session_maker, email=f"cap-m{i}@example.com", is_verified=True)
        r = await client.post(
            f"/free/projects/{pid}/members",
            json={"email": f"cap-m{i}@example.com", "role": "viewer"},
            headers=_auth(owner),
        )
        assert r.status_code == 201, r.text
    # One past the cap.
    await make_test_user(session_maker, email="cap-extra@example.com", is_verified=True)
    over = await client.post(
        f"/free/projects/{pid}/members",
        json={"email": "cap-extra@example.com"},
        headers=_auth(owner),
    )
    assert over.status_code == 403
    assert over.json()["detail"] == "FREE_MEMBER_CAP_REACHED"


async def test_member_cap_is_configurable(
    free_tier_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The invited-member cap honours FREE_MAX_MEMBERS_PER_PROJECT at runtime."""
    client, _ = free_tier_storage_client
    owner, _ = await _free_user(client, session_maker, "cfg-owner@example.com")
    pid = await _create_project(client, owner)

    monkeypatch.setenv("FREE_MAX_MEMBERS_PER_PROJECT", "1")
    get_settings.cache_clear()
    try:
        await make_test_user(session_maker, email="cfg-m0@example.com", is_verified=True)
        first = await client.post(
            f"/free/projects/{pid}/members",
            json={"email": "cfg-m0@example.com", "role": "viewer"},
            headers=_auth(owner),
        )
        assert first.status_code == 201, first.text
        await make_test_user(session_maker, email="cfg-m1@example.com", is_verified=True)
        over = await client.post(
            f"/free/projects/{pid}/members",
            json={"email": "cfg-m1@example.com", "role": "viewer"},
            headers=_auth(owner),
        )
        assert over.status_code == 403
        assert over.json()["detail"] == "FREE_MEMBER_CAP_REACHED"
    finally:
        monkeypatch.delenv("FREE_MAX_MEMBERS_PER_PROJECT", raising=False)
        get_settings.cache_clear()


async def test_invite_dedup_and_self(
    free_tier_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    client, _ = free_tier_storage_client
    owner, _ = await _free_user(client, session_maker, "dd-owner@example.com")
    await _free_user(client, session_maker, "dd-bob@example.com")
    pid = await _create_project(client, owner)

    assert (
        await client.post(
            f"/free/projects/{pid}/members",
            json={"email": "dd-bob@example.com"},
            headers=_auth(owner),
        )
    ).status_code == 201
    dup = await client.post(
        f"/free/projects/{pid}/members",
        json={"email": "dd-bob@example.com"},
        headers=_auth(owner),
    )
    assert dup.status_code == 409
    assert dup.json()["detail"] == "FREE_MEMBER_ALREADY_EXISTS"

    me = await client.post(
        f"/free/projects/{pid}/members",
        json={"email": "dd-owner@example.com"},
        headers=_auth(owner),
    )
    assert me.status_code == 400
    assert me.json()["detail"] == "FREE_CANNOT_INVITE_SELF"


async def test_member_remove_and_leave(
    free_tier_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    client, _ = free_tier_storage_client
    owner, _ = await _free_user(client, session_maker, "rm-owner@example.com")
    bob, bob_id = await _free_user(client, session_maker, "rm-bob@example.com")
    pid = await _create_project(client, owner)
    await client.post(
        f"/free/projects/{pid}/members",
        json={"email": "rm-bob@example.com"},
        headers=_auth(owner),
    )

    # Bob can leave (remove self).
    assert (
        await client.delete(
            f"/free/projects/{pid}/members/{bob_id}", headers=_auth(bob)
        )
    ).status_code == 204
    # Gone — he no longer sees it.
    assert (await client.get(f"/free/projects/{pid}", headers=_auth(bob))).status_code == 404

    # Re-invite; owner removes him.
    await client.post(
        f"/free/projects/{pid}/members",
        json={"email": "rm-bob@example.com"},
        headers=_auth(owner),
    )
    assert (
        await client.delete(
            f"/free/projects/{pid}/members/{bob_id}", headers=_auth(owner)
        )
    ).status_code == 204
    # Removing a non-member → 404.
    assert (
        await client.delete(
            f"/free/projects/{pid}/members/{bob_id}", headers=_auth(owner)
        )
    ).status_code == 404


# ---------------------------------------------------------------------------
# Storage cap
# ---------------------------------------------------------------------------


async def test_aggregate_storage_cap(
    free_tier_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    client, _ = free_tier_storage_client
    settings = get_settings()
    per = settings.free_upload_max_bytes
    cap = settings.free_storage_max_bytes
    fits = cap // per  # full-size files that fit under the aggregate cap

    token, _ = await _free_user(client, session_maker, "storage@example.com")
    pid = await _create_project(client, token)
    did = await _create_document(client, token, pid)
    # All versions of one container count toward the owner's aggregate footprint.
    for i in range(fits):
        await _initiate_file(
            client, token, pid, did, filename=f"m{i}.ifc", size=per
        )
    over = await client.post(
        f"/free/projects/{pid}/documents/{did}/files/initiate",
        json={
            "filename": "over.ifc",
            "size_bytes": per,
            "content_type": "application/octet-stream",
            "content_sha256": "f" * 64,
        },
        headers=_auth(token),
    )
    assert over.status_code == 413, over.text
    assert over.json()["detail"] == "FREE_STORAGE_CAP_REACHED"


# ---------------------------------------------------------------------------
# Free-workspace auth context
# ---------------------------------------------------------------------------


async def test_has_free_workspace_and_switch_to_free(
    free_tier_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    client, _ = free_tier_storage_client

    # A brand-new free user with no projects has nothing to enter.
    empty, _ = await _free_user(client, session_maker, "ws-empty@example.com")
    me_empty = await client.get("/auth/me", headers=_auth(empty))
    assert me_empty.json()["has_free_workspace"] is False
    assert (
        await client.post("/auth/switch-to-free", json={}, headers=_auth(empty))
    ).status_code == 403

    # Owner gets a workspace once they own a project.
    owner, _ = await _free_user(client, session_maker, "ws-owner@example.com")
    pid = await _create_project(client, owner)
    assert (await client.get("/auth/me", headers=_auth(owner))).json()["has_free_workspace"] is True

    # A PAID user invited as a member: has_free_workspace, switch mints a no-org
    # token, and they can then see the shared project — but still can't create.
    paid, _ = await _paid_token(client, session_maker, "ws-paid@example.com")
    await client.post(
        f"/free/projects/{pid}/members",
        json={"email": "ws-paid@example.com", "role": "viewer"},
        headers=_auth(owner),
    )
    me_paid = await client.get("/auth/me", headers=_auth(paid))
    assert me_paid.json()["active_organization_id"] is not None
    assert me_paid.json()["has_free_workspace"] is True

    switched = await client.post("/auth/switch-to-free", json={}, headers=_auth(paid))
    assert switched.status_code == 200, switched.text
    free_token = switched.json()["access_token"]
    me_free = await client.get("/auth/me", headers=_auth(free_token))
    assert me_free.json()["active_organization_id"] is None
    shared = await client.get(f"/free/projects/{pid}", headers=_auth(free_token))
    assert shared.status_code == 200
    assert shared.json()["my_role"] == "viewer"
    # Still gated from creating, even inside the free workspace.
    assert (
        await client.post("/free/projects", json={"name": "no"}, headers=_auth(free_token))
    ).status_code == 403
