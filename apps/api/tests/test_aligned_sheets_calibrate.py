"""HTTP-level tests for the aligned-sheet calibrate endpoint."""

from __future__ import annotations

import math

from httpx import AsyncClient

from tests.conftest import (
    _auth,
    _create_model,
    _create_project,
    _create_storey_row,
    _set_model_primary_file_type,
)


async def _create_sheet(client: AsyncClient, token: str, project: dict) -> str:
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
    resp = await client.post(
        f"/projects/{project['id']}/aligned-sheets",
        json={
            "model_id": model3d["id"],
            "storey_id": storey_id,
            "pdf_model_id": pdf_model["id"],
            "page_index": 0,
        },
        headers=_auth(token),
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


async def test_calibrate_persists_transform(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    project = await _create_project(client, org_user["access_token"])
    sheet_id = await _create_sheet(client, org_user["access_token"], project)

    # scale 2, no rotation, translate to (10, 20).
    resp = await client.post(
        f"/projects/{project['id']}/aligned-sheets/{sheet_id}/calibrate",
        json={
            "pdf_points": [[0.0, 0.0], [1.0, 0.0]],
            "plan_points": [[10.0, 20.0], [12.0, 20.0]],
        },
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["is_calibrated"] is True
    assert math.isclose(body["scale"], 2.0, abs_tol=1e-9)
    assert math.isclose(body["rotation_rad"], 0.0, abs_tol=1e-9)
    assert math.isclose(body["offset_x"], 10.0, abs_tol=1e-9)
    assert math.isclose(body["offset_y"], 20.0, abs_tol=1e-9)
    assert body["control_points"]["pdf"] == [[0.0, 0.0], [1.0, 0.0]]
    assert body["control_points"]["plan"] == [[10.0, 20.0], [12.0, 20.0]]


async def test_calibrate_degenerate_points_422(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    project = await _create_project(client, org_user["access_token"])
    sheet_id = await _create_sheet(client, org_user["access_token"], project)
    resp = await client.post(
        f"/projects/{project['id']}/aligned-sheets/{sheet_id}/calibrate",
        json={
            "pdf_points": [[0.0, 0.0], [0.0, 0.0]],  # coincident
            "plan_points": [[10.0, 20.0], [12.0, 20.0]],
        },
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 422
    assert resp.json()["detail"] == "ALIGNED_SHEET_DEGENERATE_POINTS"


async def test_calibrate_wrong_point_count_422(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    project = await _create_project(client, org_user["access_token"])
    sheet_id = await _create_sheet(client, org_user["access_token"], project)
    resp = await client.post(
        f"/projects/{project['id']}/aligned-sheets/{sheet_id}/calibrate",
        json={
            "pdf_points": [[0.0, 0.0]],  # only one
            "plan_points": [[10.0, 20.0], [12.0, 20.0]],
        },
        headers=_auth(org_user["access_token"]),
    )
    # Pydantic schema validation (min_length=2) → 422 before the route body.
    assert resp.status_code == 422
