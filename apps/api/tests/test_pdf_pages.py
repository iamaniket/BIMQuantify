"""pdf_pages: ingest find-or-create + never-delete, alignment page resolution,
finding anchor normalization, and the calibration drift (is_stale) flag."""

from __future__ import annotations

from typing import TYPE_CHECKING

from tests.conftest import (
    _auth,
    _create_document,
    _create_pdf_file_row,
    _create_project,
    _pdf_page_numbers,
    _set_document_primary_file_type,
)
from tests.test_project_files_extraction import _bearer

if TYPE_CHECKING:
    from httpx import AsyncClient

    from tests.conftest import FakeStorage


async def _create_level(
    client: AsyncClient, token: str, project_id: str, name: str = "Level 1"
) -> str:
    resp = await client.post(
        f"/projects/{project_id}/levels",
        json={"name": name, "elevation_m": 0.0},
        headers=_auth(token),
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


async def _pdf_model(
    client: AsyncClient, token: str, project_id: str, name: str = "Drawings"
) -> dict:
    model = await _create_document(client, token, project_id, name=name, discipline="other")
    await _set_document_primary_file_type(project_id, model["id"], "pdf")
    return model


async def _succeed_pdf(
    client: AsyncClient, org_user: dict[str, str], file_id: str, page_count: int | None
) -> None:
    body: dict[str, object] = {
        "file_id": file_id,
        "organization_id": org_user["organization_id"],
        "status": "succeeded",
    }
    if page_count is not None:
        body["page_count"] = page_count
    cb = await client.post("/internal/jobs/callback", json=body, headers=_bearer())
    assert cb.status_code == 200, cb.text


# --- ingest: callback materializes logical pages ----------------------------


async def test_callback_creates_pdf_pages(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, _fake = fake_storage_client
    project = await _create_project(client, org_user["access_token"])
    pdf = await _pdf_model(client, org_user["access_token"], project["id"])
    file_id = await _create_pdf_file_row(project["id"], pdf["id"], uploaded_by=org_user["id"])
    await _succeed_pdf(client, org_user, file_id, 3)
    assert await _pdf_page_numbers(project["id"], pdf["id"]) == [1, 2, 3]


async def test_ifc_callback_creates_no_pages(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    """An IFC extraction (no page_count) must not create pdf_pages."""
    from tests.test_project_files_extraction import _ready_file

    client, fake = fake_storage_client
    project_id, document_id, file_id = await _ready_file(client, fake, org_user, name="np.ifc")
    await _succeed_pdf(client, org_user, file_id, None)
    assert await _pdf_page_numbers(project_id, document_id) == []


async def test_reextraction_more_pages_adds_only_new(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, _fake = fake_storage_client
    project = await _create_project(client, org_user["access_token"])
    pdf = await _pdf_model(client, org_user["access_token"], project["id"])
    f1 = await _create_pdf_file_row(
        project["id"], pdf["id"], uploaded_by=org_user["id"], version_number=1
    )
    await _succeed_pdf(client, org_user, f1, 2)
    assert await _pdf_page_numbers(project["id"], pdf["id"]) == [1, 2]
    f2 = await _create_pdf_file_row(
        project["id"], pdf["id"], uploaded_by=org_user["id"], version_number=2
    )
    await _succeed_pdf(client, org_user, f2, 4)
    assert await _pdf_page_numbers(project["id"], pdf["id"]) == [1, 2, 3, 4]


async def test_reextraction_fewer_pages_never_deletes(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, _fake = fake_storage_client
    project = await _create_project(client, org_user["access_token"])
    pdf = await _pdf_model(client, org_user["access_token"], project["id"])
    f1 = await _create_pdf_file_row(
        project["id"], pdf["id"], uploaded_by=org_user["id"], version_number=1
    )
    await _succeed_pdf(client, org_user, f1, 4)
    f2 = await _create_pdf_file_row(
        project["id"], pdf["id"], uploaded_by=org_user["id"], version_number=2
    )
    await _succeed_pdf(client, org_user, f2, 2)
    # All four survive — pages are never soft-deleted (drift, not deletion).
    assert await _pdf_page_numbers(project["id"], pdf["id"]) == [1, 2, 3, 4]


async def test_callback_idempotent(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, _fake = fake_storage_client
    project = await _create_project(client, org_user["access_token"])
    pdf = await _pdf_model(client, org_user["access_token"], project["id"])
    f1 = await _create_pdf_file_row(
        project["id"], pdf["id"], uploaded_by=org_user["id"], version_number=1
    )
    await _succeed_pdf(client, org_user, f1, 3)
    f2 = await _create_pdf_file_row(
        project["id"], pdf["id"], uploaded_by=org_user["id"], version_number=2
    )
    await _succeed_pdf(client, org_user, f2, 3)  # same count → no duplicates
    assert await _pdf_page_numbers(project["id"], pdf["id"]) == [1, 2, 3]


# --- alignment: page_index resolves to a logical page -----------------------


async def test_create_resolves_page_find_or_create(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    token = org_user["access_token"]
    project = await _create_project(client, token)
    model3d = await _create_document(
        client, token, project["id"], name="Arch", discipline="architectural"
    )
    level_id = await _create_level(client, token, project["id"])
    pdf = await _pdf_model(client, token, project["id"])
    resp = await client.post(
        f"/projects/{project['id']}/aligned-sheets",
        json={
            "document_id": model3d["id"],
            "level_id": level_id,
            "pdf_document_id": pdf["id"],
            "page_index": 2,
        },
        headers=_auth(token),
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["page_index"] == 2
    assert body["page_number"] == 3
    assert body["page_id"]
    assert body["is_stale"] is False
    # Only page 3 created (not 1/2) — pages are created on demand.
    assert await _pdf_page_numbers(project["id"], pdf["id"]) == [3]


async def test_two_sheets_same_page_reuse_one_page(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    token = org_user["access_token"]
    project = await _create_project(client, token)
    model3d = await _create_document(
        client, token, project["id"], name="Arch", discipline="architectural"
    )
    level_a = await _create_level(client, token, project["id"], name="L1")
    level_b = await _create_level(client, token, project["id"], name="L2")
    pdf = await _pdf_model(client, token, project["id"])
    base = {"document_id": model3d["id"], "pdf_document_id": pdf["id"], "page_index": 0}
    a = await client.post(
        f"/projects/{project['id']}/aligned-sheets",
        json={**base, "level_id": level_a},
        headers=_auth(token),
    )
    b = await client.post(
        f"/projects/{project['id']}/aligned-sheets",
        json={**base, "level_id": level_b},
        headers=_auth(token),
    )
    assert a.status_code == 201, a.text
    assert b.status_code == 201, b.text
    assert a.json()["page_id"] == b.json()["page_id"]
    assert await _pdf_page_numbers(project["id"], pdf["id"]) == [1]


# --- drift flag -------------------------------------------------------------


async def test_is_stale_flips_on_new_version(client: AsyncClient, org_user: dict[str, str]) -> None:
    token = org_user["access_token"]
    project = await _create_project(client, token)
    model3d = await _create_document(
        client, token, project["id"], name="Arch", discipline="architectural"
    )
    level_id = await _create_level(client, token, project["id"])
    pdf = await _pdf_model(client, token, project["id"])
    v1 = await _create_pdf_file_row(
        project["id"], pdf["id"], uploaded_by=org_user["id"], version_number=1
    )
    sheet = (
        await client.post(
            f"/projects/{project['id']}/aligned-sheets",
            json={
                "document_id": model3d["id"],
                "level_id": level_id,
                "pdf_document_id": pdf["id"],
                "page_index": 0,
            },
            headers=_auth(token),
        )
    ).json()
    cal = await client.post(
        f"/projects/{project['id']}/aligned-sheets/{sheet['id']}/calibrate",
        json={
            "pdf_points": [[0.0, 0.0], [1.0, 0.0]],
            "plan_points": [[0.0, 0.0], [1.0, 0.0]],
            "pdf_file_id": v1,
        },
        headers=_auth(token),
    )
    assert cal.status_code == 200, cal.text
    assert cal.json()["is_stale"] is False  # v1 is still the head
    # A newer ready version reclaims the head → the calibration has drifted.
    await _create_pdf_file_row(
        project["id"], pdf["id"], uploaded_by=org_user["id"], version_number=2
    )
    got = await client.get(
        f"/projects/{project['id']}/aligned-sheets/{sheet['id']}",
        headers=_auth(token),
    )
    assert got.status_code == 200, got.text
    assert got.json()["is_stale"] is True


# --- findings: anchor_page_id normalization ---------------------------------


async def test_finding_pdf_anchor_resolves_page_id(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    token = org_user["access_token"]
    project = await _create_project(client, token)
    pdf = await _pdf_model(client, token, project["id"])
    pdf_file = await _create_pdf_file_row(project["id"], pdf["id"], uploaded_by=org_user["id"])
    resp = await client.post(
        f"/projects/{project['id']}/findings",
        json={
            "title": "Crack",
            "description": "Hairline crack on the ground-floor plan.",
            "linked_file_type": "pdf",
            "linked_file_id": pdf_file,
            "anchor_page": 2,
            "anchor_x": 0.5,
            "anchor_y": 0.5,
        },
        headers=_auth(token),
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["anchor_page_id"] is not None
    # anchor_page is 1-indexed and maps straight to page_number.
    assert await _pdf_page_numbers(project["id"], pdf["id"]) == [2]


async def test_finding_image_anchor_has_no_page_id(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    token = org_user["access_token"]
    project = await _create_project(client, token)
    resp = await client.post(
        f"/projects/{project['id']}/findings",
        json={
            "title": "Photo note",
            "description": "Marked on a site photo, not a drawing.",
            "linked_file_type": "image",
            "anchor_x": 0.5,
            "anchor_y": 0.5,
        },
        headers=_auth(token),
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["anchor_page_id"] is None
