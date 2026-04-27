from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from bimstitch_api.models.organization import Organization


async def test_signup_creates_unverified_user(client: AsyncClient, email_transport: object) -> None:
    response = await client.post(
        "/auth/register",
        json={
            "email": "alice@example.com",
            "password": "hunter2hunter2",
            "full_name": "Alice Example",
            "organization_name": "Acme Co",
        },
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["email"] == "alice@example.com"
    assert body["full_name"] == "Alice Example"
    assert body["is_active"] is True
    assert body["is_verified"] is False
    assert body["organization_id"] is not None


async def test_signup_upserts_organization(
    client: AsyncClient, session: AsyncSession, email_transport: object
) -> None:
    payload = {
        "email": "bob@example.com",
        "password": "verysecret12",
        "full_name": "Bob",
        "organization_name": "Shared Org",
    }
    r1 = await client.post("/auth/register", json=payload)
    assert r1.status_code == 201
    payload2 = {**payload, "email": "carol@example.com", "full_name": "Carol"}
    r2 = await client.post("/auth/register", json=payload2)
    assert r2.status_code == 201
    assert r1.json()["organization_id"] == r2.json()["organization_id"]

    result = await session.execute(select(Organization).where(Organization.name == "Shared Org"))
    orgs = result.scalars().all()
    assert len(orgs) == 1


async def test_signup_rejects_duplicate_email(client: AsyncClient, email_transport: object) -> None:
    payload = {
        "email": "dup@example.com",
        "password": "pw12pw12pw",
        "full_name": "Dup",
        "organization_name": "X",
    }
    r1 = await client.post("/auth/register", json=payload)
    assert r1.status_code == 201
    r2 = await client.post("/auth/register", json=payload)
    assert r2.status_code == 400
