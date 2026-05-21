"""Seed dev data for local development.

Creates:
  * Platform org "BIMstitch Platform" + super admin user.
  * Two demo orgs (Acme Construction, Beta Builders) with the full
    provisioning saga so the dev DB exercises the saga code path on every
    `--reset`.
  * One cross-org user belonging to BOTH demo orgs to demonstrate the org
    switcher.

All credentials are sourced from the SEED_* env vars (see `.env.example`).
The script fails fast with a clear error if any are missing — no values are
ever hardcoded in source.

Usage:
    uv run python -m bimstitch_api.seed             # idempotent — skips existing
    uv run python -m bimstitch_api.seed --reset     # TRUNCATE master, DROP tenant schemas, re-seed
"""

from __future__ import annotations

import asyncio
import logging
import sys
from datetime import UTC, datetime
from uuid import UUID, uuid4

from fastapi_users.password import PasswordHelper
from pydantic import EmailStr, Field
from pydantic_settings import BaseSettings, SettingsConfigDict
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


class SeedSettings(BaseSettings):
    """Credentials for the seed script. All fields are required — a missing
    env var aborts the seed with a clear `pydantic_core.ValidationError`
    rather than silently inserting a stale default."""

    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )

    superadmin_email: EmailStr = Field(alias="SEED_SUPERADMIN_EMAIL")
    superadmin_password: str = Field(alias="SEED_SUPERADMIN_PASSWORD")

    acme_admin_email: EmailStr = Field(alias="SEED_ACME_ADMIN_EMAIL")
    acme_admin_password: str = Field(alias="SEED_ACME_ADMIN_PASSWORD")
    acme_editor_email: EmailStr = Field(alias="SEED_ACME_EDITOR_EMAIL")
    acme_editor_password: str = Field(alias="SEED_ACME_EDITOR_PASSWORD")
    acme_viewer_email: EmailStr = Field(alias="SEED_ACME_VIEWER_EMAIL")
    acme_viewer_password: str = Field(alias="SEED_ACME_VIEWER_PASSWORD")

    beta_admin_email: EmailStr = Field(alias="SEED_BETA_ADMIN_EMAIL")
    beta_admin_password: str = Field(alias="SEED_BETA_ADMIN_PASSWORD")

    cross_email: EmailStr = Field(alias="SEED_CROSS_EMAIL")
    cross_password: str = Field(alias="SEED_CROSS_PASSWORD")


def _build_user_plan(cfg: SeedSettings) -> tuple[dict, list[dict], list[dict], dict]:
    """Map env-sourced credentials onto the structural role/membership graph.
    Display names are derived from the role — those are structure, not
    credentials, so they stay in code."""
    super_admin = {
        "email": cfg.superadmin_email,
        "password": cfg.superadmin_password,
        "full_name": "Super Admin",
        "is_superuser": True,
    }
    acme_users = [
        {"email": cfg.acme_admin_email, "password": cfg.acme_admin_password,
         "full_name": "Acme Admin", "is_org_admin": True},
        {"email": cfg.acme_editor_email, "password": cfg.acme_editor_password,
         "full_name": "Acme Editor", "is_org_admin": False},
        {"email": cfg.acme_viewer_email, "password": cfg.acme_viewer_password,
         "full_name": "Acme Viewer", "is_org_admin": False},
    ]
    beta_users = [
        {"email": cfg.beta_admin_email, "password": cfg.beta_admin_password,
         "full_name": "Beta Admin", "is_org_admin": True},
    ]
    cross_user = {
        "email": cfg.cross_email,
        "password": cfg.cross_password,
        "full_name": "Cross-Org Demo",
    }
    return super_admin, acme_users, beta_users, cross_user


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

    async with session_maker() as s, s.begin():
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
            provisioned_at=datetime.now(UTC),
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
            existing.accepted_at = datetime.now(UTC)
        return
    session.add(
        OrganizationMember(
            user_id=user.id,
            organization_id=organization_id,
            is_org_admin=is_org_admin,
            status=OrganizationMemberStatus.active,
            accepted_at=datetime.now(UTC),
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

    async with session_maker() as s, s.begin():
        await s.execute(
            text(
                "TRUNCATE TABLE audit_log, organization_members, users, "
                "organizations RESTART IDENTITY CASCADE"
            )
        )
    print("  reset complete.")


async def seed() -> None:
    cfg = SeedSettings()
    super_admin, acme_users, beta_users, cross_user = _build_user_plan(cfg)

    get_engine()
    session_maker = get_session_maker()

    # 1. Platform org + super admin (no saga — keep platform org outside
    # tenant-data plane; it doesn't need a tenant schema since super admin
    # endpoints work on master only).
    async with session_maker() as s, s.begin():
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
                provisioned_at=datetime.now(UTC),
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

    async with session_maker() as s, s.begin():
        super_user, created = await _find_or_create_user(
            s,
            email=super_admin["email"],
            password=super_admin["password"],
            full_name=super_admin["full_name"],
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
    async with session_maker() as s, s.begin():
        for u in acme_users:
            user, created = await _find_or_create_user(
                s, email=u["email"], password=u["password"], full_name=u["full_name"]
            )
            await _attach_member(
                s, user=user, organization_id=acme.id, is_org_admin=u["is_org_admin"]
            )
            if user.active_organization_id is None:
                user.active_organization_id = acme.id
            print(("  Created" if created else "  Existing") + f": {user.email}")

        for u in beta_users:
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
            email=cross_user["email"],
            password=cross_user["password"],
            full_name=cross_user["full_name"],
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
