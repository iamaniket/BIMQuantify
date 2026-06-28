"""Tests for GET /projects/{p}/findings/export.csv (#G2).

Creates findings through the API, then hits the export endpoint and asserts on
the CSV body. Mirrors the compliance CSV export tests (A17/A18).
"""

from __future__ import annotations

import csv
import io
from typing import TYPE_CHECKING
from uuid import UUID, uuid4

from tests.conftest import _audit_rows, _auth, _create_project

if TYPE_CHECKING:
    from httpx import AsyncClient
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

EXPECTED_HEADERS = [
    "id",
    "title",
    "description",
    "severity",
    "status",
    "bbl_article_ref",
    "assignee",
    "deadline_date",
    "created_by",
    "created_at",
    "updated_at",
    "element_reference",
    "photo_count",
    "resolution_evidence_count",
    "resolution_note",
]


async def _create_finding(
    client: AsyncClient,
    token: str,
    project_id: str,
    *,
    title: str = "Bevinding",
    severity: str = "medium",
    **fields: object,
) -> dict:
    resp = await client.post(
        f"/projects/{project_id}/findings",
        json={
            "title": title,
            "description": "Test omschrijving",
            "severity": severity,
            **fields,
        },
        headers=_auth(token),
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


async def test_export_csv_headers_and_rows(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    token = org_user["access_token"]
    project = await _create_project(client, token, name="export-p")
    await _create_finding(client, token, project["id"], title="Alpha", severity="high")
    await _create_finding(client, token, project["id"], title="Beta", severity="low")

    resp = await client.get(
        f"/projects/{project['id']}/findings/export.csv",
        headers=_auth(token),
    )
    assert resp.status_code == 200, resp.text
    assert resp.headers["content-type"].startswith("text/csv")
    assert f'filename="findings-{project["id"]}.csv"' in resp.headers["content-disposition"]

    reader = csv.DictReader(io.StringIO(resp.text))
    assert reader.fieldnames == EXPECTED_HEADERS
    rows = list(reader)
    assert len(rows) == 2
    titles = {r["title"] for r in rows}
    assert titles == {"Alpha", "Beta"}
    by_title = {r["title"]: r for r in rows}
    assert by_title["Alpha"]["severity"] == "high"
    assert by_title["Beta"]["severity"] == "low"
    # The creator is the org user — display name (or email) lands in the column.
    assert by_title["Alpha"]["created_by"] != ""
    assert by_title["Alpha"]["status"] == "draft"


async def test_export_csv_severity_filter(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    token = org_user["access_token"]
    project = await _create_project(client, token, name="export-sev")
    await _create_finding(client, token, project["id"], title="Hi", severity="high")
    await _create_finding(client, token, project["id"], title="Lo", severity="low")

    resp = await client.get(
        f"/projects/{project['id']}/findings/export.csv?severity=high",
        headers=_auth(token),
    )
    assert resp.status_code == 200, resp.text
    rows = list(csv.DictReader(io.StringIO(resp.text)))
    assert [r["title"] for r in rows] == ["Hi"]


async def test_export_csv_assignee_filter(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    token = org_user["access_token"]
    project = await _create_project(client, token, name="export-assignee")
    assigned = await _create_finding(client, token, project["id"], title="Mine")
    await _create_finding(client, token, project["id"], title="Theirs")

    # Assign one finding to the org user (a project member). No promotion — the
    # finding stays a draft, so no deadline is required.
    patch = await client.patch(
        f"/projects/{project['id']}/findings/{assigned['id']}",
        json={"assignee_user_id": org_user["id"]},
        headers=_auth(token),
    )
    assert patch.status_code == 200, patch.text

    mine = await client.get(
        f"/projects/{project['id']}/findings/export.csv?assignee_user_id={org_user['id']}",
        headers=_auth(token),
    )
    assert mine.status_code == 200
    mine_rows = list(csv.DictReader(io.StringIO(mine.text)))
    assert [r["title"] for r in mine_rows] == ["Mine"]
    assert mine_rows[0]["assignee"] != ""

    # A non-matching assignee filter yields no rows (header only).
    none = await client.get(
        f"/projects/{project['id']}/findings/export.csv?assignee_user_id={uuid4()}",
        headers=_auth(token),
    )
    assert none.status_code == 200
    assert list(csv.DictReader(io.StringIO(none.text))) == []


async def test_export_csv_excludes_soft_deleted(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    token = org_user["access_token"]
    project = await _create_project(client, token, name="export-del")
    keep = await _create_finding(client, token, project["id"], title="Keep")
    drop = await _create_finding(client, token, project["id"], title="Drop")

    deleted = await client.delete(
        f"/projects/{project['id']}/findings/{drop['id']}",
        headers=_auth(token),
    )
    assert deleted.status_code == 204

    resp = await client.get(
        f"/projects/{project['id']}/findings/export.csv",
        headers=_auth(token),
    )
    assert resp.status_code == 200
    rows = list(csv.DictReader(io.StringIO(resp.text)))
    assert [r["title"] for r in rows] == ["Keep"]
    assert keep["id"] == rows[0]["id"]


async def test_export_csv_non_member_returns_404(
    client: AsyncClient,
    org_user: dict[str, str],
    other_org_user: dict[str, str],
) -> None:
    project = await _create_project(client, org_user["access_token"], name="export-rls")
    await _create_finding(client, org_user["access_token"], project["id"], title="Secret")

    # A user from a different org can't see the project — 404, not 403.
    resp = await client.get(
        f"/projects/{project['id']}/findings/export.csv",
        headers=_auth(other_org_user["access_token"]),
    )
    assert resp.status_code == 404


async def test_export_csv_writes_audit_row(
    client: AsyncClient,
    org_user: dict[str, str],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """A full-project findings dump is an exfiltration surface, so it leaves a
    forensic trail: one ``finding.exported`` row in the org schema carrying
    count + filters + actor + IP (project_id makes it show in the activity
    feed), never the finding rows themselves."""
    token = org_user["access_token"]
    project = await _create_project(client, token, name="export-audit")
    await _create_finding(client, token, project["id"], title="Hi", severity="high")
    await _create_finding(client, token, project["id"], title="Lo", severity="low")

    resp = await client.get(
        f"/projects/{project['id']}/findings/export.csv?severity=high",
        headers=_auth(token),
    )
    assert resp.status_code == 200, resp.text

    rows = await _audit_rows(session_maker, "finding.exported")
    assert len(rows) == 1
    row = rows[0]
    assert row.resource_type == "finding"
    assert str(row.project_id) == project["id"]
    assert row.user_id == UUID(org_user["id"])
    assert row.after is not None
    # The severity=high filter narrowed the dump to one of the two findings.
    assert row.after["count"] == 1
    assert row.after["filters"]["severity"] == "high"
    assert row.after["filters"]["status"] is None
    assert row.after["filters"]["assignee_user_id"] is None
