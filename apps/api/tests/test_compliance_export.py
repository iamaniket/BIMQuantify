"""Tests for GET /projects/{p}/models/{m}/files/{f}/compliance/export.csv.

Seeds a succeeded compliance Job (via raw SQL, bypassing RLS) tied to a
project_file, then hits the endpoint and asserts on the CSV body.
"""

from __future__ import annotations

import csv
import io
import json
from uuid import UUID, uuid4

from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from tests.conftest import (
    VALID_IFC_HEADER,
    FakeStorage,
    _auth,
    _create_model,
    _create_project,
)

EXPECTED_HEADERS = [
    "rule_id",
    "article",
    "status",
    "severity",
    "element_type",
    "element_name",
    "element_global_id",
    "property_path",
    "expected_value",
    "actual_value",
    "message",
]

EXPECTED_RULES_HEADERS = [
    "rule_id",
    "article",
    "title",
    "title_nl",
    "category",
    "severity",
    "total_checked",
    "passed",
    "warned",
    "failed",
    "skipped",
    "errors",
]


def _rule_summary(
    rule_id: str = "R-1",
    article: str = "BBL-2.1",
    title: str = "Fire safety",
    title_nl: str = "Brandveiligheid",
    category: str = "fire_safety",
    severity: str = "high",
    total_checked: int = 4,
    passed: int = 3,
    warned: int = 0,
    failed: int = 1,
    skipped: int = 0,
    errors: int = 0,
) -> dict:
    return {
        "rule_id": rule_id,
        "article": article,
        "title": title,
        "title_nl": title_nl,
        "category": category,
        "severity": severity,
        "total_checked": total_checked,
        "passed": passed,
        "warned": warned,
        "failed": failed,
        "skipped": skipped,
        "errors": errors,
    }


def _detail(
    rule_id: str = "R-1",
    article: str = "BBL-2.1",
    status: str = "fail",
    severity: str = "high",
    element_type: str = "IfcWall",
    element_name: str = "Wall-01",
    element_global_id: str = "GUID-001",
    property_path: str = "FireRating",
    expected_value: str = "60",
    actual_value: str = "30",
    message: str = "Wall does not meet 60-min fire rating",
) -> dict:
    return {
        "rule_id": rule_id,
        "article": article,
        "status": status,
        "severity": severity,
        "element_type": element_type,
        "element_name": element_name,
        "element_global_id": element_global_id,
        "property_path": property_path,
        "expected_value": expected_value,
        "actual_value": actual_value,
        "message": message,
    }


async def _ready_file(
    client: AsyncClient,
    fake: FakeStorage,
    org_user: dict[str, str],
    name: str = "csv.ifc",
) -> tuple[str, str, str]:
    """Create a project + model + complete a file. Returns (project_id, model_id, file_id)."""
    project = await _create_project(client, org_user["access_token"], name=name + "-p")
    model = await _create_model(client, org_user["access_token"], project["id"], name=name + "-m")
    init = (
        await client.post(
            f"/projects/{project['id']}/models/{model['id']}/files/initiate",
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
        f"/projects/{project['id']}/models/{model['id']}/files/{init['file_id']}/complete",
        headers=_auth(org_user["access_token"]),
    )
    assert complete.status_code == 200, complete.text
    return project["id"], model["id"], init["file_id"]


async def _seed_compliance_job(
    session_maker: async_sessionmaker[AsyncSession],
    organization_id: UUID,
    project_id: UUID,
    file_id: UUID,
    *,
    framework: str = "bbl",
    details: list[dict] | None = None,
    rules_summary: list[dict] | None = None,
) -> UUID:
    """Insert a succeeded compliance Job for a specific file via raw SQL (bypass RLS).

    All compliance jobs share the single `compliance_check` JobType — the
    framework lives in `payload.framework` (and is mirrored into `result.framework`
    for the test helpers to read back).
    """
    details = details or []
    rules_summary = rules_summary or []
    job_id = uuid4()
    result = {
        "checked_at": "2026-05-12T09:00:00Z",
        "framework": framework,
        "total_rules": len({d["rule_id"] for d in details}) or len(rules_summary),
        "total_elements_checked": len(details),
        "rules_summary": rules_summary,
        "category_summary": [],
        "details": details,
    }
    payload = {"framework": framework}
    # Jobs lives in `org_<hex>.jobs` now; route the raw INSERT into that
    # schema via search_path so it actually matches the rows the API
    # reads back. The `organization_id` column was dropped along with the
    # move — the schema is the org now.
    schema = f"org_{str(organization_id).replace('-', '')}"
    async with session_maker() as session, session.begin():
        await session.execute(text(f'SET LOCAL search_path TO "{schema}", public'))
        await session.execute(
            text(
                "INSERT INTO jobs (id, project_id, file_id, job_type, "
                "status, payload, result, finished_at) "
                "VALUES (:id, :p, :f, 'compliance_check', 'succeeded', "
                "CAST(:pl AS jsonb), CAST(:r AS jsonb), now())"
            ),
            {
                "id": str(job_id),
                "p": str(project_id),
                "f": str(file_id),
                "pl": json.dumps(payload),
                "r": json.dumps(result),
            },
        )
    return job_id


# ---------------------------------------------------------------------------
# Happy path
# ---------------------------------------------------------------------------


async def test_export_csv_returns_text_csv_with_expected_rows(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    client, fake = fake_storage_client
    project_id, model_id, file_id = await _ready_file(client, fake, org_user, name="ok.ifc")

    details = [
        _detail(rule_id="R-1", element_name="Wall-A"),
        _detail(rule_id="R-2", status="warn", element_name="Wall-B"),
        _detail(rule_id="R-3", element_name="Wall-C"),
    ]
    await _seed_compliance_job(
        session_maker,
        UUID(org_user["organization_id"]),
        UUID(project_id),
        UUID(file_id),
        details=details,
    )

    resp = await client.get(
        f"/projects/{project_id}/models/{model_id}/files/{file_id}/compliance/export.csv",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 200, resp.text
    assert resp.headers["content-type"].startswith("text/csv")
    assert (
        f'filename="compliance-bbl-{file_id}.csv"' in resp.headers["content-disposition"]
    )

    reader = csv.DictReader(io.StringIO(resp.text))
    assert reader.fieldnames == EXPECTED_HEADERS
    rows = list(reader)
    assert len(rows) == 3
    assert [r["rule_id"] for r in rows] == ["R-1", "R-2", "R-3"]
    assert rows[1]["status"] == "warn"
    assert rows[0]["message"] == "Wall does not meet 60-min fire rating"


# ---------------------------------------------------------------------------
# Missing data
# ---------------------------------------------------------------------------


async def test_export_csv_404_when_no_succeeded_job(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, fake = fake_storage_client
    project_id, model_id, file_id = await _ready_file(
        client, fake, org_user, name="empty.ifc"
    )

    resp = await client.get(
        f"/projects/{project_id}/models/{model_id}/files/{file_id}/compliance/export.csv",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 404
    assert resp.json()["detail"] == "NO_COMPLIANCE_RESULTS"


# ---------------------------------------------------------------------------
# Membership gate
# ---------------------------------------------------------------------------


async def test_export_csv_non_member_returns_404(
    org_user: dict[str, str],
    other_org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    client, fake = fake_storage_client
    project_id, model_id, file_id = await _ready_file(
        client, fake, org_user, name="rls.ifc"
    )
    await _seed_compliance_job(
        session_maker,
        UUID(org_user["organization_id"]),
        UUID(project_id),
        UUID(file_id),
        details=[_detail()],
    )

    # User from a different org cannot see the project; expect 404, not 403.
    resp = await client.get(
        f"/projects/{project_id}/models/{model_id}/files/{file_id}/compliance/export.csv",
        headers=_auth(other_org_user["access_token"]),
    )
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Framework filter
# ---------------------------------------------------------------------------


async def test_export_csv_framework_filter_returns_only_matching_job(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    client, fake = fake_storage_client
    project_id, model_id, file_id = await _ready_file(
        client, fake, org_user, name="frmk.ifc"
    )

    await _seed_compliance_job(
        session_maker,
        UUID(org_user["organization_id"]),
        UUID(project_id),
        UUID(file_id),
        framework="bbl",
        details=[_detail(rule_id="BBL-ONLY")],
    )
    await _seed_compliance_job(
        session_maker,
        UUID(org_user["organization_id"]),
        UUID(project_id),
        UUID(file_id),
        framework="wkb",
        details=[_detail(rule_id="WKB-ONLY")],
    )

    wkb = await client.get(
        f"/projects/{project_id}/models/{model_id}/files/{file_id}"
        "/compliance/export.csv?framework=wkb",
        headers=_auth(org_user["access_token"]),
    )
    assert wkb.status_code == 200
    wkb_rows = list(csv.DictReader(io.StringIO(wkb.text)))
    assert [r["rule_id"] for r in wkb_rows] == ["WKB-ONLY"]
    assert f'filename="compliance-wkb-{file_id}.csv"' in wkb.headers["content-disposition"]

    bbl = await client.get(
        f"/projects/{project_id}/models/{model_id}/files/{file_id}"
        "/compliance/export.csv?framework=bbl",
        headers=_auth(org_user["access_token"]),
    )
    assert bbl.status_code == 200
    bbl_rows = list(csv.DictReader(io.StringIO(bbl.text)))
    assert [r["rule_id"] for r in bbl_rows] == ["BBL-ONLY"]


# ---------------------------------------------------------------------------
# /export-rules.csv (per-rule summary)
# ---------------------------------------------------------------------------


async def test_export_rules_csv_returns_rule_summary_rows(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    client, fake = fake_storage_client
    project_id, model_id, file_id = await _ready_file(
        client, fake, org_user, name="rules.ifc"
    )

    rules = [
        _rule_summary(rule_id="R-1", title="Fire safety", passed=10, failed=2),
        _rule_summary(
            rule_id="R-2",
            title="Egress width",
            category="usability",
            passed=5,
            warned=1,
            failed=0,
            total_checked=6,
        ),
        _rule_summary(
            rule_id="R-3", title="Insulation", category="health", passed=0, skipped=3
        ),
    ]
    await _seed_compliance_job(
        session_maker,
        UUID(org_user["organization_id"]),
        UUID(project_id),
        UUID(file_id),
        rules_summary=rules,
    )

    resp = await client.get(
        f"/projects/{project_id}/models/{model_id}/files/{file_id}"
        "/compliance/export-rules.csv",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 200, resp.text
    assert resp.headers["content-type"].startswith("text/csv")
    assert (
        f'filename="compliance-rules-bbl-{file_id}.csv"'
        in resp.headers["content-disposition"]
    )

    reader = csv.DictReader(io.StringIO(resp.text))
    assert reader.fieldnames == EXPECTED_RULES_HEADERS
    rows = list(reader)
    assert [r["rule_id"] for r in rows] == ["R-1", "R-2", "R-3"]
    assert rows[0]["title"] == "Fire safety"
    assert rows[0]["passed"] == "10"
    assert rows[0]["failed"] == "2"
    assert rows[1]["warned"] == "1"
    assert rows[2]["skipped"] == "3"


async def test_export_rules_csv_404_when_no_succeeded_job(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, fake = fake_storage_client
    project_id, model_id, file_id = await _ready_file(
        client, fake, org_user, name="rules-empty.ifc"
    )

    resp = await client.get(
        f"/projects/{project_id}/models/{model_id}/files/{file_id}"
        "/compliance/export-rules.csv",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 404
    assert resp.json()["detail"] == "NO_COMPLIANCE_RESULTS"


async def test_export_rules_csv_framework_filter(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    client, fake = fake_storage_client
    project_id, model_id, file_id = await _ready_file(
        client, fake, org_user, name="rules-frmk.ifc"
    )

    await _seed_compliance_job(
        session_maker,
        UUID(org_user["organization_id"]),
        UUID(project_id),
        UUID(file_id),
        framework="bbl",
        rules_summary=[_rule_summary(rule_id="BBL-1")],
    )
    await _seed_compliance_job(
        session_maker,
        UUID(org_user["organization_id"]),
        UUID(project_id),
        UUID(file_id),
        framework="wkb",
        rules_summary=[_rule_summary(rule_id="WKB-1")],
    )

    wkb = await client.get(
        f"/projects/{project_id}/models/{model_id}/files/{file_id}"
        "/compliance/export-rules.csv?framework=wkb",
        headers=_auth(org_user["access_token"]),
    )
    assert wkb.status_code == 200
    rows = list(csv.DictReader(io.StringIO(wkb.text)))
    assert [r["rule_id"] for r in rows] == ["WKB-1"]
    assert (
        f'filename="compliance-rules-wkb-{file_id}.csv"'
        in wkb.headers["content-disposition"]
    )


# ---------------------------------------------------------------------------
# Archived project
# ---------------------------------------------------------------------------


async def test_compliance_check_rejected_when_project_archived(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, fake = fake_storage_client
    project_id, model_id, file_id = await _ready_file(
        client, fake, org_user, name="arch.ifc"
    )

    archive = await client.post(
        f"/projects/{project_id}/archive",
        headers=_auth(org_user["access_token"]),
    )
    assert archive.status_code == 200

    resp = await client.post(
        f"/projects/{project_id}/models/{model_id}/files/{file_id}/compliance/check",
        json={"framework": "bbl"},
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 409
    assert resp.json()["detail"] == "PROJECT_ARCHIVED"


async def test_compliance_export_allowed_when_project_archived(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    client, fake = fake_storage_client
    project_id, model_id, file_id = await _ready_file(
        client, fake, org_user, name="arch-read.ifc"
    )
    await _seed_compliance_job(
        session_maker,
        UUID(org_user["organization_id"]),
        UUID(project_id),
        UUID(file_id),
    )

    archive = await client.post(
        f"/projects/{project_id}/archive",
        headers=_auth(org_user["access_token"]),
    )
    assert archive.status_code == 200

    resp = await client.get(
        f"/projects/{project_id}/models/{model_id}/files/{file_id}/compliance/export.csv",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 200
