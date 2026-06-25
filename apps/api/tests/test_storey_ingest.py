"""Storey ingest from the IFC extraction callback (idempotent upsert)."""

from __future__ import annotations

from typing import TYPE_CHECKING

from tests.conftest import (
    FakeStorage,
    _auth,
)
from tests.test_project_files_extraction import _bearer, _complete_ready_ifc, _ready_file

if TYPE_CHECKING:
    from httpx import AsyncClient

# 22-char strings (IfcBuildingStorey.GlobalId width; Storey.ifc_guid is VARCHAR(22)).
GUID_A = "0123456789ABCDEFGHIJKA"
GUID_B = "0123456789ABCDEFGHIJKB"
GUID_C = "0123456789ABCDEFGHIJKC"


def _storey(express_id: int, guid: str, name: str, elevation: float) -> dict:
    return {"expressID": express_id, "globalId": guid, "name": name, "elevation": elevation}


async def _succeed_with_storeys(
    client: AsyncClient,
    org_user: dict[str, str],
    file_id: str,
    storeys: list[dict],
) -> None:
    cb = await client.post(
        "/internal/jobs/callback",
        json={
            "file_id": file_id,
            "organization_id": org_user["organization_id"],
            "status": "succeeded",
            "storeys": storeys,
        },
        headers=_bearer(),
    )
    assert cb.status_code == 200, cb.text


async def _list_storeys(
    client: AsyncClient, org_user: dict[str, str], project_id: str, document_id: str
) -> list[dict]:
    resp = await client.get(
        f"/projects/{project_id}/documents/{document_id}/storeys",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


async def test_callback_creates_storeys(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, fake = fake_storage_client
    project_id, document_id, file_id = await _ready_file(client, fake, org_user, name="st1.ifc")

    await _succeed_with_storeys(
        client,
        org_user,
        file_id,
        [_storey(10, GUID_B, "Level 2", 3.0), _storey(9, GUID_A, "Level 1", 0.0)],
    )

    storeys = await _list_storeys(client, org_user, project_id, document_id)
    # Sorted ascending by elevation.
    assert [s["name"] for s in storeys] == ["Level 1", "Level 2"]
    assert storeys[0]["ifc_guid"] == GUID_A
    assert storeys[0]["elevation_m"] == 0.0
    assert storeys[0]["ordering"] == 0
    assert storeys[1]["ordering"] == 1


async def test_reextraction_upserts_and_prunes(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, fake = fake_storage_client
    project_id, document_id, file_id = await _ready_file(client, fake, org_user, name="st2.ifc")
    await _succeed_with_storeys(
        client,
        org_user,
        file_id,
        [_storey(9, GUID_A, "Level 1", 0.0), _storey(10, GUID_B, "Level 2", 3.0)],
    )
    before = await _list_storeys(client, org_user, project_id, document_id)
    assert {s["ifc_guid"] for s in before} == {GUID_A, GUID_B}

    # New version of the SAME model → re-extraction. A is renamed, B vanishes, C is new.
    file2 = await _complete_ready_ifc(
        client,
        fake,
        org_user,
        project_id,
        document_id,
        name="st2-v2.ifc",
        sha256="a" * 64,
    )
    await _succeed_with_storeys(
        client,
        org_user,
        file2,
        [_storey(9, GUID_A, "Ground", 0.0), _storey(11, GUID_C, "Level 3", 6.0)],
    )

    after = await _list_storeys(client, org_user, project_id, document_id)
    by_guid = {s["ifc_guid"]: s for s in after}
    # A updated in place (no duplicate), B pruned, C added.
    assert set(by_guid) == {GUID_A, GUID_C}
    assert by_guid[GUID_A]["name"] == "Ground"
    assert sum(1 for s in after if s["ifc_guid"] == GUID_A) == 1
