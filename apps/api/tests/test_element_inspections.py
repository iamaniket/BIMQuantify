"""Tests for GET /projects/{pid}/files/{fid}/element-inspections (backlog #49).

Verifies that the element-inspection lookup endpoint returns checklist items
linked to a specific IFC element, together with their inspection results.
"""

from __future__ import annotations

import hashlib
from typing import TYPE_CHECKING
from uuid import uuid4

import pytest

if TYPE_CHECKING:
    from httpx import AsyncClient
    from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

from tests.conftest import (
    VALID_IFC_HEADER,
    FakeStorage,
    _auth,
    _create_document,
    _create_project,
    _provision_user_in_org,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

ELEMENT_GLOBAL_ID = "3kF4p5c6m7N8o9P0q1"  # 22-char IFC GlobalId


async def _generate_borgingsplan(
    client: AsyncClient, token: str, project_id: str,
) -> dict:
    resp = await client.post(
        f"/projects/{project_id}/borgingsplan/generate",
        headers=_auth(token),
    )
    assert resp.status_code == 201, resp.text
    return resp.json()

_file_counter = 0

# A second valid IFC header with a slight content difference so its SHA
# differs from VALID_IFC_HEADER and the project-level dedup passes.
VALID_IFC_HEADER_B = (
    b"ISO-10303-21;\nHEADER;\n"
    b"FILE_DESCRIPTION(('ViewDefinition'),'2;1');\n"
    b"FILE_NAME('other.ifc','2026-02-01T00:00:00','','','','','');\n"
    b"FILE_SCHEMA(('IFC4'));\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n"
)


async def _create_ready_file(
    client: AsyncClient,
    fake: FakeStorage,
    token: str,
    project_id: str,
    document_id: str,
    *,
    content: bytes = VALID_IFC_HEADER,
) -> str:
    """Create an IFC file through the two-phase upload. Returns file_id."""
    global _file_counter
    _file_counter += 1
    filename = f"test-{_file_counter}.ifc"
    sha = hashlib.sha256(content).hexdigest()
    init_resp = await client.post(
        f"/projects/{project_id}/documents/{document_id}/files/initiate",
        json={
            "filename": filename,
            "size_bytes": len(content),
            "content_type": "application/octet-stream",
            "content_sha256": sha,
        },
        headers=_auth(token),
    )
    assert init_resp.status_code == 201, init_resp.text
    init = init_resp.json()
    fake.objects[init["storage_key"]] = content
    complete = await client.post(
        f"/projects/{project_id}/documents/{document_id}/files/{init['file_id']}/complete",
        headers=_auth(token),
    )
    assert complete.status_code == 200, complete.text
    return init["file_id"]


async def _link_item_to_element(
    client: AsyncClient,
    token: str,
    moment_id: str,
    item_id: str,
    *,
    file_id: str,
    global_id: str = ELEMENT_GLOBAL_ID,
) -> dict:
    """PATCH a checklist item to set its element link fields."""
    resp = await client.patch(
        f"/borgingsmomenten/{moment_id}/checklist-items/{item_id}",
        json={
            "linked_file_id": file_id,
            "linked_element_global_id": global_id,
        },
        headers=_auth(token),
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


def _endpoint(project_id: str, file_id: str, global_id: str) -> str:
    return (
        f"/projects/{project_id}/files/{file_id}"
        f"/element-inspections?global_id={global_id}"
    )


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.anyio
async def test_returns_empty_when_no_items_linked(
    fake_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
    engine: AsyncEngine,
) -> None:
    client, fake = fake_storage_client
    user = await _provision_user_in_org(
        client, session_maker, engine, email="kb1@test.nl",
    )
    token = user["access_token"]
    project = await _create_project(client, token)
    model = await _create_document(client, token, project["id"])
    file_id = await _create_ready_file(client, fake, token, project["id"], model["id"])

    # Generate a borgingsplan (creates moments + items) but don't link any.
    await _generate_borgingsplan(client, token, project["id"])

    resp = await client.get(
        _endpoint(project["id"], file_id, ELEMENT_GLOBAL_ID),
        headers=_auth(token),
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["items"] == []
    assert body["element_global_id"] == ELEMENT_GLOBAL_ID
    assert body["file_id"] == file_id


@pytest.mark.anyio
async def test_returns_linked_items_with_results(
    fake_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
    engine: AsyncEngine,
) -> None:
    client, fake = fake_storage_client
    user = await _provision_user_in_org(
        client, session_maker, engine, email="kb2@test.nl",
    )
    token = user["access_token"]
    project = await _create_project(client, token)
    model = await _create_document(client, token, project["id"])
    file_id = await _create_ready_file(client, fake, token, project["id"], model["id"])
    plan = await _generate_borgingsplan(client, token, project["id"])

    # Link the first checklist item of the first moment to our element.
    moment = plan["moments"][0]
    item = moment["checklist_items"][0]
    await _link_item_to_element(
        client, token, moment["id"], item["id"], file_id=file_id,
    )

    # Submit a pass verdict on that item.
    await client.post(
        f"/borgingsmomenten/{moment['id']}/start-inspection",
        headers=_auth(token),
    )
    result_resp = await client.post(
        f"/borgingsmomenten/{moment['id']}/checklist-items/{item['id']}/result",
        json={"verdict": "pass"},
        headers=_auth(token),
    )
    assert result_resp.status_code == 201, result_resp.text

    resp = await client.get(
        _endpoint(project["id"], file_id, ELEMENT_GLOBAL_ID),
        headers=_auth(token),
    )
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["items"]) == 1
    row = body["items"][0]
    assert row["checklist_item"]["id"] == item["id"]
    assert row["result"] is not None
    assert row["result"]["verdict"] == "pass"
    assert row["moment_name"] == moment["name"]
    assert row["moment_phase"] == moment["phase"]


@pytest.mark.anyio
async def test_returns_linked_items_without_results(
    fake_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
    engine: AsyncEngine,
) -> None:
    """Linked items that haven't been inspected yet surface with result=null."""
    client, fake = fake_storage_client
    user = await _provision_user_in_org(
        client, session_maker, engine, email="kb3@test.nl",
    )
    token = user["access_token"]
    project = await _create_project(client, token)
    model = await _create_document(client, token, project["id"])
    file_id = await _create_ready_file(client, fake, token, project["id"], model["id"])
    plan = await _generate_borgingsplan(client, token, project["id"])

    moment = plan["moments"][0]
    item = moment["checklist_items"][0]
    await _link_item_to_element(
        client, token, moment["id"], item["id"], file_id=file_id,
    )

    resp = await client.get(
        _endpoint(project["id"], file_id, ELEMENT_GLOBAL_ID),
        headers=_auth(token),
    )
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["items"]) == 1
    assert body["items"][0]["result"] is None


@pytest.mark.anyio
async def test_filters_by_file_id(
    fake_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
    engine: AsyncEngine,
) -> None:
    """Items linked to a different file are excluded."""
    client, fake = fake_storage_client
    user = await _provision_user_in_org(
        client, session_maker, engine, email="kb4@test.nl",
    )
    token = user["access_token"]
    project = await _create_project(client, token)
    model = await _create_document(client, token, project["id"])
    file_id_a = await _create_ready_file(client, fake, token, project["id"], model["id"])
    file_id_b = await _create_ready_file(
        client, fake, token, project["id"], model["id"],
        content=VALID_IFC_HEADER_B,
    )
    plan = await _generate_borgingsplan(client, token, project["id"])

    # Link item to file_a.
    moment = plan["moments"][0]
    item = moment["checklist_items"][0]
    await _link_item_to_element(
        client, token, moment["id"], item["id"], file_id=file_id_a,
    )

    # Query file_b — should return empty.
    resp = await client.get(
        _endpoint(project["id"], file_id_b, ELEMENT_GLOBAL_ID),
        headers=_auth(token),
    )
    assert resp.status_code == 200
    assert resp.json()["items"] == []


@pytest.mark.anyio
async def test_filters_by_global_id(
    fake_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
    engine: AsyncEngine,
) -> None:
    """Items linked to a different element are excluded."""
    client, fake = fake_storage_client
    user = await _provision_user_in_org(
        client, session_maker, engine, email="kb5@test.nl",
    )
    token = user["access_token"]
    project = await _create_project(client, token)
    model = await _create_document(client, token, project["id"])
    file_id = await _create_ready_file(client, fake, token, project["id"], model["id"])
    plan = await _generate_borgingsplan(client, token, project["id"])

    moment = plan["moments"][0]
    item = moment["checklist_items"][0]
    await _link_item_to_element(
        client, token, moment["id"], item["id"],
        file_id=file_id, global_id="1aB2cD3eF4gH5iJ6kL",
    )

    # Query a different global_id — should return empty.
    resp = await client.get(
        _endpoint(project["id"], file_id, "9zY8xW7vU6tS5rQ4pO"),
        headers=_auth(token),
    )
    assert resp.status_code == 200
    assert resp.json()["items"] == []


@pytest.mark.anyio
async def test_non_member_gets_404(
    fake_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
    engine: AsyncEngine,
) -> None:
    client, fake = fake_storage_client
    owner = await _provision_user_in_org(
        client, session_maker, engine, email="owner@test.nl",
    )
    outsider = await _provision_user_in_org(
        client, session_maker, engine, email="outsider@test.nl",
    )
    project = await _create_project(client, owner["access_token"])
    model = await _create_document(client, owner["access_token"], project["id"])
    file_id = await _create_ready_file(
        client, fake, owner["access_token"], project["id"], model["id"],
    )

    resp = await client.get(
        _endpoint(project["id"], file_id, ELEMENT_GLOBAL_ID),
        headers=_auth(outsider["access_token"]),
    )
    # RLS + membership check = 404 (not 403) to avoid existence leakage.
    assert resp.status_code == 404


@pytest.mark.anyio
async def test_nonexistent_project_returns_404(
    fake_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
    engine: AsyncEngine,
) -> None:
    client, _fake = fake_storage_client
    user = await _provision_user_in_org(
        client, session_maker, engine, email="kb6@test.nl",
    )
    resp = await client.get(
        _endpoint(str(uuid4()), str(uuid4()), ELEMENT_GLOBAL_ID),
        headers=_auth(user["access_token"]),
    )
    assert resp.status_code == 404
