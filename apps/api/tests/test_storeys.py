"""HTTP-level tests for the read-only storeys listing."""

from __future__ import annotations

from uuid import uuid4

from httpx import AsyncClient

from tests.conftest import (
    _auth,
    _create_document,
    _create_project,
    _create_storey_row,
)


async def test_list_storeys_empty(client: AsyncClient, org_user: dict[str, str]) -> None:
    project = await _create_project(client, org_user["access_token"])
    model = await _create_document(client, org_user["access_token"], project["id"])
    resp = await client.get(
        f"/projects/{project['id']}/documents/{model['id']}/storeys",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json() == []
    assert resp.headers["X-Total-Count"] == "0"


async def test_list_storeys_sorted_by_floor(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    project = await _create_project(client, org_user["access_token"])
    model = await _create_document(client, org_user["access_token"], project["id"])
    # Insert out of order; expect ascending by `ordering`.
    await _create_storey_row(
        project["id"], model["id"], name="L2", elevation=3.0, ordering=1
    )
    await _create_storey_row(
        project["id"], model["id"], name="L1", elevation=0.0, ordering=0
    )
    await _create_storey_row(
        project["id"], model["id"], name="L3", elevation=6.0, ordering=2
    )
    resp = await client.get(
        f"/projects/{project['id']}/documents/{model['id']}/storeys",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert [s["name"] for s in body] == ["L1", "L2", "L3"]
    assert resp.headers["X-Total-Count"] == "3"
    assert body[0]["document_id"] == model["id"]
    assert body[0]["elevation_m"] == 0.0


async def test_list_storeys_unknown_model_404(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    project = await _create_project(client, org_user["access_token"])
    resp = await client.get(
        f"/projects/{project['id']}/documents/{uuid4()}/storeys",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 404
    assert resp.json()["detail"] == "DOCUMENT_NOT_FOUND"


async def test_list_storeys_other_org_404(
    client: AsyncClient, org_user: dict[str, str], other_org_user: dict[str, str]
) -> None:
    project = await _create_project(client, org_user["access_token"])
    model = await _create_document(client, org_user["access_token"], project["id"])
    await _create_storey_row(project["id"], model["id"], name="L1", ordering=0)
    resp = await client.get(
        f"/projects/{project['id']}/documents/{model['id']}/storeys",
        headers=_auth(other_org_user["access_token"]),
    )
    assert resp.status_code == 404
