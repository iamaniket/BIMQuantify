"""HTTP-level integration tests for project Level CRUD + model level assignment."""

from __future__ import annotations

from uuid import uuid4

from httpx import AsyncClient

from tests.conftest import (
    VALID_IFC_HEADER,
    FakeStorage,
    _add_member,
    _auth,
    _create_document,
    _create_project,
    _new_hash,
)


async def _create_level(
    client: AsyncClient,
    token: str,
    project_id: str,
    name: str = "Ground",
    elevation_m: float | None = None,
    ordering: int | None = None,
) -> dict:
    body: dict[str, object] = {"name": name}
    if elevation_m is not None:
        body["elevation_m"] = elevation_m
    if ordering is not None:
        body["ordering"] = ordering
    resp = await client.post(
        f"/projects/{project_id}/levels", json=body, headers=_auth(token)
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


# ---------------------------------------------------------------------------
# Level CRUD
# ---------------------------------------------------------------------------


async def test_create_level_returns_read_shape(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    project = await _create_project(client, org_user["access_token"])
    body = await _create_level(
        client, org_user["access_token"], project["id"], name="Ground", elevation_m=0.0
    )
    assert body["name"] == "Ground"
    assert body["elevation_m"] == 0.0
    assert body["source"] == "manual"  # user-created
    assert body["project_id"] == project["id"]
    assert "id" in body
    assert "created_at" in body


async def test_create_level_rejects_empty_name(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    project = await _create_project(client, org_user["access_token"])
    resp = await client.post(
        f"/projects/{project['id']}/levels",
        json={"name": ""},
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 422


async def test_create_level_duplicate_name_409(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    project = await _create_project(client, org_user["access_token"])
    await _create_level(client, org_user["access_token"], project["id"], name="Level 1")
    resp = await client.post(
        f"/projects/{project['id']}/levels",
        json={"name": "Level 1"},
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 409
    assert resp.json()["detail"] == "LEVEL_NAME_CONFLICT"


async def test_list_levels_ordered_and_total_count(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    token = org_user["access_token"]
    project = await _create_project(client, token)
    await _create_level(client, token, project["id"], name="Second", ordering=2, elevation_m=6.0)
    await _create_level(client, token, project["id"], name="Ground", ordering=0, elevation_m=0.0)
    await _create_level(client, token, project["id"], name="First", ordering=1, elevation_m=3.0)

    resp = await client.get(f"/projects/{project['id']}/levels", headers=_auth(token))
    assert resp.status_code == 200, resp.text
    assert resp.headers["X-Total-Count"] == "3"
    assert [lvl["name"] for lvl in resp.json()] == ["Ground", "First", "Second"]


async def test_update_level_rename_and_elevation(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    token = org_user["access_token"]
    project = await _create_project(client, token)
    level = await _create_level(client, token, project["id"], name="GF", elevation_m=0.0)
    resp = await client.patch(
        f"/projects/{project['id']}/levels/{level['id']}",
        json={"name": "Ground Floor", "elevation_m": 0.15},
        headers=_auth(token),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["name"] == "Ground Floor"
    assert resp.json()["elevation_m"] == 0.15


async def test_delete_level_204_and_gone(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    token = org_user["access_token"]
    project = await _create_project(client, token)
    level = await _create_level(client, token, project["id"], name="Temp")
    resp = await client.delete(
        f"/projects/{project['id']}/levels/{level['id']}", headers=_auth(token)
    )
    assert resp.status_code == 204
    listing = await client.get(f"/projects/{project['id']}/levels", headers=_auth(token))
    assert listing.json() == []


async def test_create_level_viewer_forbidden(
    client: AsyncClient,
    org_user: dict[str, str],
    same_org_non_admin_user: dict[str, str],
) -> None:
    project = await _create_project(client, org_user["access_token"], name="LvlViewer")
    await _add_member(
        client,
        org_user["access_token"],
        project["id"],
        same_org_non_admin_user["id"],
        "viewer",
    )
    resp = await client.post(
        f"/projects/{project['id']}/levels",
        json={"name": "Nope"},
        headers=_auth(same_org_non_admin_user["access_token"]),
    )
    assert resp.status_code == 403


async def test_levels_cross_org_404(
    client: AsyncClient,
    org_user: dict[str, str],
    other_org_user: dict[str, str],
) -> None:
    project = await _create_project(client, org_user["access_token"])
    resp = await client.get(
        f"/projects/{project['id']}/levels",
        headers=_auth(other_org_user["access_token"]),
    )
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Document <-> Level assignment (via PATCH /documents)
# ---------------------------------------------------------------------------


async def test_assign_level_to_model_succeeds(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    token = org_user["access_token"]
    project = await _create_project(client, token)
    level = await _create_level(client, token, project["id"], name="Ground")
    model = await _create_document(client, token, project["id"], name="GF Plan")

    resp = await client.patch(
        f"/projects/{project['id']}/documents/{model['id']}",
        json={"level_id": level["id"]},
        headers=_auth(token),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["level_id"] == level["id"]

    # And it round-trips through GET.
    got = await client.get(
        f"/projects/{project['id']}/documents/{model['id']}", headers=_auth(token)
    )
    assert got.json()["level_id"] == level["id"]


async def test_assign_level_then_detach(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    token = org_user["access_token"]
    project = await _create_project(client, token)
    level = await _create_level(client, token, project["id"], name="Ground")
    model = await _create_document(client, token, project["id"], name="GF Plan")
    await client.patch(
        f"/projects/{project['id']}/documents/{model['id']}",
        json={"level_id": level["id"]},
        headers=_auth(token),
    )
    resp = await client.patch(
        f"/projects/{project['id']}/documents/{model['id']}",
        json={"level_id": None},
        headers=_auth(token),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["level_id"] is None


async def test_assign_unknown_level_422(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    token = org_user["access_token"]
    project = await _create_project(client, token)
    model = await _create_document(client, token, project["id"])
    resp = await client.patch(
        f"/projects/{project['id']}/documents/{model['id']}",
        json={"level_id": str(uuid4())},
        headers=_auth(token),
    )
    assert resp.status_code == 422
    assert resp.json()["detail"] == "LEVEL_NOT_FOUND"


async def test_assign_level_from_other_project_422(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    token = org_user["access_token"]
    p1 = await _create_project(client, token, name="LP-A")
    p2 = await _create_project(client, token, name="LP-B")
    other_level = await _create_level(client, token, p2["id"], name="Foreign")
    model = await _create_document(client, token, p1["id"])
    resp = await client.patch(
        f"/projects/{p1['id']}/documents/{model['id']}",
        json={"level_id": other_level["id"]},
        headers=_auth(token),
    )
    assert resp.status_code == 422
    assert resp.json()["detail"] == "LEVEL_NOT_FOUND"


async def test_delete_level_detaches_assigned_model(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    token = org_user["access_token"]
    project = await _create_project(client, token)
    level = await _create_level(client, token, project["id"], name="Ground")
    model = await _create_document(client, token, project["id"], name="GF Plan")
    await client.patch(
        f"/projects/{project['id']}/documents/{model['id']}",
        json={"level_id": level["id"]},
        headers=_auth(token),
    )
    # Deleting the level reverts the drawing to Unassigned (FK SET NULL).
    await client.delete(
        f"/projects/{project['id']}/levels/{level['id']}", headers=_auth(token)
    )
    got = await client.get(
        f"/projects/{project['id']}/documents/{model['id']}", headers=_auth(token)
    )
    assert got.json()["level_id"] is None


async def test_assign_level_to_ifc_model_rejected(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    """An IFC model federates across levels — it must not be pinned to one."""
    client, fake = fake_storage_client
    token = org_user["access_token"]
    project = await _create_project(client, token, name="IFCLevel")
    level = await _create_level(client, token, project["id"], name="Ground")
    model = await _create_document(client, token, project["id"], name="Arch IFC")

    # Upload an IFC file so primary_file_type is stamped 'ifc'.
    init = (
        await client.post(
            f"/projects/{project['id']}/documents/{model['id']}/files/initiate",
            json={
                "filename": "m.ifc",
                "size_bytes": len(VALID_IFC_HEADER),
                "content_type": "application/octet-stream",
                "content_sha256": _new_hash(),
            },
            headers=_auth(token),
        )
    ).json()
    fake.objects[init["storage_key"]] = VALID_IFC_HEADER
    await client.post(
        f"/projects/{project['id']}/documents/{model['id']}/files/{init['file_id']}/complete",
        headers=_auth(token),
    )

    resp = await client.patch(
        f"/projects/{project['id']}/documents/{model['id']}",
        json={"level_id": level["id"]},
        headers=_auth(token),
    )
    assert resp.status_code == 422
    assert resp.json()["detail"] == "DOCUMENT_LEVEL_NOT_FOR_IFC"
