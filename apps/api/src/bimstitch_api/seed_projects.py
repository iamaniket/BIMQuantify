"""Seed sample projects across NL with WGS84 coordinates.

Populates a few projects in different cities so the public projects-map
endpoint returns interesting data. Idempotent — safe to re-run.

Usage:
    uv run python -m bimstitch_api.seed_projects
"""

from __future__ import annotations

import asyncio

from sqlalchemy import select

from bimstitch_api.db import get_engine, get_session_maker
from bimstitch_api.models.organization import Organization
from bimstitch_api.models.project import Project
from bimstitch_api.models.user import User

# Real Dutch cities with approximate WGS84 centroids.
SAMPLE_PROJECTS = [
    ("Kade 17 — Houthavens", "Amsterdam", 52.3960, 4.8830),
    ("CS-Oost dossier", "Amsterdam", 52.3790, 4.9020),
    ("Park Tower Zuidas", "Amsterdam", 52.3410, 4.8730),
    ("Sluishuis B", "Amsterdam", 52.3590, 5.0050),
    ("Logistiek Park Schiphol", "Schiphol", 52.3010, 4.7660),
    ("Maashaven Tower", "Rotterdam", 51.8950, 4.4830),
    ("Central Station West", "Utrecht", 52.0890, 5.1100),
    ("Strijp-T Loft", "Eindhoven", 51.4470, 5.4520),
    ("Groningen Hoofdstation", "Groningen", 53.2110, 6.5640),
    ("Stadshart Zoetermeer", "Zoetermeer", 52.0600, 4.4920),
    ("Wagenwerkplaats", "Amersfoort", 52.1530, 5.3780),
    ("Wijnhaven", "Den Haag", 52.0750, 4.3100),
]


async def seed_projects() -> None:
    get_engine()
    async with get_session_maker()() as session:
        org = (await session.execute(select(Organization))).scalars().first()
        if org is None:
            print("No organization found — run `python -m bimstitch_api.seed` first.")
            return
        user = (
            await session.execute(select(User).where(User.organization_id == org.id))
        ).scalars().first()
        if user is None:
            print("No user found — run `python -m bimstitch_api.seed` first.")
            return

        for name, city, lat, lng in SAMPLE_PROJECTS:
            existing = (
                await session.execute(
                    select(Project).where(
                        Project.organization_id == org.id,
                        Project.name == name,
                    )
                )
            ).scalar_one_or_none()
            if existing is not None:
                existing.city = city
                existing.latitude = lat
                existing.longitude = lng
                print(f"  Updated: {name} ({city})")
                continue
            project = Project(
                organization_id=org.id,
                owner_id=user.id,
                name=name,
                city=city,
                latitude=lat,
                longitude=lng,
            )
            session.add(project)
            print(f"  Created: {name} ({city}) @ {lat:.3f},{lng:.3f}")

        await session.commit()
    print("Project seed complete.")


if __name__ == "__main__":
    asyncio.run(seed_projects())
