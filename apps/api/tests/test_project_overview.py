"""Integration tests for the aggregate project-overview endpoint.

`GET /projects/{id}/overview` consolidates the ~10 calls the dashboard used to
fire into one. These tests pin: structure on an empty project, exact counts +
capped previews, that the completeness donut matches the per-deadline readiness
endpoint (the de-dup guard), head-of-group correctness, presigned URLs, and
tenant isolation.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from bimdossier_api.jurisdictions import get_dossier_requirements
from tests.conftest import (
    VALID_IFC_HEADER,
    _auth,
    _create_attachment_row,
    _create_document,
    _create_project,
    _new_hash,
)

if TYPE_CHECKING:
    from httpx import AsyncClient

    from tests.conftest import FakeStorage


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _overview(client: AsyncClient, token: str, project_id: str) -> dict:
    resp = await client.get(f"/projects/{project_id}/overview", headers=_auth(token))
    assert resp.status_code == 200, resp.text
    return resp.json()


async def _create_project_with_dates(
    client: AsyncClient,
    token: str,
    *,
    name: str = "Overview Project",
    planned_start_date: str | None = "2026-09-01",
    delivery_date: str | None = "2027-03-01",
) -> dict:
    payload: dict[str, object] = {"name": name}
    if planned_start_date is not None:
        payload["planned_start_date"] = planned_start_date
    if delivery_date is not None:
        payload["delivery_date"] = delivery_date
    resp = await client.post("/projects", json=payload, headers=_auth(token))
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _create_finding(client: AsyncClient, token: str, project_id: str, title: str) -> dict:
    resp = await client.post(
        f"/projects/{project_id}/findings",
        json={"title": title, "description": "x"},
        headers=_auth(token),
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _create_ready_certificate(
    client: AsyncClient,
    fake: FakeStorage,
    token: str,
    project_id: str,
    *,
    certificate_type: str = "product",
    valid_until: str | None = None,
) -> dict:
    init = (
        await client.post(
            f"/projects/{project_id}/certificates/initiate",
            json={
                "filename": "c.pdf",
                "size_bytes": 100,
                "content_type": "application/pdf",
                "content_sha256": _new_hash(),
                "certificate_type": certificate_type,
                "valid_until": valid_until,
            },
            headers=_auth(token),
        )
    ).json()
    fake.objects[init["storage_key"]] = b"x" * 100
    resp = await client.post(
        f"/projects/{project_id}/certificates/{init['certificate_id']}/complete",
        headers=_auth(token),
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


# ---------------------------------------------------------------------------
# Structure / empty project
# ---------------------------------------------------------------------------


async def test_overview_empty_project(client: AsyncClient, org_user: dict[str, str]) -> None:
    token = org_user["access_token"]
    project = await _create_project(client, token, "Empty Overview")

    data = await _overview(client, token, project["id"])

    assert data["project"]["id"] == project["id"]
    assert data["project"]["my_role"] == "owner"

    for key in ("findings", "certificates", "attachments", "reports"):
        assert data[key]["count"] == 0
        assert data[key]["preview"] == []

    assert data["findings"]["open"] == 0
    assert data["certificates"]["expired"] == 0
    assert data["certificates"]["expiring_soon"] == 0

    # No dates → all 3 NL deadlines are not_applicable: header counts all 3,
    # the donut wedge (non-applicable excluded) counts 0.
    assert data["deadlines"]["total"] == 3
    assert data["deadlines"]["met"] == 0
    assert data["deadlines"]["overdue"] == 0
    assert len(data["deadlines"]["preview"]) == 3

    assert len(data["members"]) == 1  # owner only

    comp = data["completeness"]
    assert comp["findings"]["total"] == 0
    assert comp["findings"]["complete"] == 0
    assert comp["deadlines"]["total"] == 0
    assert len(comp["dossier"]["items"]) == len(get_dossier_requirements("NL", None))

    stats = data["stats"]
    assert stats["deadlines_total"] == 3
    assert stats["attachments_count"] == 0
    assert stats["holdback_pct"] == comp["dossier"]["pct"]
    assert stats["delivery_days_remaining"] is None

    # The project.created audit row lands in the current week's bucket.
    assert isinstance(data["activity_timeline"], list)
    assert len(data["activity_timeline"]) >= 1


# ---------------------------------------------------------------------------
# Counts + capped previews
# ---------------------------------------------------------------------------


async def test_overview_findings_counts_and_breakdown(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    token = org_user["access_token"]
    project = await _create_project(client, token, "Findings Overview")
    for i in range(3):
        await _create_finding(client, token, project["id"], f"F{i}")

    data = await _overview(client, token, project["id"])

    assert data["findings"]["count"] == 3
    assert data["findings"]["open"] == 0  # all draft
    assert len(data["findings"]["preview"]) == 3
    by_status = data["completeness"]["findings"]["by_status"]
    assert by_status["draft"] == 3
    assert data["completeness"]["findings"]["total"] == 3
    assert data["completeness"]["findings"]["complete"] == 0


async def test_overview_preview_capped_at_8(client: AsyncClient, org_user: dict[str, str]) -> None:
    token = org_user["access_token"]
    project = await _create_project(client, token, "Cap Overview")
    for i in range(10):
        await _create_finding(client, token, project["id"], f"F{i:02d}")

    data = await _overview(client, token, project["id"])

    assert data["findings"]["count"] == 10
    assert len(data["findings"]["preview"]) == 8  # OVERVIEW_PREVIEW_LIMIT


async def test_overview_attachments_count_and_preview(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    token = org_user["access_token"]
    project = await _create_project(client, token, "Attach Overview")
    await _create_attachment_row(project["id"])
    await _create_attachment_row(project["id"])

    data = await _overview(client, token, project["id"])

    assert data["attachments"]["count"] == 2
    assert len(data["attachments"]["preview"]) == 2
    assert data["stats"]["attachments_count"] == 2


async def test_overview_certificate_expiry_counts(
    org_user: dict[str, str],
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, fake = fake_storage_client
    token = org_user["access_token"]
    project = await _create_project(client, token, "Cert Overview")

    # One never-expires, one already expired, one expiring within 30 days.
    await _create_ready_certificate(client, fake, token, project["id"])
    await _create_ready_certificate(client, fake, token, project["id"], valid_until="2000-01-01")
    await _create_ready_certificate(client, fake, token, project["id"], valid_until="2099-01-01")

    data = await _overview(client, token, project["id"])

    assert data["certificates"]["count"] == 3
    assert data["certificates"]["expired"] == 1
    assert data["certificates"]["expiring_soon"] == 0  # 2099 is far future, never-expires is null
    assert len(data["certificates"]["preview"]) == 3


# ---------------------------------------------------------------------------
# Keystone: completeness == readiness (de-dup guard)
# ---------------------------------------------------------------------------


async def test_overview_completeness_matches_readiness(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    """The overview's dossier items must agree, per code, with the per-deadline
    readiness endpoint — proving both compute fulfillment from one place."""
    client, fake = fake_storage_client
    token = org_user["access_token"]
    project = await _create_project_with_dates(client, token, name="Keystone")

    # Make the model-backed "drawings" requirement fulfilled (viewable IFC).
    model = await _create_document(client, token, project["id"], name="m")
    init = (
        await client.post(
            f"/projects/{project['id']}/documents/{model['id']}/files/initiate",
            json={
                "filename": "m.ifc",
                "size_bytes": len(VALID_IFC_HEADER),
                "content_type": "application/octet-stream",
                "content_sha256": "1" * 64,
            },
            headers=_auth(token),
        )
    ).json()
    fake.objects[init["storage_key"]] = VALID_IFC_HEADER
    await client.post(
        f"/projects/{project['id']}/documents/{model['id']}/files/{init['file_id']}/complete",
        headers=_auth(token),
    )
    await client.post(
        "/internal/jobs/callback",
        json={
            "file_id": init["file_id"],
            "organization_id": org_user["organization_id"],
            "status": "succeeded",
            "fragments_key": f"projects/{project['id']}/{init['file_id']}.frag",
            "metadata_key": f"projects/{project['id']}/{init['file_id']}.metadata.json",
            "properties_key": f"projects/{project['id']}/{init['file_id']}.properties.json",
        },
        headers={"Authorization": "Bearer dev-shared-secret-change-me"},
    )

    # Readiness for the completion notification — the full dossier checklist.
    deadlines = (
        await client.get(f"/projects/{project['id']}/deadlines", headers=_auth(token))
    ).json()
    dl = next(d for d in deadlines if d["deadline_type"] == "completion_notification")
    readiness = (
        await client.get(
            f"/projects/{project['id']}/deadlines/{dl['id']}/readiness",
            headers=_auth(token),
        )
    ).json()

    data = await _overview(client, token, project["id"])
    items_by_code = {it["code"]: it for it in data["completeness"]["dossier"]["items"]}

    assert readiness["items"], "expected a non-empty dossier checklist"
    for r_item in readiness["items"]:
        o_item = items_by_code[r_item["code"]]
        assert o_item["fulfilled"] == r_item["fulfilled"], r_item["code"]
        assert o_item["count"] == r_item["count"], r_item["code"]

    # Drawings is fulfilled in both views.
    assert items_by_code["drawings"]["fulfilled"] is True
    assert items_by_code["drawings"]["count"] == 1


async def test_overview_thumbnail_url_presigned(
    org_user: dict[str, str],
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, _fake = fake_storage_client
    token = org_user["access_token"]
    resp = await client.post(
        "/projects/with-thumbnail",
        data={"name": "Thumb Overview"},
        files={"thumbnail": ("t.png", b"\x89PNG\r\n", "image/png")},
        headers=_auth(token),
    )
    assert resp.status_code == 201, resp.text
    project = resp.json()

    data = await _overview(client, token, project["id"])
    assert data["project"]["thumbnail_url"].startswith("http://fake-storage/thumbnails/")


# ---------------------------------------------------------------------------
# Tenant isolation
# ---------------------------------------------------------------------------


async def test_overview_cross_org_404(
    client: AsyncClient,
    org_user: dict[str, str],
    other_org_user: dict[str, str],
) -> None:
    project = await _create_project(client, org_user["access_token"], "Isolated")
    resp = await client.get(
        f"/projects/{project['id']}/overview",
        headers=_auth(other_org_user["access_token"]),
    )
    assert resp.status_code == 404, resp.text
