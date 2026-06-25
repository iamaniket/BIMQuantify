"""Storey -> project Level reconciliation during IFC extraction (Phase 2)."""

from __future__ import annotations

from typing import TYPE_CHECKING

from tests.conftest import (
    FakeStorage,
    _auth,
    _create_document,
    _set_document_primary_file_type,
)
from tests.test_project_files_extraction import _complete_ready_ifc, _ready_file
from tests.test_storey_ingest import _list_storeys, _storey, _succeed_with_storeys

if TYPE_CHECKING:
    from httpx import AsyncClient

GUID_A = "0123456789ABCDEFGHIJKA"
GUID_B = "0123456789ABCDEFGHIJKB"
GUID_C = "0123456789ABCDEFGHIJKC"


async def _list_levels(
    client: AsyncClient, org_user: dict[str, str], project_id: str
) -> list[dict]:
    resp = await client.get(
        f"/projects/{project_id}/levels", headers=_auth(org_user["access_token"])
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


async def test_extraction_creates_levels_and_links_storeys(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, fake = fake_storage_client
    project_id, document_id, file_id = await _ready_file(client, fake, org_user, name="rl1.ifc")
    await _succeed_with_storeys(
        client,
        org_user,
        file_id,
        [_storey(9, GUID_A, "Level 1", 0.0), _storey(10, GUID_B, "Level 2", 3.0)],
    )

    levels = await _list_levels(client, org_user, project_id)
    assert [lvl["name"] for lvl in levels] == ["Level 1", "Level 2"]
    assert all(lvl["source"] == "ifc" for lvl in levels)

    storeys = await _list_storeys(client, org_user, project_id, document_id)
    level_by_name = {lvl["name"]: lvl["id"] for lvl in levels}
    storey_by_name = {s["name"]: s for s in storeys}
    assert storey_by_name["Level 1"]["level_id"] == level_by_name["Level 1"]
    assert storey_by_name["Level 2"]["level_id"] == level_by_name["Level 2"]


async def test_reextraction_does_not_duplicate_levels(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, fake = fake_storage_client
    project_id, document_id, file_id = await _ready_file(client, fake, org_user, name="rl2.ifc")
    await _succeed_with_storeys(
        client, org_user, file_id, [_storey(9, GUID_A, "Level 1", 0.0)]
    )
    first = await _list_levels(client, org_user, project_id)
    assert len(first) == 1

    file2 = await _complete_ready_ifc(
        client, fake, org_user, project_id, document_id, name="rl2-v2.ifc", sha256="c" * 64
    )
    await _succeed_with_storeys(
        client, org_user, file2, [_storey(9, GUID_A, "Level 1", 0.0)]
    )
    second = await _list_levels(client, org_user, project_id)
    assert len(second) == 1
    assert second[0]["id"] == first[0]["id"]


async def test_two_disciplines_share_one_level_per_floor(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    """Arch + structural storeys at the same elevation converge on one level."""
    client, fake = fake_storage_client
    project_id, arch_id, arch_file = await _ready_file(
        client, fake, org_user, name="arch.ifc"
    )
    await _succeed_with_storeys(
        client,
        org_user,
        arch_file,
        [_storey(9, GUID_A, "Level 1", 0.0), _storey(10, GUID_B, "Level 2", 3.0)],
    )

    # Second discipline (separate model) at the SAME elevations, different names/guids.
    struct = await client.post(
        f"/projects/{project_id}/documents",
        json={"name": "Structural", "discipline": "structural"},
        headers=_auth(org_user["access_token"]),
    )
    struct_id = struct.json()["id"]
    struct_file = await _complete_ready_ifc(
        client, fake, org_user, project_id, struct_id, name="struct.ifc", sha256="d" * 64
    )
    await _succeed_with_storeys(
        client,
        org_user,
        struct_file,
        [_storey(20, "S123456789ABCDEFGHIJKA", "00 Begane grond", 0.02),
         _storey(21, "S123456789ABCDEFGHIJKB", "01 Verdieping", 3.01)],
    )

    # Still exactly two project levels (one per floor), not four.
    levels = await _list_levels(client, org_user, project_id)
    assert len(levels) == 2

    arch_storeys = await _list_storeys(client, org_user, project_id, arch_id)
    struct_storeys = await _list_storeys(client, org_user, project_id, struct_id)
    arch_ground = next(s for s in arch_storeys if s["elevation_m"] == 0.0)
    struct_ground = next(s for s in struct_storeys if s["elevation_m"] == 0.02)
    # Both ground storeys reconcile onto the same shared level.
    assert arch_ground["level_id"] == struct_ground["level_id"]


async def test_extraction_reuses_matching_manual_level(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    """A manual level at a matching elevation is reused, not duplicated."""
    client, fake = fake_storage_client
    project_id, document_id, file_id = await _ready_file(client, fake, org_user, name="rl4.ifc")

    manual = await client.post(
        f"/projects/{project_id}/levels",
        json={"name": "Ground", "elevation_m": 0.0},
        headers=_auth(org_user["access_token"]),
    )
    manual_id = manual.json()["id"]

    await _succeed_with_storeys(
        client, org_user, file_id, [_storey(9, GUID_A, "Level 0", 0.01)]
    )

    levels = await _list_levels(client, org_user, project_id)
    assert len(levels) == 1  # reused the manual level, no ifc duplicate
    assert levels[0]["id"] == manual_id
    assert levels[0]["source"] == "manual"

    storeys = await _list_storeys(client, org_user, project_id, document_id)
    assert storeys[0]["level_id"] == manual_id


async def test_aligned_sheet_survives_storey_pruning(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    """A sheet pins to the Level, so re-extraction pruning its storey is harmless."""
    client, fake = fake_storage_client
    token = org_user["access_token"]
    project_id, document_id, file_id = await _ready_file(client, fake, org_user, name="surv.ifc")
    await _succeed_with_storeys(
        client, org_user, file_id, [_storey(9, GUID_A, "Level 1", 0.0)]
    )
    level_id = (await _list_levels(client, org_user, project_id))[0]["id"]

    pdf_model = await _create_document(client, token, project_id, name="Drawings", discipline="other")
    await _set_document_primary_file_type(project_id, pdf_model["id"], "pdf")
    sheet = await client.post(
        f"/projects/{project_id}/aligned-sheets",
        json={
            "document_id": document_id,
            "level_id": level_id,
            "pdf_document_id": pdf_model["id"],
            "page_index": 0,
        },
        headers=_auth(token),
    )
    assert sheet.status_code == 201, sheet.text
    sheet_id = sheet.json()["id"]

    # Re-extract with the original storey gone (replaced by a different floor).
    file2 = await _complete_ready_ifc(
        client, fake, org_user, project_id, document_id, name="surv-v2.ifc", sha256="e" * 64
    )
    await _succeed_with_storeys(
        client, org_user, file2, [_storey(10, GUID_B, "Level 2", 3.0)]
    )

    # The sheet still exists and still points at the (persistent) level.
    got = await client.get(
        f"/projects/{project_id}/aligned-sheets/{sheet_id}", headers=_auth(token)
    )
    assert got.status_code == 200, got.text
    assert got.json()["level_id"] == level_id
