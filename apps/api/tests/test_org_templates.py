"""HTTP-level integration tests for org templates (unified finding forms + report layouts).

Org-level, admin-gated writes / member-level reads, over the single `/org-templates`
router. Covers: findings-kind CRUD + the finding-create integration (carried over from
the former finding-templates suite), report-kind config validation, the per-type
one-default invariant, the schema endpoint, asset uploads, and tenant isolation. Plus
pure unit tests for `build_custom_values`.
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import TYPE_CHECKING
from uuid import uuid4

import pytest
from fastapi import HTTPException

from bimstitch_api.finding_custom_values import build_custom_values
from bimstitch_api.org_templates.registry import REPORT_TEMPLATE_TYPES, valid_section_keys
from tests.conftest import _auth, _create_project

if TYPE_CHECKING:
    from httpx import AsyncClient

# Reusable custom-field definitions (findings kind).
SELECT_FIELD = {
    "id": "f_loc01",
    "type": "select",
    "label": "Bouwdeel",
    "required": True,
    "options": ["Gevel", "Dak", "Vloer"],
}
DATE_FIELD = {"id": "f_date1", "type": "date", "label": "Hersteldatum", "required": False}
TEXT_FIELD = {"id": "f_note1", "type": "text", "label": "Notitie", "required": False}


def _findings_payload(**overrides: object) -> dict[str, object]:
    """Build an /org-templates create body for a findings template. `fields` and
    `builtin_fields` overrides are nested into `config`; `name`/`is_default` flow."""
    config = {
        "builtin_fields": overrides.pop("builtin_fields", {}),
        "fields": overrides.pop("fields", []),
    }
    base: dict[str, object] = {"template_type": "findings", "name": "Dagcontrole", "config": config}
    base.update(overrides)
    return base


async def _create_template(client: AsyncClient, token: str, **overrides: object) -> dict:
    resp = await client.post(
        "/org-templates", json=_findings_payload(**overrides), headers=_auth(token)
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def _finding_payload(**overrides: object) -> dict[str, object]:
    base: dict[str, object] = {"title": "Bevinding", "description": "Omschrijving."}
    base.update(overrides)
    return base


# A valid dossier report-template config.
def _dossier_config(**branding: object) -> dict[str, object]:
    return {
        "branding": {"accent_color": "#1d4ed8", "accent_color_secondary": "#0ea5e9", **branding},
        "sections": [
            {"type": "content", "key": "risks", "enabled": True},
            {"type": "text", "id": "t_intro1", "title": "Intro", "body": "Voor {{project.name}}"},
            {"type": "content", "key": "findings", "enabled": True},
            {"type": "content", "key": "certificates", "enabled": False},
        ],
        "options": {"show_toc": True},
    }


async def _create_report_template(
    client: AsyncClient, token: str, *, name: str = "ACME Dossier", **overrides: object
) -> dict:
    body: dict[str, object] = {
        "template_type": "dossier",
        "name": name,
        "config": _dossier_config(),
    }
    body.update(overrides)
    resp = await client.post("/org-templates", json=body, headers=_auth(token))
    assert resp.status_code == 201, resp.text
    return resp.json()


# ---------------------------------------------------------------------------
# Findings CRUD + serialization
# ---------------------------------------------------------------------------


async def test_create_template_minimal(client: AsyncClient, org_user: dict[str, str]) -> None:
    body = await _create_template(client, org_user["access_token"], name="Leeg")
    assert body["name"] == "Leeg"
    assert body["template_type"] == "findings"
    assert body["is_default"] is False
    assert body["config"]["fields"] == []
    assert body["config"]["builtin_fields"] == {}
    assert body["created_by_user_id"] == org_user["id"]
    assert "id" in body and "created_at" in body and "updated_at" in body


async def test_create_template_with_fields_round_trips(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    body = await _create_template(
        client,
        org_user["access_token"],
        name="Vol",
        fields=[SELECT_FIELD, DATE_FIELD],
        builtin_fields={"bbl_article_ref": {"visible": True, "required": True}},
    )
    assert [f["id"] for f in body["config"]["fields"]] == ["f_loc01", "f_date1"]
    assert body["config"]["fields"][0]["options"] == ["Gevel", "Dak", "Vloer"]
    assert body["config"]["builtin_fields"]["bbl_article_ref"] == {
        "visible": True,
        "required": True,
    }


async def test_list_and_get_template(client: AsyncClient, org_user: dict[str, str]) -> None:
    token = org_user["access_token"]
    created = await _create_template(client, token, name="Een")
    listed = await client.get("/org-templates", headers=_auth(token))
    assert listed.status_code == 200
    assert [t["id"] for t in listed.json()] == [created["id"]]

    got = await client.get(f"/org-templates/{created['id']}", headers=_auth(token))
    assert got.status_code == 200
    assert got.json()["name"] == "Een"


async def test_get_template_404_unknown(client: AsyncClient, org_user: dict[str, str]) -> None:
    resp = await client.get(f"/org-templates/{uuid4()}", headers=_auth(org_user["access_token"]))
    assert resp.status_code == 404
    assert resp.json()["detail"] == "ORG_TEMPLATE_NOT_FOUND"


async def test_update_template(client: AsyncClient, org_user: dict[str, str]) -> None:
    token = org_user["access_token"]
    created = await _create_template(client, token, name="Oud", fields=[TEXT_FIELD])
    patched = await client.patch(
        f"/org-templates/{created['id']}",
        json={"name": "Nieuw", "config": {"fields": [SELECT_FIELD], "builtin_fields": {}}},
        headers=_auth(token),
    )
    assert patched.status_code == 200, patched.text
    assert patched.json()["name"] == "Nieuw"
    assert [f["id"] for f in patched.json()["config"]["fields"]] == ["f_loc01"]


async def test_delete_template_soft_then_hidden(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    token = org_user["access_token"]
    created = await _create_template(client, token)
    resp = await client.delete(f"/org-templates/{created['id']}", headers=_auth(token))
    assert resp.status_code == 204
    assert (await client.get("/org-templates", headers=_auth(token))).json() == []
    follow = await client.get(f"/org-templates/{created['id']}", headers=_auth(token))
    assert follow.status_code == 404


# ---------------------------------------------------------------------------
# Access control: member read, admin write
# ---------------------------------------------------------------------------


async def test_non_admin_can_read_not_write(
    client: AsyncClient,
    org_user: dict[str, str],
    same_org_non_admin_user: dict[str, str],
) -> None:
    admin = org_user["access_token"]
    member = same_org_non_admin_user["access_token"]
    created = await _create_template(client, admin, name="Shared")

    assert (await client.get("/org-templates", headers=_auth(member))).status_code == 200
    assert (
        await client.get(f"/org-templates/{created['id']}", headers=_auth(member))
    ).status_code == 200

    post = await client.post(
        "/org-templates", json=_findings_payload(name="x"), headers=_auth(member)
    )
    assert post.status_code == 403
    assert post.json()["detail"] == "ORG_ADMIN_REQUIRED"
    patch = await client.patch(
        f"/org-templates/{created['id']}", json={"name": "y"}, headers=_auth(member)
    )
    assert patch.status_code == 403
    set_def = await client.post(
        f"/org-templates/{created['id']}/set-default", headers=_auth(member)
    )
    assert set_def.status_code == 403
    delete = await client.delete(f"/org-templates/{created['id']}", headers=_auth(member))
    assert delete.status_code == 403


async def test_superuser_can_write(
    client: AsyncClient,
    org_user: dict[str, str],
    superuser_in_org: dict[str, str],
) -> None:
    body = await _create_template(client, superuser_in_org["access_token"], name="BySuper")
    assert body["name"] == "BySuper"


async def test_templates_isolated_across_orgs(
    client: AsyncClient,
    org_user: dict[str, str],
    other_org_user: dict[str, str],
) -> None:
    created = await _create_template(client, org_user["access_token"], name="AlphaOnly")
    other_list = await client.get("/org-templates", headers=_auth(other_org_user["access_token"]))
    assert other_list.status_code == 200
    assert other_list.json() == []
    other_get = await client.get(
        f"/org-templates/{created['id']}", headers=_auth(other_org_user["access_token"])
    )
    assert other_get.status_code == 404


# ---------------------------------------------------------------------------
# One-default invariant (per template_type)
# ---------------------------------------------------------------------------


async def test_one_default_per_type(client: AsyncClient, org_user: dict[str, str]) -> None:
    token = org_user["access_token"]
    a = await _create_template(client, token, name="A", is_default=True)
    assert a["is_default"] is True
    b = await _create_template(client, token, name="B", is_default=True)
    assert b["is_default"] is True

    listed = {
        t["name"]: t["is_default"]
        for t in (await client.get("/org-templates", headers=_auth(token))).json()
    }
    assert listed == {"A": False, "B": True}

    moved = await client.post(f"/org-templates/{a['id']}/set-default", headers=_auth(token))
    assert moved.status_code == 200
    assert moved.json()["is_default"] is True
    listed2 = {
        t["name"]: t["is_default"]
        for t in (await client.get("/org-templates", headers=_auth(token))).json()
    }
    assert listed2 == {"A": True, "B": False}


async def test_defaults_independent_across_types(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    """A findings default and a dossier default coexist — the index is per type."""
    token = org_user["access_token"]
    findings_default = await _create_template(client, token, name="FDef", is_default=True)
    dossier_default = await _create_report_template(client, token, name="DDef", is_default=True)
    assert findings_default["is_default"] is True
    assert dossier_default["is_default"] is True

    findings_list = (await client.get("/org-templates", headers=_auth(token))).json()
    dossier_list = (
        await client.get("/org-templates?template_type=dossier", headers=_auth(token))
    ).json()
    assert [t["name"] for t in findings_list] == ["FDef"]
    assert [t["name"] for t in dossier_list] == ["DDef"]


async def test_delete_default_blocked(client: AsyncClient, org_user: dict[str, str]) -> None:
    token = org_user["access_token"]
    created = await _create_template(client, token, name="Def", is_default=True)
    resp = await client.delete(f"/org-templates/{created['id']}", headers=_auth(token))
    assert resp.status_code == 409
    assert resp.json()["detail"] == "CANNOT_DELETE_DEFAULT_TEMPLATE"


# ---------------------------------------------------------------------------
# Findings field-definition validation (→ 422)
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "fields",
    [
        [{"id": "f_a001", "type": "select", "label": "X", "required": False}],  # no options
        [
            {"id": "f_dup01", "type": "text", "label": "A"},
            {"id": "f_dup01", "type": "text", "label": "B"},
        ],
        [{"id": "f_num01", "type": "number", "label": "N", "min": 5, "max": 1}],  # min>max
        [
            {"id": "f_t0001", "type": "text", "label": "T", "options": ["a"]}
        ],  # options on non-select
        [{"id": "bad-id", "type": "text", "label": "T"}],  # id pattern
    ],
)
async def test_field_validation_422(
    client: AsyncClient, org_user: dict[str, str], fields: list[dict]
) -> None:
    resp = await client.post(
        "/org-templates",
        json=_findings_payload(fields=fields),
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 422, resp.text


async def test_too_many_fields_422(client: AsyncClient, org_user: dict[str, str]) -> None:
    fields = [{"id": f"f_n{n:04d}", "type": "text", "label": f"L{n}"} for n in range(31)]
    resp = await client.post(
        "/org-templates",
        json=_findings_payload(fields=fields),
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 422


async def test_unknown_builtin_key_422(client: AsyncClient, org_user: dict[str, str]) -> None:
    resp = await client.post(
        "/org-templates",
        json=_findings_payload(builtin_fields={"deadline": {"visible": True}}),
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 422


# ---------------------------------------------------------------------------
# Report-template config validation
# ---------------------------------------------------------------------------


async def test_create_report_template_round_trips(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    body = await _create_report_template(client, org_user["access_token"])
    assert body["template_type"] == "dossier"
    assert body["config"]["branding"]["accent_color"] == "#1d4ed8"
    assert body["config"]["branding"]["accent_color_secondary"] == "#0ea5e9"
    keys = [s.get("key") or s.get("id") for s in body["config"]["sections"]]
    assert keys == ["risks", "t_intro1", "findings", "certificates"]


@pytest.mark.parametrize(
    ("config", "code"),
    [
        ({"branding": {"accent_color": "blue"}, "sections": []}, "INVALID_CONFIG"),
        (
            {"sections": [{"type": "content", "key": "bogus", "enabled": True}]},
            "UNKNOWN_SECTION_KEY:bogus",
        ),
        (
            {
                "sections": [
                    {"type": "content", "key": "risks"},
                    {"type": "content", "key": "risks"},
                ]
            },
            "DUPLICATE_SECTION_KEY",
        ),
        (
            {
                "sections": [
                    {"type": "text", "id": "t_a0001", "body": "x"},
                    {"type": "text", "id": "t_a0001", "body": "y"},
                ]
            },
            "DUPLICATE_TEXT_BLOCK_ID",
        ),
        ({"branding": {"logo_storage_key": "evil/x.png"}, "sections": []}, "INVALID_ASSET_KEY"),
    ],
)
async def test_report_config_validation_422(
    client: AsyncClient, org_user: dict[str, str], config: dict, code: str
) -> None:
    resp = await client.post(
        "/org-templates",
        json={"template_type": "dossier", "name": "Bad", "config": config},
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 422, resp.text
    detail = resp.json()["detail"]
    assert detail == code or detail.startswith(code)


# ---------------------------------------------------------------------------
# Schema endpoint
# ---------------------------------------------------------------------------


async def test_schema_endpoint_for_dossier(client: AsyncClient, org_user: dict[str, str]) -> None:
    resp = await client.get(
        "/org-templates/schema?template_type=dossier&locale=nl",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["template_type"] == "dossier"
    keys = {s["key"] for s in body["sections"]}
    assert keys == {"risks", "plan", "findings", "certificates", "declaration"}
    paths = {m["path"] for m in body["merge_fields"]}
    assert "project.name" in paths and "project.permit_number" in paths


async def test_schema_endpoint_rejects_findings(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    resp = await client.get(
        "/org-templates/schema?template_type=findings",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 422
    assert resp.json()["detail"] == "SCHEMA_NOT_AVAILABLE_FOR_TYPE"


# ---------------------------------------------------------------------------
# Asset upload
# ---------------------------------------------------------------------------


async def test_asset_initiate_logo(client: AsyncClient, org_user: dict[str, str]) -> None:
    resp = await client.post(
        "/org-templates/assets/initiate",
        json={
            "asset_kind": "logo",
            "filename": "brand.png",
            "content_type": "image/png",
            "size_bytes": 4096,
        },
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["storage_key"].startswith("report-templates/")
    assert "/logo/" in body["storage_key"] and body["storage_key"].endswith(".png")
    assert body["upload_url"]


async def test_asset_initiate_bad_extension_400(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    resp = await client.post(
        "/org-templates/assets/initiate",
        json={
            "asset_kind": "logo",
            "filename": "brand.txt",
            "content_type": "text/plain",
            "size_bytes": 10,
        },
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 400
    assert resp.json()["detail"]["code"] == "INVALID_FILE_EXTENSION"


async def test_asset_initiate_requires_admin(
    client: AsyncClient, same_org_non_admin_user: dict[str, str]
) -> None:
    resp = await client.post(
        "/org-templates/assets/initiate",
        json={
            "asset_kind": "cover_pdf",
            "filename": "cover.pdf",
            "content_type": "application/pdf",
            "size_bytes": 10,
        },
        headers=_auth(same_org_non_admin_user["access_token"]),
    )
    assert resp.status_code == 403


async def test_asset_complete_object_not_uploaded_422(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    token = org_user["access_token"]
    init = await client.post(
        "/org-templates/assets/initiate",
        json={
            "asset_kind": "logo",
            "filename": "l.png",
            "content_type": "image/png",
            "size_bytes": 10,
        },
        headers=_auth(token),
    )
    assert init.status_code == 201
    key = init.json()["storage_key"]
    comp = await client.post(
        "/org-templates/assets/complete", json={"storage_key": key}, headers=_auth(token)
    )
    assert comp.status_code == 422
    assert comp.json()["detail"] == "OBJECT_NOT_UPLOADED"


async def test_asset_complete_foreign_key_400(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    resp = await client.post(
        "/org-templates/assets/complete",
        json={"storage_key": "report-templates/00000000-0000-0000-0000-000000000000/logo/x.png"},
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 400
    assert resp.json()["detail"] == "INVALID_ASSET_KEY"


# ---------------------------------------------------------------------------
# Registry parity guard (Python side; the processor vitest guards the other)
# ---------------------------------------------------------------------------


def test_section_key_registry_matches_canonical() -> None:
    expected = {
        "compliance_report": {"by_category", "by_rule"},
        "assurance_plan": {"risks", "moments"},
        "completion_declaration": {"declaration"},
        "dossier": {"risks", "plan", "findings", "certificates", "declaration"},
    }
    actual = {rt.value: valid_section_keys(rt) for rt in REPORT_TEMPLATE_TYPES}
    assert actual == expected


# ---------------------------------------------------------------------------
# Finding-create integration (template loaded from the unified table)
# ---------------------------------------------------------------------------


async def test_create_finding_with_template_snapshots_values(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    token = org_user["access_token"]
    project = await _create_project(client, token)
    template = await _create_template(
        client, token, name="T", fields=[SELECT_FIELD, DATE_FIELD, TEXT_FIELD]
    )
    resp = await client.post(
        f"/projects/{project['id']}/findings",
        json=_finding_payload(
            template_id=template["id"],
            custom_values={"f_loc01": "Gevel", "f_date1": "2026-07-01", "f_note1": "  ok  "},
        ),
        headers=_auth(token),
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["template_id"] == template["id"]
    assert body["custom_values"] == {
        "f_loc01": {"label": "Bouwdeel", "type": "select", "value": "Gevel"},
        "f_date1": {"label": "Hersteldatum", "type": "date", "value": "2026-07-01"},
        "f_note1": {"label": "Notitie", "type": "text", "value": "ok"},
    }


async def test_create_finding_required_custom_field_missing_422(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    token = org_user["access_token"]
    project = await _create_project(client, token)
    template = await _create_template(client, token, fields=[SELECT_FIELD])
    resp = await client.post(
        f"/projects/{project['id']}/findings",
        json=_finding_payload(template_id=template["id"], custom_values={}),
        headers=_auth(token),
    )
    assert resp.status_code == 422
    assert resp.json()["detail"] == "CUSTOM_FIELD_REQUIRED:f_loc01"


async def test_create_finding_bad_select_option_422(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    token = org_user["access_token"]
    project = await _create_project(client, token)
    template = await _create_template(client, token, fields=[SELECT_FIELD])
    resp = await client.post(
        f"/projects/{project['id']}/findings",
        json=_finding_payload(template_id=template["id"], custom_values={"f_loc01": "Plafond"}),
        headers=_auth(token),
    )
    assert resp.status_code == 422
    assert resp.json()["detail"] == "CUSTOM_FIELD_BAD_OPTION:f_loc01"


async def test_create_finding_custom_values_without_template_422(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    token = org_user["access_token"]
    project = await _create_project(client, token)
    resp = await client.post(
        f"/projects/{project['id']}/findings",
        json=_finding_payload(custom_values={"f_x": "y"}),
        headers=_auth(token),
    )
    assert resp.status_code == 422
    assert resp.json()["detail"] == "CUSTOM_VALUES_WITHOUT_TEMPLATE"


async def test_create_finding_unknown_template_422(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    token = org_user["access_token"]
    project = await _create_project(client, token)
    resp = await client.post(
        f"/projects/{project['id']}/findings",
        json=_finding_payload(template_id=str(uuid4())),
        headers=_auth(token),
    )
    assert resp.status_code == 422
    assert resp.json()["detail"] == "FINDING_TEMPLATE_NOT_FOUND"


async def test_builtin_required_bbl_enforced(client: AsyncClient, org_user: dict[str, str]) -> None:
    token = org_user["access_token"]
    project = await _create_project(client, token)
    template = await _create_template(
        client, token, builtin_fields={"bbl_article_ref": {"visible": True, "required": True}}
    )
    missing = await client.post(
        f"/projects/{project['id']}/findings",
        json=_finding_payload(template_id=template["id"]),
        headers=_auth(token),
    )
    assert missing.status_code == 422
    assert missing.json()["detail"] == "FINDING_TEMPLATE_REQUIRED_FIELD:bbl_article_ref"

    ok = await client.post(
        f"/projects/{project['id']}/findings",
        json=_finding_payload(template_id=template["id"], bbl_article_ref="4.51"),
        headers=_auth(token),
    )
    assert ok.status_code == 201, ok.text


async def test_soft_deleting_template_keeps_finding_snapshot(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    token = org_user["access_token"]
    project = await _create_project(client, token)
    template = await _create_template(client, token, fields=[SELECT_FIELD])
    finding = (
        await client.post(
            f"/projects/{project['id']}/findings",
            json=_finding_payload(template_id=template["id"], custom_values={"f_loc01": "Dak"}),
            headers=_auth(token),
        )
    ).json()
    deleted = await client.delete(f"/org-templates/{template['id']}", headers=_auth(token))
    assert deleted.status_code == 204
    got = await client.get(
        f"/projects/{project['id']}/findings/{finding['id']}", headers=_auth(token)
    )
    assert got.status_code == 200
    assert got.json()["custom_values"]["f_loc01"]["value"] == "Dak"


# ---------------------------------------------------------------------------
# Pure unit tests for build_custom_values (no DB)
# ---------------------------------------------------------------------------


def _tmpl(*fields: dict) -> SimpleNamespace:
    return SimpleNamespace(fields=list(fields))


def test_build_custom_values_none_template_empty() -> None:
    assert build_custom_values(None, None) is None
    assert build_custom_values(None, {}) is None


def test_build_custom_values_none_template_with_values_raises() -> None:
    with pytest.raises(HTTPException) as exc:
        build_custom_values(None, {"f_x": "y"})
    assert exc.value.detail == "CUSTOM_VALUES_WITHOUT_TEMPLATE"


def test_build_custom_values_number_coercion_and_range() -> None:
    tmpl = _tmpl({"id": "f_num01", "type": "number", "label": "N", "min": 0, "max": 10})
    assert build_custom_values(tmpl, {"f_num01": "5"}) == {
        "f_num01": {"label": "N", "type": "number", "value": 5}
    }
    with pytest.raises(HTTPException) as exc:
        build_custom_values(tmpl, {"f_num01": "11"})
    assert exc.value.detail == "CUSTOM_FIELD_NUMBER_OUT_OF_RANGE:f_num01"
    with pytest.raises(HTTPException) as exc2:
        build_custom_values(tmpl, {"f_num01": "abc"})
    assert exc2.value.detail == "CUSTOM_FIELD_NOT_A_NUMBER:f_num01"


def test_build_custom_values_checkbox_required_must_be_true() -> None:
    tmpl = _tmpl({"id": "f_chk01", "type": "checkbox", "label": "Akkoord", "required": True})
    assert build_custom_values(tmpl, {"f_chk01": True}) == {
        "f_chk01": {"label": "Akkoord", "type": "checkbox", "value": True}
    }
    with pytest.raises(HTTPException) as exc:
        build_custom_values(tmpl, {"f_chk01": False})
    assert exc.value.detail == "CUSTOM_FIELD_REQUIRED:f_chk01"


def test_build_custom_values_bad_date_and_unknown_field() -> None:
    tmpl = _tmpl({"id": "f_date1", "type": "date", "label": "D"})
    with pytest.raises(HTTPException) as exc:
        build_custom_values(tmpl, {"f_date1": "01-07-2026"})
    assert exc.value.detail == "CUSTOM_FIELD_BAD_DATE:f_date1"
    with pytest.raises(HTTPException) as exc2:
        build_custom_values(tmpl, {"f_unknown": "x"})
    assert exc2.value.detail.startswith("UNKNOWN_CUSTOM_FIELD")


def test_build_custom_values_drops_blank_optionals() -> None:
    tmpl = _tmpl(
        {"id": "f_t0001", "type": "text", "label": "T", "required": False},
        {"id": "f_t0002", "type": "text", "label": "U", "required": False},
    )
    assert build_custom_values(tmpl, {"f_t0001": "kept", "f_t0002": "   "}) == {
        "f_t0001": {"label": "T", "type": "text", "value": "kept"}
    }
