"""Seed default users for local development.

Usage:
    uv run python -m bimstitch_api.seed
"""

import asyncio

from fastapi_users.password import PasswordHelper
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from bimstitch_api.db import get_engine, get_session_maker
from bimstitch_api.models.organization import Organization
from bimstitch_api.models.user import User

SEED_ORG = "BIMstitch"

SEED_USERS = [
    {
        "email": "superadmin@bimstitch.dev",
        "password": "SuperAdmin123!",
        "full_name": "Super Admin",
        "is_superuser": True,
        "is_verified": True,
    },
    {
        "email": "admin@bimstitch.dev",
        "password": "Admin123!",
        "full_name": "Admin",
        "is_superuser": True,
        "is_verified": True,
    },
    {
        "email": "user@bimstitch.dev",
        "password": "User123!",
        "full_name": "Normal User",
        "is_superuser": False,
        "is_verified": True,
    },
]


async def _upsert_organization(session) -> Organization:
    result = await session.execute(
        select(Organization).where(Organization.name == SEED_ORG)
    )
    org = result.scalar_one_or_none()
    if org is not None:
        return org

    org = Organization(name=SEED_ORG)
    session.add(org)
    try:
        await session.flush()
    except IntegrityError:
        await session.rollback()
        result = await session.execute(
            select(Organization).where(Organization.name == SEED_ORG)
        )
        org = result.scalar_one()
    return org


async def seed() -> None:
    # Ensure engine is initialised
    get_engine()
    password_helper = PasswordHelper()

    async with get_session_maker()() as session:
        org = await _upsert_organization(session)

        for data in SEED_USERS:
            result = await session.execute(
                select(User).where(User.email == data["email"])
            )
            if result.scalar_one_or_none() is not None:
                print(f"  Already exists: {data['email']}")
                continue

            user = User(
                email=data["email"],
                hashed_password=password_helper.hash(data["password"]),
                full_name=data["full_name"],
                is_superuser=data["is_superuser"],
                is_verified=data["is_verified"],
                is_active=True,
                organization_id=org.id,
            )
            session.add(user)
            print(f"  Created: {data['email']}")

        await session.commit()
    print("Seed complete.")


if __name__ == "__main__":
    asyncio.run(seed())
