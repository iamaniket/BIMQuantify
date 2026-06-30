"""Tests for free-tier Levels (the shared 2D/3D spine) + drawing assignment.

A free user creates building levels, lists them ordered, assigns a PDF drawing to
a level (and clears it), and deleting a level reverts its drawings to Unassigned
(SET NULL). RLS isolates levels to the project's owner + members.
"""

from uuid import uuid4

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from tests.conftest import FakeStorage
from tests.test_free_viewer import _auth, _create_document, _create_project, _free_token


async def _create_level(
    client: AsyncClient,
    token: str,
    pid: str,
    *,
    name: str = "Ground",
    elevation: float | None = 0.0,
    ordering: int | None = 0,
) -> dict:
    resp = await client.post(
        f"/pooled/projects/{pid}/levels",
        json={"name": name, "elevation_m": elevation, "ordering": ordering},
        headers=_auth(token),
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


async def test_free_level_crud_and_drawing_assignment(
    free_tier_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    client, _ = free_tier_storage_client
    token = await _free_token(client, session_maker, "free-levels@example.com")
    pid = await _create_project(client, token)
    did = await _create_document(client, token, pid)

    l1 = await _create_level(client, token, pid, name="Ground", elevation=0.0, ordering=0)
    l2 = await _create_level(client, token, pid, name="First", elevation=3.0, ordering=1)
    assert l1["source"] == "manual"
    assert l1["project_id"] == pid

    # Ordered by floor (ground before first).
    lst = await client.get(f"/pooled/projects/{pid}/levels", headers=_auth(token))
    assert lst.status_code == 200
    assert [x["name"] for x in lst.json()] == ["Ground", "First"]

    # Duplicate name conflicts.
    dup = await client.post(
        f"/pooled/projects/{pid}/levels", json={"name": "Ground"}, headers=_auth(token)
    )
    assert dup.status_code == 409

    # Rename a level.
    upd = await client.patch(
        f"/pooled/projects/{pid}/levels/{l2['id']}",
        json={"name": "Level 1"},
        headers=_auth(token),
    )
    assert upd.status_code == 200
    assert upd.json()["name"] == "Level 1"

    # Assign the drawing to a level.
    assigned = await client.patch(
        f"/pooled/projects/{pid}/documents/{did}",
        json={"level_id": l1["id"]},
        headers=_auth(token),
    )
    assert assigned.status_code == 200, assigned.text
    assert assigned.json()["level_id"] == l1["id"]

    # A bogus level id → 404 (not an FK 500).
    bad = await client.patch(
        f"/pooled/projects/{pid}/documents/{did}",
        json={"level_id": str(uuid4())},
        headers=_auth(token),
    )
    assert bad.status_code == 404

    # Deleting the level reverts the drawing to Unassigned (SET NULL).
    deleted = await client.delete(
        f"/pooled/projects/{pid}/levels/{l1['id']}", headers=_auth(token)
    )
    assert deleted.status_code == 204
    doc = await client.get(
        f"/pooled/projects/{pid}/documents/{did}", headers=_auth(token)
    )
    assert doc.status_code == 200
    assert doc.json()["level_id"] is None


async def test_pooled_levels_rls_isolation(
    free_tier_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """A non-participant can neither read nor create levels in another's project."""
    client, _ = free_tier_storage_client
    token_a = await _free_token(client, session_maker, "free-lvl-a@example.com")
    token_b = await _free_token(client, session_maker, "free-lvl-b@example.com")
    pid = await _create_project(client, token_a)
    await _create_level(client, token_a, pid, name="Ground")

    assert (
        await client.get(f"/pooled/projects/{pid}/levels", headers=_auth(token_b))
    ).status_code == 404
    assert (
        await client.post(
            f"/pooled/projects/{pid}/levels", json={"name": "x"}, headers=_auth(token_b)
        )
    ).status_code == 404
