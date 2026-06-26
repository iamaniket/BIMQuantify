"""Tests for the live POST .../compliance/check building-type plumbing.

The Arbiter MCP call (`run_compliance_check`) is stubbed so these run without a
real Arbiter; we assert on the `building_type` that reaches the Arbiter and is
persisted on the Job. The check endpoint requires a file with
extraction_status=succeeded and artifact keys, so we force that state via raw
SQL (the async extraction pipeline is stubbed in tests).
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any
from uuid import UUID

import pytest
from sqlalchemy import text

import bimdossier_api.routers.compliance as compliance_router
from tests.conftest import (
    VALID_IFC_HEADER,
    FakeStorage,
    _auth,
    _create_document,
)

if TYPE_CHECKING:
    from httpx import AsyncClient
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker


async def _ready_extracted_file(
    client: AsyncClient,
    fake: FakeStorage,
    session_maker: async_sessionmaker[AsyncSession],
    org_user: dict[str, str],
    *,
    building_type: str | None = None,
    name: str = "bt.ifc",
) -> tuple[str, str, str]:
    """Create project (optionally typed) + model + a succeeded-extraction file.

    Returns (project_id, document_id, file_id).
    """
    body: dict[str, object] = {"name": name + "-p"}
    if building_type is not None:
        body["building_type"] = building_type
    project = (
        await client.post("/projects", json=body, headers=_auth(org_user["access_token"]))
    ).json()
    model = await _create_document(client, org_user["access_token"], project["id"], name=name + "-m")
    init = (
        await client.post(
            f"/projects/{project['id']}/documents/{model['id']}/files/initiate",
            json={
                "filename": name,
                "size_bytes": len(VALID_IFC_HEADER),
                "content_type": "application/octet-stream",
                "content_sha256": (
                    "6ef80f63974c453f39da279f6ee263111ae09ac0e884a6f3a148a0da0b8583be"
                ),
            },
            headers=_auth(org_user["access_token"]),
        )
    ).json()
    fake.objects[init["storage_key"]] = VALID_IFC_HEADER
    complete = await client.post(
        f"/projects/{project['id']}/documents/{model['id']}/files/{init['file_id']}/complete",
        headers=_auth(org_user["access_token"]),
    )
    assert complete.status_code == 200, complete.text

    # Force the file into a 'succeeded' extraction with artifact keys (the
    # check endpoint gate), bypassing the async processor pipeline.
    schema = f"org_{str(UUID(org_user['organization_id'])).replace('-', '')}"
    async with session_maker() as session, session.begin():
        await session.execute(text(f'SET LOCAL search_path TO "{schema}", public'))
        await session.execute(
            text(
                "UPDATE project_files SET extraction_status='succeeded', "
                "metadata_storage_key=:mk, properties_storage_key=:pk "
                "WHERE id=:fid"
            ),
            {"mk": "meta/x.json", "pk": "props/x.json", "fid": init["file_id"]},
        )
    return project["id"], model["id"], init["file_id"]


@pytest.fixture
def stub_arbiter(monkeypatch: pytest.MonkeyPatch) -> list[dict[str, Any]]:
    """Replace the Arbiter MCP call with a recorder; returns the call kwargs."""
    calls: list[dict[str, Any]] = []

    async def _fake_run(**kwargs: Any) -> dict[str, Any]:
        calls.append(kwargs)
        return {
            "checked_at": "2026-06-23T00:00:00Z",
            "total_rules": 0,
            "total_elements_checked": 0,
            "rules_summary": [],
            "category_summary": [],
            "details": [],
        }

    monkeypatch.setattr(compliance_router, "run_compliance_check", _fake_run)
    return calls


async def _check(
    client: AsyncClient, org_user: dict[str, str], ids: tuple[str, str, str], json: dict
) -> Any:
    project_id, document_id, file_id = ids
    return await client.post(
        f"/projects/{project_id}/documents/{document_id}/files/{file_id}/compliance/check",
        json=json,
        headers=_auth(org_user["access_token"]),
    )


async def test_check_derives_building_type_from_project(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
    stub_arbiter: list[dict[str, Any]],
) -> None:
    """No request building_type → the project's building type drives filtering."""
    client, fake = fake_storage_client
    ids = await _ready_extracted_file(
        client, fake, session_maker, org_user, building_type="office", name="office.ifc"
    )

    resp = await _check(client, org_user, ids, {"framework": "bbl"})
    assert resp.status_code == 200, resp.text

    assert len(stub_arbiter) == 1
    assert stub_arbiter[0]["building_type"] == "office"


async def test_check_explicit_building_type_overrides_project(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
    stub_arbiter: list[dict[str, Any]],
) -> None:
    """An explicit request building_type wins over the project's."""
    client, fake = fake_storage_client
    ids = await _ready_extracted_file(
        client, fake, session_maker, org_user, building_type="office", name="ovr.ifc"
    )

    resp = await _check(client, org_user, ids, {"framework": "bbl", "building_type": "dwelling"})
    assert resp.status_code == 200, resp.text

    assert stub_arbiter[0]["building_type"] == "dwelling"


async def test_check_falls_back_to_all_when_project_untyped(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
    stub_arbiter: list[dict[str, Any]],
) -> None:
    """An untyped project with no override falls back to 'all' (unchanged)."""
    client, fake = fake_storage_client
    ids = await _ready_extracted_file(
        client, fake, session_maker, org_user, building_type=None, name="untyped.ifc"
    )

    resp = await _check(client, org_user, ids, {"framework": "bbl"})
    assert resp.status_code == 200, resp.text

    assert stub_arbiter[0]["building_type"] == "all"
