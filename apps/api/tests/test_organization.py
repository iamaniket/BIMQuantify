from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from bimquantify_api.models.organization import Organization
from bimquantify_api.models.user import User


async def test_two_users_same_org_share_organization_id(
    client: AsyncClient, session: AsyncSession, email_transport: object
) -> None:
    payload = {
        "password": "hunter2hunter2",
        "full_name": "X",
        "organization_name": "Together Inc",
    }
    r1 = await client.post("/auth/register", json={**payload, "email": "user1@example.com"})
    r2 = await client.post("/auth/register", json={**payload, "email": "user2@example.com"})
    assert r1.status_code == 201 and r2.status_code == 201
    assert r1.json()["organization_id"] == r2.json()["organization_id"]

    orgs = (
        (await session.execute(select(Organization).where(Organization.name == "Together Inc")))
        .scalars()
        .all()
    )
    assert len(orgs) == 1

    users = (
        (
            await session.execute(
                select(User).where(User.email.in_(["user1@example.com", "user2@example.com"]))
            )
        )
        .scalars()
        .all()
    )
    assert len(users) == 2
    assert users[0].organization_id == users[1].organization_id == orgs[0].id


async def test_different_org_names_produce_different_organizations(
    client: AsyncClient, session: AsyncSession, email_transport: object
) -> None:
    common = {"password": "hunter2hunter2", "full_name": "X"}
    await client.post(
        "/auth/register",
        json={**common, "email": "solo1@example.com", "organization_name": "Alpha"},
    )
    await client.post(
        "/auth/register",
        json={**common, "email": "solo2@example.com", "organization_name": "Beta"},
    )
    orgs = (await session.execute(select(Organization))).scalars().all()
    assert {o.name for o in orgs} == {"Alpha", "Beta"}
