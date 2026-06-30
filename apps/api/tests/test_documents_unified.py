"""Phase C — Document CRUD unified onto get_scoped_session.

A free user does container (Document) CRUD on the CANONICAL
`/projects/{id}/documents` path; the legacy `/pooled/projects/{id}/documents`
alias still works (the file-upload flow + viewer bundles + free findings remain
on pooled_documents.router for now); paid is unchanged.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from tests.test_pooled_viewer import _auth, _create_project, _free_token

if TYPE_CHECKING:
    from httpx import AsyncClient
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

    from tests.conftest import FakeStorage


async def test_free_document_crud_via_unified_path(
    free_tier_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    client, _ = free_tier_storage_client
    token = await _free_token(client, session_maker, "doc-free@example.com")
    pid = await _create_project(client, token)

    # CREATE via the canonical /projects path (free branch).
    created = await client.post(
        f"/projects/{pid}/documents",
        json={"name": "House", "discipline": "architectural"},
        headers=_auth(token),
    )
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["name"] == "House"
    assert body["project_id"] == pid
    did = body["id"]

    # LIST via canonical path — free always returns the with-versions shape.
    listed = await client.get(f"/projects/{pid}/documents", headers=_auth(token))
    assert listed.status_code == 200, listed.text
    rows = listed.json()
    assert [d["id"] for d in rows] == [did]
    assert rows[0]["versions"] == []  # with-versions shape, no files yet

    # GET single via canonical path.
    got = await client.get(f"/projects/{pid}/documents/{did}", headers=_auth(token))
    assert got.status_code == 200, got.text
    assert got.json()["id"] == did
    assert "versions" in got.json()

    # PATCH (rename) via canonical path.
    patched = await client.patch(
        f"/projects/{pid}/documents/{did}",
        json={"name": "Woonhuis"},
        headers=_auth(token),
    )
    assert patched.status_code == 200, patched.text
    assert patched.json()["name"] == "Woonhuis"

    # DELETE via canonical path.
    deleted = await client.delete(f"/projects/{pid}/documents/{did}", headers=_auth(token))
    assert deleted.status_code == 204, deleted.text
    assert (await client.get(f"/projects/{pid}/documents", headers=_auth(token))).json() == []


async def test_pooled_documents_alias_still_works(
    free_tier_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    client, _ = free_tier_storage_client
    token = await _free_token(client, session_maker, "doc-alias@example.com")
    pid = await _create_project(client, token)

    # Create via the legacy alias, read back via the canonical path — same row.
    created = await client.post(
        f"/pooled/projects/{pid}/documents",
        json={"name": "Garage", "discipline": "architectural"},
        headers=_auth(token),
    )
    assert created.status_code == 201, created.text
    canonical = await client.get(f"/projects/{pid}/documents", headers=_auth(token))
    assert [d["name"] for d in canonical.json()] == ["Garage"]


async def test_paid_document_crud_unchanged(
    client: AsyncClient,
    org_user: dict[str, str],
) -> None:
    tok = org_user["access_token"]
    proj = await client.post("/projects", json={"name": "Paid"}, headers=_auth(tok))
    assert proj.status_code == 201, proj.text
    pid = proj.json()["id"]

    created = await client.post(
        f"/projects/{pid}/documents",
        json={"name": "Tower", "discipline": "structural"},
        headers=_auth(tok),
    )
    assert created.status_code == 201, created.text
    did = created.json()["id"]

    # Paid light list (no versions) + with-versions opt-in both work.
    light = await client.get(f"/projects/{pid}/documents", headers=_auth(tok))
    assert light.status_code == 200
    assert "versions" not in light.json()[0]
    withv = await client.get(f"/projects/{pid}/documents?include=versions", headers=_auth(tok))
    assert withv.json()[0]["versions"] == []
    assert withv.json()[0]["id"] == did
