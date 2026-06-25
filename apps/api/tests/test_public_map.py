"""Tests for GET /public/projects-map — anonymized aggregation for the login map."""

from __future__ import annotations

from typing import TYPE_CHECKING
from uuid import UUID, uuid4

import pytest
from sqlalchemy import text

if TYPE_CHECKING:
    from httpx import AsyncClient
    from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker


async def _insert_project(
    session_maker: "async_sessionmaker[AsyncSession]",
    *,
    schema: str,
    owner_id: UUID,
    name: str,
    city: str | None,
    lat: float | None,
    lng: float | None,
) -> None:
    """Direct INSERT into the per-tenant schema. Bypasses the API because
    the public/projects-map endpoint is org-agnostic and we want to control
    exactly which schema each project lives in."""
    async with session_maker() as session:
        await session.execute(
            text(f'SET LOCAL search_path TO "{schema}", public')
        )
        await session.execute(
            text(
                "INSERT INTO projects (id, owner_id, name, city, latitude, longitude) "
                "VALUES (:id, :owner, :name, :city, :lat, :lng)"
            ),
            {
                "id": uuid4(),
                "owner": owner_id,
                "name": name,
                "city": city,
                "lat": lat,
                "lng": lng,
            },
        )
        await session.commit()


async def _seed_org_and_user(
    client: "AsyncClient",
    session_maker: "async_sessionmaker[AsyncSession]",
    engine: "AsyncEngine",
    *,
    email: str | None = None,
) -> tuple[str, UUID]:
    """Provision an org (with real tenant schema) and a verified user, then
    return the schema_name and user id ready for direct-INSERT helpers."""
    from tests.conftest import _provision_user_in_org

    info = await _provision_user_in_org(
        client,
        session_maker,
        engine,
        email=email or f"u-{uuid4().hex[:6]}@example.com",
    )
    org_id = UUID(info["organization_id"])
    from bimdossier_api.tenancy import schema_name_for

    return schema_name_for(org_id), UUID(info["id"])


@pytest.mark.asyncio
async def test_projects_map_returns_empty_when_no_projects(
    client: "AsyncClient",
) -> None:
    response = await client.get("/public/projects-map")
    assert response.status_code == 200
    assert response.json() == []


@pytest.mark.asyncio
async def test_projects_map_aggregates_by_city(
    client: "AsyncClient",
    session_maker: "async_sessionmaker[AsyncSession]",
    engine: "AsyncEngine",
) -> None:
    schema, owner_id = await _seed_org_and_user(client, session_maker, engine)

    await _insert_project(
        session_maker, schema=schema, owner_id=owner_id, name="P1",
        city="Amsterdam", lat=52.387, lng=4.876,
    )
    await _insert_project(
        session_maker, schema=schema, owner_id=owner_id, name="P2",
        city="Amsterdam", lat=52.379, lng=4.901,
    )
    await _insert_project(
        session_maker, schema=schema, owner_id=owner_id, name="P3",
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
    client: "AsyncClient",
    session_maker: "async_sessionmaker[AsyncSession]",
    engine: "AsyncEngine",
) -> None:
    schema, owner_id = await _seed_org_and_user(client, session_maker, engine)
    await _insert_project(
        session_maker, schema=schema, owner_id=owner_id, name="P1",
        city="Amsterdam", lat=52.387, lng=4.876,
    )
    await _insert_project(
        session_maker, schema=schema, owner_id=owner_id, name="P-no-coords",
        city="Amsterdam", lat=None, lng=None,
    )
    await _insert_project(
        session_maker, schema=schema, owner_id=owner_id, name="P-no-city",
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
    client: "AsyncClient",
    session_maker: "async_sessionmaker[AsyncSession]",
    engine: "AsyncEngine",
) -> None:
    """Per-city counts must be anonymized — exact tenant numbers never leak."""
    schema, owner_id = await _seed_org_and_user(client, session_maker, engine)

    # 14 projects in Amsterdam — should floor to 10.
    for i in range(14):
        await _insert_project(
            session_maker, schema=schema, owner_id=owner_id, name=f"AMS-{i}",
            city="Amsterdam", lat=52.38, lng=4.89,
        )
    # 3 projects in Rotterdam — below the rounding threshold, stays exact.
    for i in range(3):
        await _insert_project(
            session_maker, schema=schema, owner_id=owner_id, name=f"RTM-{i}",
            city="Rotterdam", lat=51.92, lng=4.48,
        )

    response = await client.get("/public/projects-map")
    assert response.status_code == 200
    rows = {r["city"]: r for r in response.json()}
    assert rows["Amsterdam"]["count"] == 10
    assert rows["Rotterdam"]["count"] == 3


@pytest.mark.asyncio
async def test_projects_map_aggregates_across_orgs(
    client: "AsyncClient",
    session_maker: "async_sessionmaker[AsyncSession]",
    engine: "AsyncEngine",
) -> None:
    """No org leakage — projects from different orgs at the same city are merged."""
    schema_a, owner_a = await _seed_org_and_user(
        client, session_maker, engine, email="a@example.com"
    )
    schema_b, owner_b = await _seed_org_and_user(
        client, session_maker, engine, email="b@example.com"
    )

    await _insert_project(
        session_maker, schema=schema_a, owner_id=owner_a, name="P-A",
        city="Rotterdam", lat=51.92, lng=4.48,
    )
    await _insert_project(
        session_maker, schema=schema_b, owner_id=owner_b, name="P-B",
        city="Rotterdam", lat=51.92, lng=4.48,
    )

    response = await client.get("/public/projects-map")
    assert response.status_code == 200
    rows = response.json()
    assert len(rows) == 1
    assert rows[0]["city"] == "Rotterdam"
    assert rows[0]["count"] == 2
