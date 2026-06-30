"""Tests for the free-tier project surface (pooled `public.pooled_projects`).

Covers: free project CRUD (paid ProjectRead shape), the containers endpoint
(real pooled_documents + pooled_project_files as DocumentWithVersions), the board
feed (free snags adapted to FindingRead), the overview BFF (findings-only
completeness, org blocks zeroed), the widened 5-value snag status set, and — the
security gate — RLS isolation between two free users.
"""

from collections.abc import AsyncGenerator

import pytest
from httpx import ASGITransport, AsyncClient
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

from bimdossier_api.config import get_settings
from tests.conftest import FakeStorage, make_test_user
from tests.test_pooled_viewer import (
    _auth,
    _create_document,
    _free_token,
    _upload,
)
from tests.test_projects import _TINY_JPEG


async def _create_project(client: AsyncClient, token: str, *, name: str = "My House") -> dict:
    resp = await client.post("/pooled/projects", json={"name": name}, headers=_auth(token))
    assert resp.status_code == 201, resp.text
    return resp.json()


async def test_free_project_thumbnail_upload(
    free_tier_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """Owner uploads a cover image: stored under the user's free prefix and
    returned presigned. Bad type → 415, too large → 413, non-owner → 404."""
    client, fake = free_tier_storage_client
    token = await _free_token(client, session_maker, "fp-thumb@example.com")
    created = await _create_project(client, token, name="Cover")
    pid = created["id"]
    owner_id = created["owner_id"]

    ok = await client.post(
        f"/pooled/projects/{pid}/thumbnail",
        files={"thumbnail": ("cover.jpg", _TINY_JPEG, "image/jpeg")},
        headers=_auth(token),
    )
    assert ok.status_code == 200, ok.text
    url = ok.json()["thumbnail_url"]
    assert url is not None and "http://fake-storage/" in url and "thumbnails/" in url
    # The object lives under the OWNER's free prefix (storage scope), never the org prefix.
    keys = [k for k in fake.objects if k.endswith(".jpg")]
    assert keys, "thumbnail object not stored"
    assert all(k.startswith(f"free/{owner_id}/thumbnails/") for k in keys)

    # Re-fetching the project also returns the presigned cover.
    fetched = await client.get(f"/pooled/projects/{pid}", headers=_auth(token))
    assert fetched.status_code == 200
    assert "http://fake-storage/" in (fetched.json()["thumbnail_url"] or "")

    # Unsupported content type → 415.
    bad_type = await client.post(
        f"/pooled/projects/{pid}/thumbnail",
        files={"thumbnail": ("c.txt", b"hello", "text/plain")},
        headers=_auth(token),
    )
    assert bad_type.status_code == 415
    assert bad_type.json()["detail"] == "THUMBNAIL_UNSUPPORTED_TYPE"

    # Over the size cap → 413.
    big = b"x" * (get_settings().thumbnail_max_bytes + 1)
    too_big = await client.post(
        f"/pooled/projects/{pid}/thumbnail",
        files={"thumbnail": ("big.jpg", big, "image/jpeg")},
        headers=_auth(token),
    )
    assert too_big.status_code == 413
    assert too_big.json()["detail"] == "THUMBNAIL_TOO_LARGE"

    # A different free user can't upload to someone else's project (owner-scoped → 404).
    other = await _free_token(client, session_maker, "fp-thumb-other@example.com")
    forbidden = await client.post(
        f"/pooled/projects/{pid}/thumbnail",
        files={"thumbnail": ("x.jpg", _TINY_JPEG, "image/jpeg")},
        headers=_auth(other),
    )
    assert forbidden.status_code == 404


async def test_project_cap_is_configurable(
    free_tier_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The owned-project cap honours FREE_MAX_PROJECTS_PER_USER at runtime."""
    client, _ = free_tier_storage_client
    token = await _free_token(client, session_maker, "proj-cap@example.com")

    monkeypatch.setenv("FREE_MAX_PROJECTS_PER_USER", "1")
    get_settings.cache_clear()
    try:
        await _create_project(client, token, name="first")
        over = await client.post(
            "/pooled/projects", json={"name": "second"}, headers=_auth(token)
        )
        assert over.status_code == 403
        assert over.json()["detail"] == "FREE_PROJECT_CAP_REACHED"
    finally:
        monkeypatch.delenv("FREE_MAX_PROJECTS_PER_USER", raising=False)
        get_settings.cache_clear()


async def test_free_project_crud(
    free_tier_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    client, _ = free_tier_storage_client
    token = await _free_token(client, session_maker, "fp-crud@example.com")

    created = await _create_project(client, token, name="Villa")
    assert created["name"] == "Villa"
    assert created["my_role"] == "owner"
    assert created["lifecycle_state"] == "active"
    assert created["phase"] == "design"
    pid = created["id"]

    listed = await client.get("/pooled/projects", headers=_auth(token))
    assert listed.status_code == 200
    assert [p["id"] for p in listed.json()] == [pid]

    patched = await client.patch(
        f"/pooled/projects/{pid}",
        json={"name": "Villa 2", "phase": "shell", "city": "Utrecht"},
        headers=_auth(token),
    )
    assert patched.status_code == 200, patched.text
    assert patched.json()["name"] == "Villa 2"
    assert patched.json()["phase"] == "shell"
    assert patched.json()["city"] == "Utrecht"

    deleted = await client.delete(f"/pooled/projects/{pid}", headers=_auth(token))
    assert deleted.status_code == 204
    assert (await client.get(f"/pooled/projects/{pid}", headers=_auth(token))).status_code == 404


async def test_containers_listing(
    free_tier_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    client, fake = free_tier_storage_client
    token = await _free_token(client, session_maker, "fp-docs@example.com")
    pid = (await _create_project(client, token))["id"]

    did = await _create_document(client, token, pid, name="Arch")
    await _upload(client, fake, token, pid, did, filename="a.ifc")

    docs = await client.get(f"/pooled/projects/{pid}/documents", headers=_auth(token))
    assert docs.status_code == 200, docs.text
    body = docs.json()
    assert len(body) == 1
    doc = body[0]
    assert doc["id"] == did
    assert doc["project_id"] == pid
    assert doc["primary_file_type"] == "ifc"
    assert doc["name"] == "Arch"
    assert len(doc["versions"]) == 1
    assert doc["versions"][0]["file_type"] == "ifc"
    assert doc["versions"][0]["status"] == "ready"

    # An empty container (no files yet) still lists, with an empty version set.
    did2 = await _create_document(client, token, pid, name="Empty")
    docs2 = await client.get(f"/pooled/projects/{pid}/documents", headers=_auth(token))
    by_id = {d["id"]: d for d in docs2.json()}
    assert set(by_id) == {did, did2}
    assert by_id[did2]["versions"] == []


async def test_board_feed_and_overview(
    free_tier_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    client, _ = free_tier_storage_client
    token = await _free_token(client, session_maker, "fp-board@example.com")
    pid = (await _create_project(client, token))["id"]
    did = await _create_document(client, token, pid)

    s1 = await client.post(
        f"/pooled/documents/{did}/findings",
        json={
            "title": "crack",
            "severity": "high",
            "anchor_x": 1.0,
            "anchor_y": 2.0,
            "anchor_z": 3.0,
            "linked_element_global_id": "GUID123",
        },
        headers=_auth(token),
    )
    assert s1.status_code == 201, s1.text
    sid1 = s1.json()["id"]
    sid2 = (
        await client.post(
            f"/pooled/documents/{did}/findings",
            json={"title": "leak", "severity": "low"},
            headers=_auth(token),
        )
    ).json()["id"]

    assert (
        await client.patch(
            f"/pooled/findings/{sid2}", json={"status": "in_progress"}, headers=_auth(token)
        )
    ).status_code == 200
    assert (
        await client.patch(
            f"/pooled/findings/{sid1}", json={"status": "resolved"}, headers=_auth(token)
        )
    ).status_code == 200

    # Board feed — FindingRead shape across the project's containers.
    board = await client.get(f"/pooled/projects/{pid}/findings", headers=_auth(token))
    assert board.status_code == 200, board.text
    by_id = {f["id"]: f for f in board.json()}
    assert len(by_id) == 2
    assert by_id[sid1]["status"] == "resolved"
    assert by_id[sid1]["severity"] == "high"
    assert by_id[sid1]["project_id"] == pid
    assert by_id[sid1]["anchor_x"] == 1.0
    assert by_id[sid1]["linked_element_global_id"] == "GUID123"
    assert by_id[sid1]["linked_document_id"] == did
    assert by_id[sid1]["assignee_user_id"] is None
    assert by_id[sid2]["status"] == "in_progress"
    assert by_id[sid2]["description"] == "leak"  # falls back to title

    # Overview — full ProjectOverview shape, findings-only completeness.
    ov = await client.get(f"/pooled/projects/{pid}/overview", headers=_auth(token))
    assert ov.status_code == 200, ov.text
    o = ov.json()
    assert o["project"]["id"] == pid
    c = o["completeness"]
    assert c["findings"]["total"] == 2
    assert c["findings"]["complete"] == 1
    assert c["findings"]["by_status"]["resolved"] == 1
    assert c["findings"]["by_status"]["in_progress"] == 1
    assert c["overall_total"] == 2 and c["overall_filled"] == 1
    assert c["dossier"]["total"] == 0
    assert c["deadlines"]["total"] == 0
    assert o["certificates"]["count"] == 0
    assert o["reports"]["count"] == 0
    assert o["findings"]["count"] == 2
    assert o["findings"]["open"] == 1  # open(0) + in_progress(1)
    assert len(o["members"]) == 1 and o["members"][0]["role"] == "owner"
    assert o["activity_timeline"] == []


async def test_snag_status_accepts_paid_values(
    free_tier_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    client, _ = free_tier_storage_client
    token = await _free_token(client, session_maker, "fp-status@example.com")
    pid = (await _create_project(client, token))["id"]
    did = await _create_document(client, token, pid)
    sid = (
        await client.post(
            f"/pooled/documents/{did}/findings", json={"title": "x"}, headers=_auth(token)
        )
    ).json()["id"]

    for st in ("draft", "open", "in_progress", "resolved", "verified"):
        r = await client.patch(f"/pooled/findings/{sid}", json={"status": st}, headers=_auth(token))
        assert r.status_code == 200, r.text
        assert r.json()["status"] == st

    # The legacy 'closed' value is no longer accepted.
    bad = await client.patch(
        f"/pooled/findings/{sid}", json={"status": "closed"}, headers=_auth(token)
    )
    assert bad.status_code == 422


async def test_rls_isolation_pooled_projects(
    free_tier_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """Security gate: user B cannot read or mutate user A's free project / its
    documents / snags / overview — exercised as bim_app + the owner GUC."""
    client, _ = free_tier_storage_client
    token_a = await _free_token(client, session_maker, "fp-iso-a@example.com")
    token_b = await _free_token(client, session_maker, "fp-iso-b@example.com")
    pid = (await _create_project(client, token_a, name="A secret"))["id"]

    for path in (
        f"/pooled/projects/{pid}",
        f"/pooled/projects/{pid}/findings",
        f"/pooled/projects/{pid}/overview",
    ):
        assert (await client.get(path, headers=_auth(token_b))).status_code == 404, path
    # The container list is RLS-scoped: a non-participant sees an empty list.
    assert (
        await client.get(f"/pooled/projects/{pid}/documents", headers=_auth(token_b))
    ).json() == []
    assert (await client.get("/pooled/projects", headers=_auth(token_b))).json() == []
    assert (
        await client.patch(f"/pooled/projects/{pid}", json={"name": "hax"}, headers=_auth(token_b))
    ).status_code == 404
    assert (await client.delete(f"/pooled/projects/{pid}", headers=_auth(token_b))).status_code == 404

    # B cannot create a container in A's project.
    assert (
        await client.post(
            f"/pooled/projects/{pid}/documents", json={"name": "hax"}, headers=_auth(token_b)
        )
    ).status_code == 404

    # A still sees their own project.
    assert (await client.get(f"/pooled/projects/{pid}", headers=_auth(token_a))).status_code == 200


# ---------------------------------------------------------------------------
# FR-5 — free create/update must reject a country with no registered
# jurisdiction (paid does via `_validate_country`); persisting "US" would break
# a later free→paid conversion.
# ---------------------------------------------------------------------------


async def test_create_free_project_rejects_unsupported_country(
    free_tier_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    client, _ = free_tier_storage_client
    token = await _free_token(client, session_maker, "fr5-create@example.com")
    resp = await client.post(
        "/pooled/projects", json={"name": "X", "country": "US"}, headers=_auth(token)
    )
    assert resp.status_code == 422, resp.text
    assert resp.json()["detail"].startswith("UNSUPPORTED_COUNTRY")


async def test_update_free_project_rejects_unsupported_country(
    free_tier_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    client, _ = free_tier_storage_client
    token = await _free_token(client, session_maker, "fr5-update@example.com")
    pid = (await _create_project(client, token, name="Valid NL"))["id"]
    resp = await client.patch(
        f"/pooled/projects/{pid}", json={"country": "US"}, headers=_auth(token)
    )
    assert resp.status_code == 422, resp.text
    assert resp.json()["detail"].startswith("UNSUPPORTED_COUNTRY")


# ---------------------------------------------------------------------------
# FR-14 — the free member-invite endpoint emails an activation link for a new
# invitee, so it MUST share the per-user INVITE_LIMITER budget (mail-bomb
# defense), exactly like the paid org-invite. The second call past the squeezed
# budget trips 429.
# ---------------------------------------------------------------------------


@pytest.fixture
async def free_limited_client(
    engine: AsyncEngine,
    session_maker: async_sessionmaker[AsyncSession],
    redis_client: Redis,
    monkeypatch: pytest.MonkeyPatch,
) -> AsyncGenerator[AsyncClient, None]:
    """FREE_TIER_ENABLED with rate limiting ACTIVE (limiters NOT overridden) —
    mirrors `limited_fake_storage_client` but mounts the free surface."""
    from fastapi_limiter import FastAPILimiter

    from bimdossier_api import db as db_module
    from bimdossier_api.cache import client as cache_module
    from bimdossier_api.main import create_app
    from bimdossier_api.storage import get_storage

    db_module._engine = engine
    db_module._session_maker = session_maker
    cache_module._redis = redis_client

    monkeypatch.setenv("FREE_TIER_ENABLED", "true")
    get_settings.cache_clear()
    await FastAPILimiter.init(redis_client)
    try:
        app = create_app()
        app.dependency_overrides[get_storage] = lambda: FakeStorage()
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            yield ac
    finally:
        await FastAPILimiter.close()
        monkeypatch.delenv("FREE_TIER_ENABLED", raising=False)
        get_settings.cache_clear()


async def test_free_invite_member_enforces_rate_limit(
    free_limited_client: AsyncClient,
    session_maker: async_sessionmaker[AsyncSession],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from bimdossier_api.auth.ratelimit import INVITE_LIMITER

    # Squeeze the shared "org_invite" budget to one call so the second invite trips.
    monkeypatch.setattr(INVITE_LIMITER, "times", 1)
    client = free_limited_client
    token = await _free_token(client, session_maker, "fr14-owner@example.com")
    pid = (await _create_project(client, token, name="RL"))["id"]
    # Pre-create the invitees so the handler takes the existing-user path (no
    # activation email); the limiter runs BEFORE the handler so it still counts.
    await make_test_user(session_maker, email="fr14-a@example.com", is_verified=True)
    await make_test_user(session_maker, email="fr14-b@example.com", is_verified=True)
    url = f"/pooled/projects/{pid}/members"

    first = await client.post(
        url, json={"email": "fr14-a@example.com", "role": "viewer"}, headers=_auth(token)
    )
    second = await client.post(
        url, json={"email": "fr14-b@example.com", "role": "viewer"}, headers=_auth(token)
    )
    assert first.status_code == 201, first.text
    assert second.status_code == 429
