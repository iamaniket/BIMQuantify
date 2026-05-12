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
async def test_duplicate_submissions_are_both_stored(
    client: "AsyncClient", session: "AsyncSession"
) -> None:
    """Two requests from the same email both land — admins de-dupe later."""
    await client.post("/access-requests", json=VALID_BODY)
    second = await client.post("/access-requests", json=VALID_BODY)
    assert second.status_code == 201

    from bimstitch_api.models.access_request import AccessRequest

    count = len((await session.execute(select(AccessRequest))).scalars().all())
    assert count == 2
