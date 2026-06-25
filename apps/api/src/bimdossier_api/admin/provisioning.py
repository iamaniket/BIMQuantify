"""Organization provisioning saga.

Triggered by `POST /admin/organizations`. Each step has a compensating
action so a failure at step N rolls back steps 1..N-1.

The saga is the ONLY place that should INSERT into `organizations` —
direct insertion bypasses the schema/grant/membership setup and leaves
the system in an inconsistent state.
"""

from __future__ import annotations

import logging
import os
import pathlib
import secrets
import threading
from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import UUID, uuid4

from alembic import command
from alembic.config import Config
from fastapi import Request
from fastapi_users.password import PasswordHelper
from sqlalchemy import delete, func, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from bimdossier_api import audit
from bimdossier_api._rls_sql import drop_tenant_schema, grant_schema_to_app_role
from bimdossier_api.db import get_admin_engine, get_session_maker
from bimdossier_api.models.organization import Organization, OrganizationStatus
from bimdossier_api.models.organization_member import (
    OrganizationMember,
    OrganizationMemberStatus,
)
from bimdossier_api.models.user import User
from bimdossier_api.tenancy import schema_name_for

logger = logging.getLogger(__name__)

_API_DIR = pathlib.Path(__file__).resolve().parents[3]
_TENANT_INI = str(_API_DIR / "alembic.tenant.ini")

# Alembic's command API drives migrations through module-level `op`/`context`
# proxies, and the tenant chain resolves its target schema from a process-global
# env var. Neither is safe to run concurrently in one process, so serialize
# tenant upgrades: two simultaneous provisionings (each running the chain in a
# worker thread via run_in_executor) would otherwise clobber each other's run.
# Batch upgrades across many schemas use separate processes instead — see
# scripts/migrate_all.py.
_MIGRATION_LOCK = threading.Lock()


@dataclass
class ProvisionResult:
    organization: Organization
    admin: User
    created_admin: bool      # True if a new user row was created for the admin
    activation_required: bool  # True if the admin needs to set a password


class ProvisioningError(RuntimeError):
    """Saga failed and compensations have run. The DB is back to its
    pre-saga state — caller can safely surface a 500 to the user."""


async def _find_or_create_user(
    session: AsyncSession,
    *,
    email: str,
    full_name: str | None,
) -> tuple[User, bool]:
    """Look up by case-insensitive email. Returns `(user, created)`.
    Newly-created users have a random unguessable password and
    `is_verified=False` so the activation email flow can set a real
    password on first use.
    """
    normalized = email.strip().lower()
    stmt = select(User).where(func.lower(User.email) == normalized)
    result = await session.execute(stmt)
    user = result.scalar_one_or_none()
    if user is not None:
        return user, False

    helper = PasswordHelper()
    # 32 bytes of entropy → 64-char hex. The user will never log in with
    # this; the activation flow resets it.
    random_password = secrets.token_hex(32)
    user = User(
        email=email,
        hashed_password=helper.hash(random_password),
        full_name=full_name,
        is_active=True,
        is_verified=False,
        is_superuser=False,
    )
    session.add(user)
    await session.flush()
    return user, True


async def provision_organization(
    *,
    name: str,
    admin_email: str,
    admin_full_name: str | None,
    seat_limit: int | None = None,
    active_storage_limit_gb: int | None = None,
    requester: User,
    request: Request | None = None,
) -> ProvisionResult:
    """The saga.

    Steps:
      1. INSERT `organizations` row, status='provisioning'.
      2. CREATE SCHEMA "org_<hex>" (via admin engine, AUTOCOMMIT).
      3. Run tenant Alembic chain against the new schema.
      4. GRANT bim_app on the new schema + default privileges.
      5. find_or_create admin user, INSERT organization_members(pending,
         is_org_admin=true), flip org status='active', set provisioned_at.
      6. audit.record('organization.created').

    Compensations (reverse order):
      - On step 5+ failure → DROP SCHEMA cascades plus DELETE org row.
      - On step 4/3/2 failure → DROP SCHEMA + DELETE org row.
      - On step 1 failure → nothing to undo.
    """
    org_id = uuid4()
    schema = schema_name_for(org_id)
    completed: set[str] = set()

    session_maker = get_session_maker()
    admin_engine = get_admin_engine()

    try:
        # ── Step 1 ──────────────────────────────────────────────────────
        async with session_maker() as s, s.begin():
            org = Organization(
                id=org_id,
                name=name.strip(),
                schema_name=schema,
                status=OrganizationStatus.provisioning,
                seat_limit=seat_limit,
                active_storage_limit_gb=active_storage_limit_gb,
            )
            s.add(org)
        completed.add("master_row")
        logger.info("provision[%s] master row inserted", schema)

        # ── Step 2 ──────────────────────────────────────────────────────
        async with admin_engine.begin() as conn:
            await conn.execute(text(f'CREATE SCHEMA "{schema}"'))
        completed.add("schema")
        logger.info("provision[%s] schema created", schema)

        # ── Step 3 ──────────────────────────────────────────────────────
        # Alembic is synchronous; run in default executor so we don't
        # block the event loop.
        import asyncio

        loop = asyncio.get_running_loop()
        await loop.run_in_executor(None, lambda: _run_sync_tenant_migrations(schema))
        completed.add("migrations")
        logger.info("provision[%s] tenant migrations applied", schema)

        # ── Step 4 ──────────────────────────────────────────────────────
        async with admin_engine.begin() as conn:
            for stmt in grant_schema_to_app_role(schema):
                await conn.execute(text(stmt))
        completed.add("grants")
        logger.info("provision[%s] grants applied", schema)

        # ── Step 5 ──────────────────────────────────────────────────────
        async with session_maker() as s, s.begin():
            admin_user, created_admin = await _find_or_create_user(
                s, email=admin_email, full_name=admin_full_name
            )
            # If the admin already had a verified account elsewhere they
            # don't need to activate again — they just log in. The bool
            # below drives the email template choice in the router.
            activation_required = not admin_user.is_verified

            s.add(
                OrganizationMember(
                    user_id=admin_user.id,
                    organization_id=org_id,
                    is_org_admin=True,
                    status=OrganizationMemberStatus.pending,
                    invited_by=requester.id,
                )
            )

            await s.execute(
                update(Organization)
                .where(Organization.id == org_id)
                .values(
                    status=OrganizationStatus.active,
                    provisioned_at=datetime.now(UTC),
                )
            )

            await audit.record_for_org(
                s,
                org_id,
                action="organization.created",
                resource_type="organization",
                resource_id=org_id,
                after={
                    "id": str(org_id),
                    "name": name,
                    "schema_name": schema,
                    "admin_email": admin_email,
                    "seat_limit": seat_limit,
                    "active_storage_limit_gb": active_storage_limit_gb,
                },
                actor_user_id=requester.id,
                request=request,
            )

            # Refetch the org so the caller gets fresh state.
            refreshed = await s.execute(
                select(Organization).where(Organization.id == org_id)
            )
            org = refreshed.scalar_one()
        completed.add("admin_member")
        logger.info("provision[%s] admin member inserted", schema)

        return ProvisionResult(
            organization=org,
            admin=admin_user,
            created_admin=created_admin,
            activation_required=activation_required,
        )

    except Exception as exc:
        logger.exception("provision[%s] failed, compensating: %s", schema, exc)
        await _compensate(schema, org_id, completed)
        raise ProvisioningError(f"provisioning failed: {exc}") from exc


def _run_sync_tenant_migrations(schema: str) -> None:
    """Sync wrapper for the alembic command. Runs in a thread executor
    because Alembic uses sync SQLAlchemy under the hood.

    Holds `_MIGRATION_LOCK` for the whole upgrade: the env var and Alembic's
    op/context proxies are process-global, so two threads running this at once
    (e.g. two concurrent org provisionings) would clobber each other.
    """
    cfg = Config(_TENANT_INI)
    with _MIGRATION_LOCK:
        os.environ["BIMDOSSIER_TENANT_SCHEMA"] = schema
        try:
            command.upgrade(cfg, "head")
        finally:
            os.environ.pop("BIMDOSSIER_TENANT_SCHEMA", None)


async def _compensate(schema: str, org_id: UUID, completed: set[str]) -> None:
    """Reverse the saga's effects. Tries best-effort even if a step's
    compensation raises — we want to clean up as much as possible.
    """
    admin_engine = get_admin_engine()
    session_maker = get_session_maker()

    if {"schema", "migrations", "grants"} & completed:
        try:
            async with admin_engine.begin() as conn:
                for stmt in drop_tenant_schema(schema):
                    await conn.execute(text(stmt))
        except Exception:
            logger.exception("compensate[%s] DROP SCHEMA failed", schema)

    if "master_row" in completed:
        try:
            async with session_maker() as s, s.begin():
                await s.execute(
                    delete(Organization).where(Organization.id == org_id)
                )
        except Exception:
            logger.exception("compensate[%s] DELETE org row failed", schema)


async def delete_organization(
    *,
    organization_id: UUID,
    requester: User,
    request: Request | None = None,
) -> None:
    """Soft-delete an org and drop its tenant schema.

    Inverts the provisioning saga: mark `deleted_at`, then DROP SCHEMA.
    The organization row remains for audit-trail purposes (`deleted_at`
    distinguishes it from live orgs). Membership rows cascade delete via
    the FK; the audit_log keeps its rows because the FK is ON DELETE
    SET NULL.
    """
    session_maker = get_session_maker()
    admin_engine = get_admin_engine()

    async with session_maker() as s, s.begin():
        org = await s.get(Organization, organization_id)
        if org is None or org.deleted_at is not None:
            return  # idempotent — already gone

        schema = org.schema_name
        before = {
            "id": str(org.id),
            "name": org.name,
            "schema_name": schema,
            "status": org.status.value,
        }
        await s.execute(
            update(Organization)
            .where(Organization.id == organization_id)
            .values(
                deleted_at=datetime.now(UTC),
                status=OrganizationStatus.deleted,
            )
        )
        # Platform schema: the org's own schema is dropped immediately below,
        # so the deletion record can't live there.
        await audit.record_for_org(
            s,
            None,
            action="organization.deleted",
            resource_type="organization",
            resource_id=organization_id,
            before=before,
            actor_user_id=requester.id,
            request=request,
        )

    # Drop the schema OUTSIDE the master txn so a failed drop doesn't
    # leave the master row marked active again.
    try:
        async with admin_engine.begin() as conn:
            for stmt in drop_tenant_schema(schema):
                await conn.execute(text(stmt))
    except Exception:
        logger.exception("drop_schema[%s] failed during org deletion", schema)
        # Don't re-raise — the master row is already marked deleted, and
        # leaving an orphan schema is recoverable manually.
