"""Tests for the free-tier project surface (pooled `public.free_projects`).

Covers: free project CRUD (paid ProjectRead shape), grouping models under a
project (initiate + PATCH assign), the containers endpoint (free models as
DocumentWithVersions), the board feed (free snags adapted to FindingRead), the
overview BFF (findings-only completeness, org blocks zeroed), the widened 5-value
snag status set, and — the security gate — RLS isolation between two free users.
"""

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from tests.conftest import FakeStorage
from tests.test_free_viewer import _auth, _free_token, _initiate


async def _create_project(client: AsyncClient, token: str, *, name: str = "My House") -> dict:
    resp = await client.post("/free/projects", json={"name": name}, headers=_auth(token))
    assert resp.status_code == 201, resp.text
    return resp.json()


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

    listed = await client.get("/free/projects", headers=_auth(token))
    assert listed.status_code == 200
    assert [p["id"] for p in listed.json()] == [pid]

    patched = await client.patch(
        f"/free/projects/{pid}",
        json={"name": "Villa 2", "phase": "shell", "city": "Utrecht"},
        headers=_auth(token),
    )
    assert patched.status_code == 200, patched.text
    assert patched.json()["name"] == "Villa 2"
    assert patched.json()["phase"] == "shell"
    assert patched.json()["city"] == "Utrecht"

    deleted = await client.delete(f"/free/projects/{pid}", headers=_auth(token))
    assert deleted.status_code == 204
    assert (await client.get(f"/free/projects/{pid}", headers=_auth(token))).status_code == 404


async def test_model_assignment_and_documents(
    free_tier_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    client, _ = free_tier_storage_client
    token = await _free_token(client, session_maker, "fp-docs@example.com")
    pid = (await _create_project(client, token))["id"]

    # Upload a model straight into the project.
    init = await client.post(
        "/free/models/initiate",
        json={"filename": "a.ifc", "size_bytes": 100, "free_project_id": pid},
        headers=_auth(token),
    )
    assert init.status_code == 201, init.text
    mid = init.json()["model_id"]

    docs = await client.get(f"/free/projects/{pid}/documents", headers=_auth(token))
    assert docs.status_code == 200, docs.text
    body = docs.json()
    assert len(body) == 1
    doc = body[0]
    assert doc["id"] == mid
    assert doc["project_id"] == pid
    assert doc["primary_file_type"] == "ifc"
    assert doc["discipline"] == "other"
    assert len(doc["versions"]) == 1
    assert doc["versions"][0]["file_type"] == "ifc"

    # A second, ungrouped model — then PATCH-assign it.
    mid2 = (await _initiate(client, token, filename="b.ifc"))["model_id"]
    patch = await client.patch(
        f"/free/models/{mid2}", json={"free_project_id": pid}, headers=_auth(token)
    )
    assert patch.status_code == 200, patch.text
    assert patch.json()["free_project_id"] == pid

    docs2 = await client.get(f"/free/projects/{pid}/documents", headers=_auth(token))
    assert {d["id"] for d in docs2.json()} == {mid, mid2}

    # Ungroup it again.
    unset = await client.patch(
        f"/free/models/{mid2}", json={"free_project_id": None}, headers=_auth(token)
    )
    assert unset.status_code == 200
    assert unset.json()["free_project_id"] is None


async def test_board_feed_and_overview(
    free_tier_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    client, _ = free_tier_storage_client
    token = await _free_token(client, session_maker, "fp-board@example.com")
    pid = (await _create_project(client, token))["id"]
    init = await client.post(
        "/free/models/initiate",
        json={"filename": "a.ifc", "size_bytes": 100, "free_project_id": pid},
        headers=_auth(token),
    )
    mid = init.json()["model_id"]

    s1 = await client.post(
        f"/free/models/{mid}/snags",
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
            f"/free/models/{mid}/snags",
            json={"title": "leak", "severity": "low"},
            headers=_auth(token),
        )
    ).json()["id"]

    assert (
        await client.patch(
            f"/free/snags/{sid2}", json={"status": "in_progress"}, headers=_auth(token)
        )
    ).status_code == 200
    assert (
        await client.patch(f"/free/snags/{sid1}", json={"status": "resolved"}, headers=_auth(token))
    ).status_code == 200

    # Board feed — FindingRead shape across the project's models.
    board = await client.get(f"/free/projects/{pid}/snags", headers=_auth(token))
    assert board.status_code == 200, board.text
    by_id = {f["id"]: f for f in board.json()}
    assert len(by_id) == 2
    assert by_id[sid1]["status"] == "resolved"
    assert by_id[sid1]["severity"] == "high"
    assert by_id[sid1]["project_id"] == pid
    assert by_id[sid1]["anchor_x"] == 1.0
    assert by_id[sid1]["linked_element_global_id"] == "GUID123"
    assert by_id[sid1]["assignee_user_id"] is None
    assert by_id[sid2]["status"] == "in_progress"
    # description falls back to title when the note is empty.
    assert by_id[sid2]["description"] == "leak"

    # Overview — full ProjectOverview shape, findings-only completeness.
    ov = await client.get(f"/free/projects/{pid}/overview", headers=_auth(token))
    assert ov.status_code == 200, ov.text
    o = ov.json()
    assert o["project"]["id"] == pid
    c = o["completeness"]
    assert c["findings"]["total"] == 2
    assert c["findings"]["complete"] == 1
    assert c["findings"]["by_status"]["resolved"] == 1
    assert c["findings"]["by_status"]["in_progress"] == 1
    assert c["overall_total"] == 2 and c["overall_filled"] == 1
    # Org-only blocks zeroed so the paid Zod schema validates unchanged.
    assert c["dossier"]["total"] == 0
    assert c["deadlines"]["total"] == 0
    assert o["certificates"]["count"] == 0
    assert o["reports"]["count"] == 0
    assert o["deadlines"]["total"] == 0
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
    mid = (await _initiate(client, token))["model_id"]
    sid = (
        await client.post(f"/free/models/{mid}/snags", json={"title": "x"}, headers=_auth(token))
    ).json()["id"]

    for st in ("draft", "open", "in_progress", "resolved", "verified"):
        r = await client.patch(f"/free/snags/{sid}", json={"status": st}, headers=_auth(token))
        assert r.status_code == 200, r.text
        assert r.json()["status"] == st

    # The legacy 'closed' value is no longer accepted.
    bad = await client.patch(f"/free/snags/{sid}", json={"status": "closed"}, headers=_auth(token))
    assert bad.status_code == 422


async def test_rls_isolation_free_projects(
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
        f"/free/projects/{pid}",
        f"/free/projects/{pid}/documents",
        f"/free/projects/{pid}/snags",
        f"/free/projects/{pid}/overview",
    ):
        assert (await client.get(path, headers=_auth(token_b))).status_code == 404, path
    assert (await client.get("/free/projects", headers=_auth(token_b))).json() == []
    assert (
        await client.patch(f"/free/projects/{pid}", json={"name": "hax"}, headers=_auth(token_b))
    ).status_code == 404
    assert (await client.delete(f"/free/projects/{pid}", headers=_auth(token_b))).status_code == 404

    # B cannot assign their own model into A's project.
    mid_b = (await _initiate(client, token_b, filename="b.ifc"))["model_id"]
    assert (
        await client.patch(
            f"/free/models/{mid_b}", json={"free_project_id": pid}, headers=_auth(token_b)
        )
    ).status_code == 404

    # A still sees their own project.
    assert (await client.get(f"/free/projects/{pid}", headers=_auth(token_a))).status_code == 200
