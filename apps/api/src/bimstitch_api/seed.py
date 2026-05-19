"""Seed dev data for local development.

Creates:
  * Platform org "BIMstitch Platform" + super admin user.
  * Two demo orgs (Acme Construction, Beta Builders) with the full
    provisioning saga so the dev DB exercises the saga code path on every
    `--reset`.
  * One cross-org user (`cross@dev.local`) belonging to BOTH demo orgs to
    demonstrate the org switcher.

Usage:
    uv run python -m bimstitch_api.seed             # idempotent — skips existing
    uv run python -m bimstitch_api.seed --reset     # TRUNCATE master, DROP tenant schemas, re-seed
"""

from __future__ import annotations

import asyncio
import logging
import sys
from datetime import datetime, timezone
from uuid import UUID, uuid4

from fastapi_users.password import PasswordHelper
from sqlalchemy import select, text

from bimstitch_api._rls_sql import grant_schema_to_app_role
from bimstitch_api.admin.provisioning import _run_sync_tenant_migrations
from bimstitch_api.db import get_admin_engine, get_engine, get_session_maker
from bimstitch_api.models.organization import Organization, OrganizationStatus
from bimstitch_api.models.organization_member import (
    OrganizationMember,
    OrganizationMemberStatus,
)
from bimstitch_api.models.user import User
from bimstitch_api.tenancy import schema_name_for

logger = logging.getLogger(__name__)


PLATFORM_ORG_NAME = "BIMstitch Platform"
DEMO_ORG_A_NAME = "Acme Construction"
DEMO_ORG_B_NAME = "Beta Builders"


SUPER_ADMIN = {
    "email": "super@bimstitch.dev",
    "password": "SuperAdmin123!",
    "full_name": "Super Admin",
    "is_superuser": True,
}

ACME_USERS = [
    {"email": "admin@acme.dev", "password": "Admin123!", "full_name": "Acme Admin", "is_org_admin": True},
    {"email": "editor@acme.dev", "password": "Editor123!", "full_name": "Acme Editor", "is_org_admin": False},
    {"email": "viewer@acme.dev", "password": "Viewer123!", "full_name": "Acme Viewer", "is_org_admin": False},
]

BETA_USERS = [
    {"email": "admin@beta.dev", "password": "Admin123!", "full_name": "Beta Admin", "is_org_admin": True},
]

CROSS_USER = {
    "email": "cross@dev.local",
    "password": "Cross123!",
    "full_name": "Cross-Org Demo",
}


async def _find_or_create_user(session, *, email, password, full_name, is_superuser=False):
    existing = (
        await session.execute(select(User).where(User.email == email))
    ).scalar_one_or_none()
    if existing is not None:
        return existing, False
    helper = PasswordHelper()
    user = User(
        email=email,
        hashed_password=helper.hash(password),
        full_name=full_name,
        is_superuser=is_superuser,
        is_verified=True,
        is_active=True,
    )
    session.add(user)
    await session.flush()
    return user, True


async def _provision_org(name: str) -> tuple[Organization, str]:
    """Create the master row + schema + grants for a demo org. Returns the
    persisted Organization row and the schema name.
    """
    session_maker = get_session_maker()
    admin_engine = get_admin_engine()

    async with session_maker() as s:
        async with s.begin():
            existing = (
                await s.execute(select(Organization).where(Organization.name == name))
            ).scalar_one_or_none()
            if existing is not None:
                return existing, existing.schema_name

            org_id = uuid4()
            schema = schema_name_for(org_id)
            org = Organization(
                id=org_id,
                name=name,
                schema_name=schema,
                status=OrganizationStatus.active,
                provisioned_at=datetime.now(timezone.utc),
            )
            s.add(org)

    async with admin_engine.begin() as conn:
        await conn.execute(text(f'CREATE SCHEMA IF NOT EXISTS "{schema}"'))

    # Run tenant migrations against the new schema (sync, in thread).
    loop = asyncio.get_running_loop()
    await loop.run_in_executor(None, lambda: _run_sync_tenant_migrations(schema))

    async with admin_engine.begin() as conn:
        for stmt in grant_schema_to_app_role(schema):
            await conn.execute(text(stmt))

    return org, schema


async def _attach_member(
    session,
    *,
    user: User,
    organization_id: UUID,
    is_org_admin: bool,
) -> None:
    existing = (
        await session.execute(
            select(OrganizationMember).where(
                OrganizationMember.user_id == user.id,
                OrganizationMember.organization_id == organization_id,
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        existing.is_org_admin = is_org_admin
        existing.status = OrganizationMemberStatus.active
        if existing.accepted_at is None:
            existing.accepted_at = datetime.now(timezone.utc)
        return
    session.add(
        OrganizationMember(
            user_id=user.id,
            organization_id=organization_id,
            is_org_admin=is_org_admin,
            status=OrganizationMemberStatus.active,
            accepted_at=datetime.now(timezone.utc),
        )
    )


async def reset_all() -> None:
    """Drop every tenant schema and TRUNCATE master tables. Destructive — guarded
    by the `--reset` flag and only meant for dev."""
    print("Resetting: dropping tenant schemas + TRUNCATE master tables…")
    admin_engine = get_admin_engine()
    session_maker = get_session_maker()

    async with session_maker() as s:
        schemas = (
            await s.execute(select(Organization.schema_name))
        ).scalars().all()

    async with admin_engine.begin() as conn:
        for schema in schemas:
            await conn.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))

    async with session_maker() as s:
        async with s.begin():
            await s.execute(
                text(
                    "TRUNCATE TABLE audit_log, organization_members, users, "
                    "organizations RESTART IDENTITY CASCADE"
                )
            )
    print("  reset complete.")


async def seed() -> None:
    get_engine()
    session_maker = get_session_maker()

    # 1. Platform org + super admin (no saga — keep platform org outside
    # tenant-data plane; it doesn't need a tenant schema since super admin
    # endpoints work on master only).
    async with session_maker() as s:
        async with s.begin():
            platform = (
                await s.execute(
                    select(Organization).where(Organization.name == PLATFORM_ORG_NAME)
                )
            ).scalar_one_or_none()
            if platform is None:
                platform_id = uuid4()
                platform = Organization(
                    id=platform_id,
                    name=PLATFORM_ORG_NAME,
                    schema_name=schema_name_for(platform_id),
                    status=OrganizationStatus.active,
                    provisioned_at=datetime.now(timezone.utc),
                )
                s.add(platform)
                # We DO create the schema so super admin can still query
                # tenant tables under it if they switch into it.
                await s.flush()

    # Platform schema (idempotent)
    admin_engine = get_admin_engine()
    async with admin_engine.begin() as conn:
        await conn.execute(text(f'CREATE SCHEMA IF NOT EXISTS "{platform.schema_name}"'))
    loop = asyncio.get_running_loop()
    await loop.run_in_executor(None, lambda: _run_sync_tenant_migrations(platform.schema_name))
    async with admin_engine.begin() as conn:
        for stmt in grant_schema_to_app_role(platform.schema_name):
            await conn.execute(text(stmt))

    async with session_maker() as s:
        async with s.begin():
            super_user, created = await _find_or_create_user(
                s,
                email=SUPER_ADMIN["email"],
                password=SUPER_ADMIN["password"],
                full_name=SUPER_ADMIN["full_name"],
                is_superuser=True,
            )
            await _attach_member(
                s, user=super_user, organization_id=platform.id, is_org_admin=True
            )
            super_user.active_organization_id = platform.id
            print(("  Created" if created else "  Existing") + f": {super_user.email}")

    # 2. Demo orgs (full provisioning)
    acme, _ = await _provision_org(DEMO_ORG_A_NAME)
    beta, _ = await _provision_org(DEMO_ORG_B_NAME)

    # 3. Org users + memberships
    async with session_maker() as s:
        async with s.begin():
            for u in ACME_USERS:
                user, created = await _find_or_create_user(
                    s, email=u["email"], password=u["password"], full_name=u["full_name"]
                )
                await _attach_member(
                    s, user=user, organization_id=acme.id, is_org_admin=u["is_org_admin"]
                )
                if user.active_organization_id is None:
                    user.active_organization_id = acme.id
                print(("  Created" if created else "  Existing") + f": {user.email}")

            for u in BETA_USERS:
                user, created = await _find_or_create_user(
                    s, email=u["email"], password=u["password"], full_name=u["full_name"]
                )
                await _attach_member(
                    s, user=user, organization_id=beta.id, is_org_admin=u["is_org_admin"]
                )
                if user.active_organization_id is None:
                    user.active_organization_id = beta.id
                print(("  Created" if created else "  Existing") + f": {user.email}")

            cross, created = await _find_or_create_user(
                s,
                email=CROSS_USER["email"],
                password=CROSS_USER["password"],
                full_name=CROSS_USER["full_name"],
            )
            await _attach_member(s, user=cross, organization_id=acme.id, is_org_admin=False)
            await _attach_member(s, user=cross, organization_id=beta.id, is_org_admin=False)
            if cross.active_organization_id is None:
                cross.active_organization_id = acme.id
            print(
                ("  Created" if created else "  Existing")
                + f": {cross.email} (member of both Acme and Beta)"
            )

    print("Seed complete.")


async def main() -> None:
    reset = "--reset" in sys.argv[1:]
    if reset:
        await reset_all()
    await seed()


if __name__ == "__main__":
    asyncio.run(main())
