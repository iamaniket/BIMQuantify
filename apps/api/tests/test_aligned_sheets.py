"""HTTP-level tests for aligned-sheet CRUD."""

from __future__ import annotations

from httpx import AsyncClient

from tests.conftest import (
    _add_member,
    _auth,
    _create_model,
    _create_project,
    _create_storey_row,
    _set_model_primary_file_type,
)


async def _setup(
    client: AsyncClient, token: str, project: dict
) -> tuple[dict, str, dict]:
    """Create a 3D model + a storey on it + a PDF model. Returns
    (model_3d, storey_id, pdf_model)."""
    model3d = await _create_model(
        client, token, project["id"], name="Arch", discipline="architectural"
    )
    storey_id = await _create_storey_row(
        project["id"], model3d["id"], name="Level 1", elevation=0.0, ordering=0
    )
    pdf_model = await _create_model(
        client, token, project["id"], name="Drawings", discipline="other"
    )
    await _set_model_primary_file_type(project["id"], pdf_model["id"], "pdf")
    return model3d, storey_id, pdf_model


def _payload(model3d: dict, storey_id: str, pdf_model: dict, page: int = 0) -> dict:
    return {
        "model_id": model3d["id"],
        "storey_id": storey_id,
        "pdf_model_id": pdf_model["id"],
        "page_index": page,
    }


async def test_create_aligned_sheet_uncalibrated(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    project = await _create_project(client, org_user["access_token"])
    model3d, storey_id, pdf_model = await _setup(client, org_user["access_token"], project)
    resp = await client.post(
        f"/projects/{project['id']}/aligned-sheets",
        json=_payload(model3d, storey_id, pdf_model),
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["model_id"] == model3d["id"]
    assert body["storey_id"] == storey_id
    assert body["pdf_model_id"] == pdf_model["id"]
    assert body["page_index"] == 0
    assert body["transform_type"] == "similarity_2d"
    assert body["is_calibrated"] is False
    assert body["scale"] is None
    assert body["control_points"] is None


async def test_create_rejects_non_pdf_model(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    project = await _create_project(client, org_user["access_token"])
    model3d, storey_id, _pdf = await _setup(client, org_user["access_token"], project)
    # A second architectural model (primary_file_type stays None) is not a PDF model.
    not_pdf = await _create_model(
        client, org_user["access_token"], project["id"], name="NotPdf", discipline="structural"
    )
    resp = await client.post(
        f"/projects/{project['id']}/aligned-sheets",
        json=_payload(model3d, storey_id, not_pdf),
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 422
    assert resp.json()["detail"] == "ALIGNED_SHEET_PDF_MODEL_INVALID"


async def test_create_rejects_storey_from_other_model(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    project = await _create_project(client, org_user["access_token"])
    model3d, _storey, pdf_model = await _setup(client, org_user["access_token"], project)
    other_model = await _create_model(
        client, org_user["access_token"], project["id"], name="Other", discipline="structural"
    )
    other_storey = await _create_storey_row(
        project["id"], other_model["id"], name="X", ordering=0
    )
    resp = await client.post(
        f"/projects/{project['id']}/aligned-sheets",
        json=_payload(model3d, other_storey, pdf_model),
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 422
    assert resp.json()["detail"] == "ALIGNED_SHEET_STOREY_MODEL_MISMATCH"


async def test_create_duplicate_conflict(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    project = await _create_project(client, org_user["access_token"])
    model3d, storey_id, pdf_model = await _setup(client, org_user["access_token"], project)
    first = await client.post(
        f"/projects/{project['id']}/aligned-sheets",
        json=_payload(model3d, storey_id, pdf_model),
        headers=_auth(org_user["access_token"]),
    )
    assert first.status_code == 201, first.text
    dup = await client.post(
        f"/projects/{project['id']}/aligned-sheets",
        json=_payload(model3d, storey_id, pdf_model),
        headers=_auth(org_user["access_token"]),
    )
    assert dup.status_code == 409
    assert dup.json()["detail"] == "ALIGNED_SHEET_DUPLICATE"


async def test_create_same_storey_different_page_ok(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    project = await _create_project(client, org_user["access_token"])
    model3d, storey_id, pdf_model = await _setup(client, org_user["access_token"], project)
    a = await client.post(
        f"/projects/{project['id']}/aligned-sheets",
        json=_payload(model3d, storey_id, pdf_model, page=0),
        headers=_auth(org_user["access_token"]),
    )
    b = await client.post(
        f"/projects/{project['id']}/aligned-sheets",
        json=_payload(model3d, storey_id, pdf_model, page=1),
        headers=_auth(org_user["access_token"]),
    )
    assert a.status_code == 201
    assert b.status_code == 201


async def test_list_get_and_filter(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    project = await _create_project(client, org_user["access_token"])
    model3d, storey_id, pdf_model = await _setup(client, org_user["access_token"], project)
    created = (
        await client.post(
            f"/projects/{project['id']}/aligned-sheets",
            json=_payload(model3d, storey_id, pdf_model),
            headers=_auth(org_user["access_token"]),
        )
    ).json()

    listing = await client.get(
        f"/projects/{project['id']}/aligned-sheets",
        params={"storey_id": storey_id},
        headers=_auth(org_user["access_token"]),
    )
    assert listing.status_code == 200
    assert [s["id"] for s in listing.json()] == [created["id"]]
    assert listing.headers["X-Total-Count"] == "1"

    one = await client.get(
        f"/projects/{project['id']}/aligned-sheets/{created['id']}",
        headers=_auth(org_user["access_token"]),
    )
    assert one.status_code == 200
    assert one.json()["id"] == created["id"]


async def test_patch_page_index(client: AsyncClient, org_user: dict[str, str]) -> None:
    project = await _create_project(client, org_user["access_token"])
    model3d, storey_id, pdf_model = await _setup(client, org_user["access_token"], project)
    created = (
        await client.post(
            f"/projects/{project['id']}/aligned-sheets",
            json=_payload(model3d, storey_id, pdf_model),
            headers=_auth(org_user["access_token"]),
        )
    ).json()
    resp = await client.patch(
        f"/projects/{project['id']}/aligned-sheets/{created['id']}",
        json={"page_index": 3},
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["page_index"] == 3


async def test_delete_soft(client: AsyncClient, org_user: dict[str, str]) -> None:
    project = await _create_project(client, org_user["access_token"])
    model3d, storey_id, pdf_model = await _setup(client, org_user["access_token"], project)
    created = (
        await client.post(
            f"/projects/{project['id']}/aligned-sheets",
            json=_payload(model3d, storey_id, pdf_model),
            headers=_auth(org_user["access_token"]),
        )
    ).json()
    delete = await client.delete(
        f"/projects/{project['id']}/aligned-sheets/{created['id']}",
        headers=_auth(org_user["access_token"]),
    )
    assert delete.status_code == 204
    gone = await client.get(
        f"/projects/{project['id']}/aligned-sheets/{created['id']}",
        headers=_auth(org_user["access_token"]),
    )
    assert gone.status_code == 404


async def test_create_viewer_forbidden(
    client: AsyncClient,
    org_user: dict[str, str],
    same_org_non_admin_user: dict[str, str],
) -> None:
    project = await _create_project(client, org_user["access_token"])
    await _add_member(
        client,
        org_user["access_token"],
        project["id"],
        same_org_non_admin_user["id"],
        "viewer",
    )
    model3d, storey_id, pdf_model = await _setup(client, org_user["access_token"], project)
    resp = await client.post(
        f"/projects/{project['id']}/aligned-sheets",
        json=_payload(model3d, storey_id, pdf_model),
        headers=_auth(same_org_non_admin_user["access_token"]),
    )
    assert resp.status_code == 403
