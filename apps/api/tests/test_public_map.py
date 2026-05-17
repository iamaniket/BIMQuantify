"""Tests for GET /public/projects-map — anonymized aggregation for the login map."""

from __future__ import annotations

from typing import TYPE_CHECKING
from uuid import uuid4

import pytest

if TYPE_CHECKING:
    from httpx import AsyncClient
    from sqlalchemy.ext.asyncio import AsyncSession


async def _insert_project(
    session: "AsyncSession",
    *,
    org_id,
    owner_id,
    name: str,
    city: str | None,
    lat: float | None,
    lng: float | None,
) -> None:
    from bimstitch_api.models.project import Project

    project = Project(
        organization_id=org_id,
        owner_id=owner_id,
        name=name,
        city=city,
        latitude=lat,
        longitude=lng,
    )
    session.add(project)
    await session.commit()


async def _seed_org_and_user(session: "AsyncSession"):
    """Create a minimal org + user pair we can hang projects off of.

    We're not using the tenant fixtures because the public endpoint is
    deliberately org-agnostic — direct DB inserts keep the test focused.
    """
    from bimstitch_api.models.organization import Organization
    from bimstitch_api.models.user import User

    org = Organization(id=uuid4(), name=f"Org-{uuid4().hex[:6]}")
    user = User(
        id=uuid4(),
        email=f"u-{uuid4().hex[:6]}@example.com",
        hashed_password="x",
        is_active=True,
        is_verified=True,
        is_superuser=False,
        full_name="Owner",
        organization_id=org.id,
    )
    session.add_all([org, user])
    await session.commit()
    return org.id, user.id


@pytest.mark.asyncio
async def test_projects_map_returns_empty_when_no_projects(
    client: "AsyncClient",
) -> None:
    response = await client.get("/public/projects-map")
    assert response.status_code == 200
    assert response.json() == []


@pytest.mark.asyncio
async def test_projects_map_aggregates_by_city(
    client: "AsyncClient", session: "AsyncSession"
) -> None:
    org_id, owner_id = await _seed_org_and_user(session)

    # Two in Amsterdam at slightly different points, one in Schiphol.
    await _insert_project(
        session, org_id=org_id, owner_id=owner_id, name="P1",
        city="Amsterdam", lat=52.387, lng=4.876,
    )
    await _insert_project(
        session, org_id=org_id, owner_id=owner_id, name="P2",
        city="Amsterdam", lat=52.379, lng=4.901,
    )
    await _insert_project(
        session, org_id=org_id, owner_id=owner_id, name="P3",
        city="Schiphol", lat=52.301, lng=4.766,
    )

    response = await client.get("/public/projects-map")
    assert response.status_code == 200
    rows = {r["city"]: r for r in response.json()}
    assert set(rows.keys()) == {"Amsterdam", "Schiphol"}
    assert rows["Amsterdam"]["count"] == 2
    assert rows["Schiphol"]["count"] == 1
    # Averaged lat for Amsterdam ≈ 52.383
    assert 52.37 < rows["Amsterdam"]["lat"] < 52.40
    assert response.headers.get("cache-control", "").startswith("public")


@pytest.mark.asyncio
async def test_projects_map_ignores_projects_without_coordinates(
    client: "AsyncClient", session: "AsyncSession"
) -> None:
    org_id, owner_id = await _seed_org_and_user(session)
    await _insert_project(
        session, org_id=org_id, owner_id=owner_id, name="P1",
        city="Amsterdam", lat=52.387, lng=4.876,
    )
    await _insert_project(
        session, org_id=org_id, owner_id=owner_id, name="P-no-coords",
        city="Amsterdam", lat=None, lng=None,
    )
    await _insert_project(
        session, org_id=org_id, owner_id=owner_id, name="P-no-city",
        city=None, lat=52.0, lng=5.0,
    )

    response = await client.get("/public/projects-map")
    assert response.status_code == 200
    rows = response.json()
    assert len(rows) == 1
    assert rows[0]["city"] == "Amsterdam"
    assert rows[0]["count"] == 1


@pytest.mark.asyncio
async def test_projects_map_floors_count_to_one_significant_figure(
    client: "AsyncClient", session: "AsyncSession"
) -> None:
    """Per-city counts must be anonymized — exact tenant numbers never leak."""
    org_id, owner_id = await _seed_org_and_user(session)

    # 14 projects in Amsterdam — should floor to 10.
    for i in range(14):
        await _insert_project(
            session, org_id=org_id, owner_id=owner_id, name=f"AMS-{i}",
            city="Amsterdam", lat=52.38, lng=4.89,
        )
    # 3 projects in Rotterdam — below the rounding threshold, stays exact.
    for i in range(3):
        await _insert_project(
            session, org_id=org_id, owner_id=owner_id, name=f"RTM-{i}",
            city="Rotterdam", lat=51.92, lng=4.48,
        )

    response = await client.get("/public/projects-map")
    assert response.status_code == 200
    rows = {r["city"]: r for r in response.json()}
    assert rows["Amsterdam"]["count"] == 10
    assert rows["Rotterdam"]["count"] == 3


@pytest.mark.asyncio
async def test_projects_map_aggregates_across_orgs(
    client: "AsyncClient", session: "AsyncSession"
) -> None:
    """No org leakage — projects from different orgs at the same city are merged."""
    org_a, owner_a = await _seed_org_and_user(session)
    org_b, owner_b = await _seed_org_and_user(session)

    await _insert_project(
        session, org_id=org_a, owner_id=owner_a, name="P-A",
        city="Rotterdam", lat=51.92, lng=4.48,
    )
    await _insert_project(
        session, org_id=org_b, owner_id=owner_b, name="P-B",
        city="Rotterdam", lat=51.92, lng=4.48,
    )

    response = await client.get("/public/projects-map")
    assert response.status_code == 200
    rows = response.json()
    assert len(rows) == 1
    assert rows[0]["city"] == "Rotterdam"
    assert rows[0]["count"] == 2
