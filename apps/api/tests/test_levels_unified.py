"""Phase C — levels unified onto get_scoped_session.

The same `/projects/{id}/levels` route now serves BOTH tiers (the client no longer
picks `/free/*` vs `/projects/*`):

- a free (org-less) user hitting the canonical `/projects/{id}/levels` gets the
  pooled PooledLevel path, returning the SAME `LevelRead` shape as paid;
- the legacy `/pooled/projects/{id}/levels` alias still works (backward compat for
  un-migrated clients) and is byte-identical;
- a paid user is unchanged.

This is the proof-of-pattern slice for the whole free/paid unification.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from tests.test_pooled_viewer import _create_project, _free_token

if TYPE_CHECKING:
    from httpx import AsyncClient
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

    from tests.conftest import FakeStorage


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def test_free_user_levels_full_crud_via_unified_path(
    free_tier_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """A free user does full level CRUD on the CANONICAL /projects path — no
    /free prefix — and gets the paid LevelRead shape."""
    client, _ = free_tier_storage_client
    token = await _free_token(client, session_maker, "lvl-free@example.com")
    pid = await _create_project(client, token)

    # CREATE via the unified path.
    created = await client.post(
        f"/projects/{pid}/levels",
        json={"name": "Ground floor", "elevation_m": 0.0, "ordering": 1},
        headers=_auth(token),
    )
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["name"] == "Ground floor"
    assert body["project_id"] == pid
    assert body["source"] == "manual"
    level_id = body["id"]

    # LIST via the unified path.
    listed = await client.get(f"/projects/{pid}/levels", headers=_auth(token))
    assert listed.status_code == 200, listed.text
    assert [lvl["id"] for lvl in listed.json()] == [level_id]

    # PATCH via the unified path.
    patched = await client.patch(
        f"/projects/{pid}/levels/{level_id}",
        json={"name": "Begane grond"},
        headers=_auth(token),
    )
    assert patched.status_code == 200, patched.text
    assert patched.json()["name"] == "Begane grond"

    # DELETE via the unified path.
    deleted = await client.delete(f"/projects/{pid}/levels/{level_id}", headers=_auth(token))
    assert deleted.status_code == 204, deleted.text
    assert (await client.get(f"/projects/{pid}/levels", headers=_auth(token))).json() == []


async def test_pooled_levels_alias_still_works(
    free_tier_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """The legacy /pooled/projects/{id}/levels alias keeps serving the same handler
    (so un-migrated free clients don't break during the migration)."""
    client, _ = free_tier_storage_client
    token = await _free_token(client, session_maker, "lvl-alias@example.com")
    pid = await _create_project(client, token)

    created = await client.post(
        f"/pooled/projects/{pid}/levels",
        json={"name": "Roof", "ordering": 9},
        headers=_auth(token),
    )
    assert created.status_code == 201, created.text
    # The unified canonical path sees the very same row.
    listed = await client.get(f"/projects/{pid}/levels", headers=_auth(token))
    assert listed.status_code == 200
    assert [lvl["name"] for lvl in listed.json()] == ["Roof"]


async def test_paid_user_levels_unchanged_on_unified_path(
    client: AsyncClient,
    org_user: dict[str, str],
) -> None:
    """A paid (org) user still does level CRUD on /projects/{id}/levels."""
    proj = await client.post(
        "/projects", json={"name": "Paid P"}, headers=_auth(org_user["access_token"])
    )
    assert proj.status_code == 201, proj.text
    pid = proj.json()["id"]

    created = await client.post(
        f"/projects/{pid}/levels",
        json={"name": "L1", "elevation_m": 3.0, "ordering": 2},
        headers=_auth(org_user["access_token"]),
    )
    assert created.status_code == 201, created.text
    assert created.json()["project_id"] == pid
    assert created.json()["source"] == "manual"

    listed = await client.get(f"/projects/{pid}/levels", headers=_auth(org_user["access_token"]))
    assert listed.status_code == 200
    assert [lvl["name"] for lvl in listed.json()] == ["L1"]
