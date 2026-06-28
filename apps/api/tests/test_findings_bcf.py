"""Finding ↔ BCF round-trip (item 6).

Findings export as BCF topics whose viewpoint *selection* carries the IFC element
GlobalId — the payload BIMcollab / Solibri / Navisworks read to re-attach the
issue to the right component. The reverse imports BCF topics as draft findings.
"""

from __future__ import annotations

import io
import json
import zipfile
from typing import TYPE_CHECKING

from bimdossier_api.bcf.generator import generate_bcf_archive
from bimdossier_api.bcf.parser import parse_bcf_archive
from bimdossier_api.bcf.types import BcfComponents, ParsedBcf, ParsedTopic, ParsedViewpoint
from tests.conftest import _auth, _create_project

if TYPE_CHECKING:
    from httpx import AsyncClient

ELEMENT_GLOBAL_ID = "3kF4p5c6m7N8o9P0q1rS2t"


async def _create_finding(client: AsyncClient, token: str, project_id: str, **fields: object) -> dict:
    body: dict[str, object] = {
        "title": "Brandwerende doorvoer ontbreekt",
        "description": "Doorvoer in brandscheiding niet afgewerkt.",
        **fields,
    }
    resp = await client.post(
        f"/projects/{project_id}/findings", json=body, headers=_auth(token)
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


async def test_export_finding_as_bcf_carries_element_selection(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    token = org_user["access_token"]
    project = await _create_project(client, token)
    finding = await _create_finding(
        client,
        token,
        project["id"],
        severity="high",
        linked_file_type="ifc",
        linked_element_global_id=ELEMENT_GLOBAL_ID,
        anchor_x=1.5,
        anchor_y=2.0,
        anchor_z=3.5,
    )

    resp = await client.post(
        f"/projects/{project['id']}/findings/bcf-export",
        json={},
        headers=_auth(token),
    )
    assert resp.status_code == 200, resp.text
    assert resp.headers["content-type"] == "application/zip"

    parsed = parse_bcf_archive(resp.content)
    assert len(parsed.topics) == 1
    topic = parsed.topics[0]
    # The topic guid IS the finding id, so a re-import round-trips to one identity.
    assert topic.guid == finding["id"]
    assert topic.title == finding["title"]
    assert topic.topic_status == "Open"  # draft → Open
    assert topic.priority == "High"
    # The re-attach payload: the element GlobalId in the viewpoint selection.
    assert topic.viewpoints
    assert topic.viewpoints[0].components is not None
    assert topic.viewpoints[0].components.selection == [ELEMENT_GLOBAL_ID]


async def test_export_findings_bcf_selected_subset(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    token = org_user["access_token"]
    project = await _create_project(client, token)
    a = await _create_finding(client, token, project["id"], title="Alpha")
    await _create_finding(client, token, project["id"], title="Beta")

    resp = await client.post(
        f"/projects/{project['id']}/findings/bcf-export",
        json={"finding_ids": [a["id"]]},
        headers=_auth(token),
    )
    assert resp.status_code == 200, resp.text
    parsed = parse_bcf_archive(resp.content)
    assert [t.guid for t in parsed.topics] == [a["id"]]


async def test_import_bcf_creates_draft_findings_anchored_to_element(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    token = org_user["access_token"]
    project = await _create_project(client, token)

    archive = generate_bcf_archive(
        ParsedBcf(
            version="2.1",
            topics=[
                ParsedTopic(
                    guid="11111111-1111-1111-1111-111111111111",
                    title="Duct clashes with beam",
                    description="MEP duct intersects structural beam.",
                    viewpoints=[
                        ParsedViewpoint(
                            guid="22222222-2222-2222-2222-222222222222",
                            components=BcfComponents(selection=[ELEMENT_GLOBAL_ID]),
                        )
                    ],
                )
            ],
        )
    )

    resp = await client.post(
        f"/projects/{project['id']}/findings/bcf-import",
        files={"file": ("issues.bcfzip", archive, "application/zip")},
        headers=_auth(token),
    )
    assert resp.status_code == 201, resp.text
    created = resp.json()
    assert len(created) == 1
    assert created[0]["status"] == "draft"
    assert created[0]["title"] == "Duct clashes with beam"
    assert created[0]["linked_element_global_id"] == ELEMENT_GLOBAL_ID


async def test_import_invalid_bcf_returns_400(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    token = org_user["access_token"]
    project = await _create_project(client, token)
    resp = await client.post(
        f"/projects/{project['id']}/findings/bcf-import",
        files={"file": ("bad.bcfzip", b"not a zip", "application/zip")},
        headers=_auth(token),
    )
    assert resp.status_code == 400
    assert resp.json()["detail"] == "INVALID_BCF_ARCHIVE"


async def test_bcf_round_trip_export_then_import(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    """Export a finding to BCF, re-import it: the element identity survives."""
    token = org_user["access_token"]
    project = await _create_project(client, token)
    await _create_finding(
        client,
        token,
        project["id"],
        linked_file_type="ifc",
        linked_element_global_id=ELEMENT_GLOBAL_ID,
        anchor_x=1.0,
        anchor_y=1.0,
        anchor_z=1.0,
    )
    export = await client.post(
        f"/projects/{project['id']}/findings/bcf-export", json={}, headers=_auth(token)
    )
    assert export.status_code == 200, export.text

    reimport = await client.post(
        f"/projects/{project['id']}/findings/bcf-import",
        files={"file": ("rt.bcfzip", export.content, "application/zip")},
        headers=_auth(token),
    )
    assert reimport.status_code == 201, reimport.text
    assert reimport.json()[0]["linked_element_global_id"] == ELEMENT_GLOBAL_ID


async def test_instrument_bundle_packages_bcf_json_and_manifest(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    token = org_user["access_token"]
    project = await _create_project(client, token)
    # Declare the target instrument so the manifest resolves it.
    patched = await client.patch(
        f"/projects/{project['id']}", json={"instrument_ref": "kik"}, headers=_auth(token)
    )
    assert patched.status_code == 200, patched.text
    await _create_finding(
        client,
        token,
        project["id"],
        linked_file_type="ifc",
        linked_element_global_id=ELEMENT_GLOBAL_ID,
        anchor_x=1.0,
        anchor_y=1.0,
        anchor_z=1.0,
    )

    resp = await client.post(
        f"/projects/{project['id']}/findings/instrument-export",
        headers=_auth(token),
    )
    assert resp.status_code == 200, resp.text
    assert resp.headers["content-type"] == "application/zip"

    with zipfile.ZipFile(io.BytesIO(resp.content)) as zf:
        assert set(zf.namelist()) == {"manifest.json", "findings.bcfzip", "findings.json"}
        manifest = json.loads(zf.read("manifest.json"))
        assert manifest["kind"] == "wkb_evidence_bundle"
        assert manifest["instrument"]["code"] == "kik"
        assert manifest["instrument"]["operator"] == "BRIS"
        assert manifest["counts"]["findings"] == 1
        # The BCF entry parses and carries the element selection.
        parsed = parse_bcf_archive(zf.read("findings.bcfzip"))
        assert parsed.topics[0].viewpoints[0].components.selection == [ELEMENT_GLOBAL_ID]
        # The JSON entry is the re-importable findings export.
        findings_json = json.loads(zf.read("findings.json"))
        assert findings_json["count"] == 1
