"""Tests for POST /access-requests — lead capture from the marketing site."""

from __future__ import annotations

from typing import TYPE_CHECKING

import pytest
from sqlalchemy import select

if TYPE_CHECKING:
    from httpx import AsyncClient
    from sqlalchemy.ext.asyncio import AsyncSession


VALID_BODY = {
    "name": "Lieke Beumer",
    "work_email": "lieke@heijmans.nl",
    "company": "Heijmans Bouw N.V.",
    "role": "BIM Manager / BIM-coördinator",
    "company_size": "201-500",
    "country": "NL",
    "notes": "Interested in Wkb dossier workflow.",
    "terms_accepted": True,
}


@pytest.mark.asyncio
async def test_create_access_request_happy_path(
    client: "AsyncClient", session: "AsyncSession"
) -> None:
    response = await client.post("/access-requests", json=VALID_BODY)
    assert response.status_code == 201, response.text

    body = response.json()
    assert body["name"] == "Lieke Beumer"
    assert body["work_email"] == "lieke@heijmans.nl"
    assert body["status"] == "new"
    assert "id" in body and "created_at" in body

    from bimstitch_api.models.access_request import AccessRequest

    rows = (await session.execute(select(AccessRequest))).scalars().all()
    assert len(rows) == 1
    assert rows[0].company == "Heijmans Bouw N.V."
    assert rows[0].country == "NL"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "free_email",
    [
        "me@gmail.com",
        "user@hotmail.com",
        "x@outlook.com",
        "y@yahoo.co.uk",
        "z@ziggo.nl",
    ],
)
async def test_create_access_request_rejects_free_email(
    client: "AsyncClient", free_email: str
) -> None:
    body = {**VALID_BODY, "work_email": free_email}
    response = await client.post("/access-requests", json=body)
    assert response.status_code == 422
    detail_text = str(response.json()["detail"])
    assert "work email" in detail_text or "personal address" in detail_text


@pytest.mark.asyncio
async def test_create_access_request_requires_terms(
    client: "AsyncClient",
) -> None:
    body = {**VALID_BODY, "terms_accepted": False}
    response = await client.post("/access-requests", json=body)
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_create_access_request_requires_full_name(
    client: "AsyncClient",
) -> None:
    body = {**VALID_BODY, "name": "Lieke"}
    response = await client.post("/access-requests", json=body)
    assert response.status_code == 422
    assert "full name" in str(response.json()["detail"]).lower()


@pytest.mark.asyncio
async def test_create_access_request_rejects_unknown_company_size(
    client: "AsyncClient",
) -> None:
    body = {**VALID_BODY, "company_size": "huge"}
    response = await client.post("/access-requests", json=body)
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_create_access_request_accepts_endash_size(
    client: "AsyncClient",
) -> None:
    body = {**VALID_BODY, "company_size": "11–50"}
    response = await client.post("/access-requests", json=body)
    assert response.status_code == 201, response.text
    assert response.json()["company_size"] == "11-50"


@pytest.mark.asyncio
async def test_submit_same_email_with_pending_returns_409(
    client: "AsyncClient", session: "AsyncSession"
) -> None:
    """While a prior request is still `new`, a second one from the same email
    is rejected with a friendly code so the form can show 'we have it'."""
    first = await client.post("/access-requests", json=VALID_BODY)
    assert first.status_code == 201

    second = await client.post("/access-requests", json=VALID_BODY)
    assert second.status_code == 409
    assert second.json()["detail"] == "ACCESS_REQUEST_PENDING_DUPLICATE"

    from bimstitch_api.models.access_request import AccessRequest

    count = len((await session.execute(select(AccessRequest))).scalars().all())
    assert count == 1, "second submission must not have created a row"


@pytest.mark.asyncio
async def test_submit_same_email_after_approved_returns_409(
    client: "AsyncClient", session: "AsyncSession"
) -> None:
    """Once a request has been approved, the prospect's account exists —
    further form submissions point them at their email instead of creating
    another row."""
    from bimstitch_api.models.access_request import AccessRequest, AccessRequestStatus

    first = await client.post("/access-requests", json=VALID_BODY)
    assert first.status_code == 201

    # Flip to approved (skipping the real saga — we're testing the route, not
    # provisioning).
    row = (await session.execute(select(AccessRequest))).scalar_one()
    row.status = AccessRequestStatus.approved
    await session.commit()

    second = await client.post("/access-requests", json=VALID_BODY)
    assert second.status_code == 409
    assert second.json()["detail"] == "ACCESS_REQUEST_ALREADY_APPROVED"


@pytest.mark.asyncio
async def test_submit_same_email_after_rejected_allowed(
    client: "AsyncClient", session: "AsyncSession"
) -> None:
    """A previously-rejected applicant can retry — they may have addressed
    whatever caused the rejection."""
    from bimstitch_api.models.access_request import AccessRequest, AccessRequestStatus

    first = await client.post("/access-requests", json=VALID_BODY)
    assert first.status_code == 201

    row = (await session.execute(select(AccessRequest))).scalar_one()
    row.status = AccessRequestStatus.rejected
    await session.commit()

    second = await client.post("/access-requests", json=VALID_BODY)
    assert second.status_code == 201, second.text

    # Both rows must exist — the rejected one and the brand-new one.
    rows = (await session.execute(select(AccessRequest))).scalars().all()
    assert len(rows) == 2
    statuses = sorted(r.status.value for r in rows)
    assert statuses == ["new", "rejected"]
