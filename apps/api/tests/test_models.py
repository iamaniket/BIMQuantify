"""HTTP-level integration tests for Model CRUD."""

from __future__ import annotations

from uuid import uuid4

from httpx import AsyncClient

from tests.conftest import (
    VALID_IFC_HEADER,
    FakeStorage,
    _add_member,
    _auth,
    _create_model,
    _create_project,
)


async def test_create_model_returns_read_shape(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    project = await _create_project(client, org_user["access_token"])
    resp = await client.post(
        f"/projects/{project['id']}/models",
        json={"name": "Tower A", "discipline": "architectural"},
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["name"] == "Tower A"
    assert body["discipline"] == "architectural"
    assert body["status"] == "active"  # default
    assert body["project_id"] == project["id"]
    assert "id" in body
    assert "created_at" in body
    assert "updated_at" in body


async def test_create_model_default_status_is_active(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    project = await _create_project(client, org_user["access_token"])
    body = await _create_model(client, org_user["access_token"], project["id"], name="Defaults")
    assert body["status"] == "active"


async def test_create_model_explicit_status_draft(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    project = await _create_project(client, org_user["access_token"])
    body = await _create_model(
        client,
        org_user["access_token"],
        project["id"],
        name="Drafty",
        status="draft",
    )
    assert body["status"] == "draft"


async def test_create_model_rejects_unknown_discipline(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    project = await _create_project(client, org_user["access_token"])
    resp = await client.post(
        f"/projects/{project['id']}/models",
        json={"name": "Bad", "discipline": "electrical"},
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 422


async def test_create_model_rejects_empty_name(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    project = await _create_project(client, org_user["access_token"])
    resp = await client.post(
        f"/projects/{project['id']}/models",
        json={"name": "", "discipline": "architectural"},
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 422


async def test_create_model_duplicate_name_in_same_project_409(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    project = await _create_project(client, org_user["access_token"])
    await _create_model(client, org_user["access_token"], project["id"], name="Same")
    resp = await client.post(
        f"/projects/{project['id']}/models",
        json={"name": "Same", "discipline": "structural"},
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 409
    assert resp.json()["detail"] == "MODEL_NAME_CONFLICT"


async def test_create_model_duplicate_name_different_projects_ok(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    p1 = await _create_project(client, org_user["access_token"], name="P-A")
    p2 = await _create_project(client, org_user["access_token"], name="P-B")
    await _create_model(client, org_user["access_token"], p1["id"], name="Shared")
    resp = await client.post(
        f"/projects/{p2['id']}/models",
        json={"name": "Shared", "discipline": "architectural"},
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 201


async def test_create_model_viewer_forbidden(
    client: AsyncClient,
    org_user: dict[str, str],
    same_org_user: dict[str, str],
) -> None:
    project = await _create_project(client, org_user["access_token"], name="ViewerCant")
    await _add_member(
        client,
        org_user["access_token"],
        project["id"],
        same_org_user["id"],
        "viewer",
    )
    resp = await client.post(
        f"/projects/{project['id']}/models",
        json={"name": "Nope", "discipline": "architectural"},
        headers=_auth(same_org_user["access_token"]),
    )
    assert resp.status_code == 403


async def test_list_models_empty(client: AsyncClient, org_user: dict[str, str]) -> None:
    project = await _create_project(client, org_user["access_token"])
    resp = await client.get(
        f"/projects/{project['id']}/models",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 200
    assert resp.json() == []


async def test_list_models_filters_by_status_and_discipline(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    project = await _create_project(client, org_user["access_token"])
    await _create_model(
        client,
        org_user["access_token"],
        project["id"],
        name="A",
        discipline="architectural",
    )
    await _create_model(
        client,
        org_user["access_token"],
        project["id"],
        name="S",
        discipline="structural",
        status="archived",
    )
    await _create_model(
        client,
        org_user["access_token"],
        project["id"],
        name="M",
        discipline="mep",
    )

    arch = await client.get(
        f"/projects/{project['id']}/models?discipline=architectural",
        headers=_auth(org_user["access_token"]),
    )
    assert [m["name"] for m in arch.json()] == ["A"]

    archived = await client.get(
        f"/projects/{project['id']}/models?status=archived",
        headers=_auth(org_user["access_token"]),
    )
    assert [m["name"] for m in archived.json()] == ["S"]


async def test_get_model_404_for_unknown_id(client: AsyncClient, org_user: dict[str, str]) -> None:
    project = await _create_project(client, org_user["access_token"])
    resp = await client.get(
        f"/projects/{project['id']}/models/{uuid4()}",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 404


async def test_get_model_includes_versions_ordered_desc(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, fake = fake_storage_client
    project = await _create_project(client, org_user["access_token"], name="VersionedP")
    model = await _create_model(client, org_user["access_token"], project["id"], name="Versioned")

    # Upload v1 + v2.
    for _ in range(2):
        init = (
            await client.post(
                f"/projects/{project['id']}/models/{model['id']}/files/initiate",
                json={
                    "filename": "v.ifc",
                    "size_bytes": len(VALID_IFC_HEADER),
                    "content_type": "application/octet-stream",
                },
                headers=_auth(org_user["access_token"]),
            )
        ).json()
        fake.objects[init["storage_key"]] = VALID_IFC_HEADER
        await client.post(
            f"/projects/{project['id']}/models/{model['id']}/files/{init['file_id']}/complete",
            headers=_auth(org_user["access_token"]),
        )

    resp = await client.get(
        f"/projects/{project['id']}/models/{model['id']}",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    versions = body["versions"]
    assert [v["version_number"] for v in versions] == [2, 1]


async def test_patch_model_owner_succeeds(client: AsyncClient, org_user: dict[str, str]) -> None:
    project = await _create_project(client, org_user["access_token"])
    model = await _create_model(client, org_user["access_token"], project["id"])
    resp = await client.patch(
        f"/projects/{project['id']}/models/{model['id']}",
        json={"status": "archived"},
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "archived"


async def test_patch_model_editor_succeeds(
    client: AsyncClient,
    org_user: dict[str, str],
    same_org_user: dict[str, str],
) -> None:
    project = await _create_project(client, org_user["access_token"], name="EditorPatch")
    model = await _create_model(client, org_user["access_token"], project["id"])
    await _add_member(
        client,
        org_user["access_token"],
        project["id"],
        same_org_user["id"],
        "editor",
    )
    resp = await client.patch(
        f"/projects/{project['id']}/models/{model['id']}",
        json={"name": "Renamed"},
        headers=_auth(same_org_user["access_token"]),
    )
    assert resp.status_code == 200
    assert resp.json()["name"] == "Renamed"


async def test_patch_model_viewer_forbidden(
    client: AsyncClient,
    org_user: dict[str, str],
    same_org_user: dict[str, str],
) -> None:
    project = await _create_project(client, org_user["access_token"], name="ViewerPatch")
    model = await _create_model(client, org_user["access_token"], project["id"])
    await _add_member(
        client,
        org_user["access_token"],
        project["id"],
        same_org_user["id"],
        "viewer",
    )
    resp = await client.patch(
        f"/projects/{project['id']}/models/{model['id']}",
        json={"name": "Nope"},
        headers=_auth(same_org_user["access_token"]),
    )
    assert resp.status_code == 403


async def test_delete_model_owner_only(
    client: AsyncClient,
    org_user: dict[str, str],
    same_org_user: dict[str, str],
) -> None:
    project = await _create_project(client, org_user["access_token"], name="DelM")
    model = await _create_model(client, org_user["access_token"], project["id"])
    await _add_member(
        client,
        org_user["access_token"],
        project["id"],
        same_org_user["id"],
        "editor",
    )

    by_editor = await client.delete(
        f"/projects/{project['id']}/models/{model['id']}",
        headers=_auth(same_org_user["access_token"]),
    )
    assert by_editor.status_code == 403

    by_owner = await client.delete(
        f"/projects/{project['id']}/models/{model['id']}",
        headers=_auth(org_user["access_token"]),
    )
    assert by_owner.status_code == 204


async def test_delete_model_cascades_files(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, fake = fake_storage_client
    project = await _create_project(client, org_user["access_token"], name="DelCascade")
    model = await _create_model(client, org_user["access_token"], project["id"])
    init = (
        await client.post(
            f"/projects/{project['id']}/models/{model['id']}/files/initiate",
            json={
                "filename": "cascade.ifc",
                "size_bytes": len(VALID_IFC_HEADER),
                "content_type": "application/octet-stream",
            },
            headers=_auth(org_user["access_token"]),
        )
    ).json()
    fake.objects[init["storage_key"]] = VALID_IFC_HEADER

    resp = await client.delete(
        f"/projects/{project['id']}/models/{model['id']}",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 204
    assert init["storage_key"] in fake.deleted

    # Subsequent GET on the model returns 404.
    follow = await client.get(
        f"/projects/{project['id']}/models/{model['id']}",
        headers=_auth(org_user["access_token"]),
    )
    assert follow.status_code == 404


async def test_non_member_gets_404(
    client: AsyncClient,
    org_user: dict[str, str],
    same_org_user: dict[str, str],
) -> None:
    project = await _create_project(client, org_user["access_token"], name="HiddenM")
    model = await _create_model(client, org_user["access_token"], project["id"])
    resp = await client.get(
        f"/projects/{project['id']}/models/{model['id']}",
        headers=_auth(same_org_user["access_token"]),
    )
    # Non-member same-org returns 404 from project-level membership check.
    assert resp.status_code == 404


async def test_cross_org_returns_404(
    client: AsyncClient,
    org_user: dict[str, str],
    other_org_user: dict[str, str],
) -> None:
    project = await _create_project(client, org_user["access_token"])
    model = await _create_model(client, org_user["access_token"], project["id"])
    resp = await client.get(
        f"/projects/{project['id']}/models/{model['id']}",
        headers=_auth(other_org_user["access_token"]),
    )
    assert resp.status_code == 404
