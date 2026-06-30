"""Tests for the free-tier findings export (CSV / XLSX / JSON).

Mirrors the paid `/projects/{id}/findings/export.*` surface over pooled
`pooled_findings`, reusing the paid column set + row builder. Access is gated on
project participation (owner or member); a non-participant gets 404.
"""

import csv
import io

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from tests.conftest import FakeStorage
from tests.test_free_projects import _create_project
from tests.test_free_viewer import _auth, _create_document, _free_token

_XLSX_MAGIC = b"PK\x03\x04"  # xlsx is a zip


async def _seed_two_snags(client: AsyncClient, token: str, owner_id: str) -> str:
    """Create a project + container with one assigned snag (deadline) and one
    plain snag. Returns the project id."""
    pid = await _create_project(client, token, name="Export")
    pid = pid["id"]
    did = await _create_document(client, token, pid)

    assigned = await client.post(
        f"/pooled/documents/{did}/findings",
        json={
            "title": "Assigned beam",
            "note": "grid C3",
            "severity": "high",
            "assigned_to_user_id": owner_id,
            "deadline_date": "2027-03-01",
        },
        headers=_auth(token),
    )
    assert assigned.status_code == 201, assigned.text
    plain = await client.post(
        f"/pooled/documents/{did}/findings",
        json={"title": "Plain crack", "severity": "low"},
        headers=_auth(token),
    )
    assert plain.status_code == 201, plain.text
    return pid


async def test_pooled_findings_export_csv(
    free_tier_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    client, _ = free_tier_storage_client
    email = "free-export-csv@example.com"
    token = await _free_token(client, session_maker, email)
    created = await _create_project(client, token, name="probe")
    owner_id = created["owner_id"]
    pid = await _seed_two_snags(client, token, owner_id)

    resp = await client.get(
        f"/pooled/projects/{pid}/findings/export.csv", headers=_auth(token)
    )
    assert resp.status_code == 200, resp.text
    assert resp.headers["content-type"].startswith("text/csv")

    rows = list(csv.DictReader(io.StringIO(resp.text)))
    assert {r["title"] for r in rows} == {"Assigned beam", "Plain crack"}
    by_title = {r["title"]: r for r in rows}
    # Free values flow straight through; paid-only columns are blank/zero.
    assert by_title["Assigned beam"]["severity"] == "high"
    assert by_title["Assigned beam"]["status"] == "open"
    assert by_title["Assigned beam"]["deadline_date"] == "2027-03-01"
    assert by_title["Assigned beam"]["bbl_article_ref"] == ""
    assert by_title["Assigned beam"]["photo_count"] == "0"
    # Assignee + creator names resolve past the users RLS (superuser session).
    # make_test_user sets full_name = email local part.
    expected_name = email.split("@")[0]
    assert by_title["Assigned beam"]["assignee"] == expected_name
    assert by_title["Assigned beam"]["created_by"] == expected_name
    assert by_title["Plain crack"]["assignee"] == ""
    assert by_title["Plain crack"]["created_by"] == expected_name


async def test_pooled_findings_export_xlsx(
    free_tier_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    client, _ = free_tier_storage_client
    token = await _free_token(client, session_maker, "free-export-xlsx@example.com")
    created = await _create_project(client, token, name="probe")
    pid = await _seed_two_snags(client, token, created["owner_id"])

    resp = await client.get(
        f"/pooled/projects/{pid}/findings/export.xlsx", headers=_auth(token)
    )
    assert resp.status_code == 200, resp.text
    assert "spreadsheetml" in resp.headers["content-type"]
    assert resp.content[:4] == _XLSX_MAGIC


async def test_pooled_findings_export_json(
    free_tier_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    client, _ = free_tier_storage_client
    token = await _free_token(client, session_maker, "free-export-json@example.com")
    created = await _create_project(client, token, name="probe")
    pid = await _seed_two_snags(client, token, created["owner_id"])

    resp = await client.get(
        f"/pooled/projects/{pid}/findings/export.json", headers=_auth(token)
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["count"] == 2
    assert {f["title"] for f in body["findings"]} == {"Assigned beam", "Plain crack"}


async def test_pooled_findings_export_non_participant_404(
    free_tier_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """A free user who neither owns nor is a member of the project can't export."""
    client, _ = free_tier_storage_client
    owner_token = await _free_token(client, session_maker, "free-export-owner@example.com")
    created = await _create_project(client, owner_token, name="probe")
    pid = await _seed_two_snags(client, owner_token, created["owner_id"])

    stranger = await _free_token(client, session_maker, "free-export-stranger@example.com")
    for fmt in ("csv", "xlsx", "json"):
        resp = await client.get(
            f"/pooled/projects/{pid}/findings/export.{fmt}", headers=_auth(stranger)
        )
        assert resp.status_code == 404, f"{fmt}: {resp.text}"
