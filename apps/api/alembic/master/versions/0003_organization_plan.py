"""Organization.plan — explicit entitlement/tier on the paid tenant root.

A forward delta on the squashed `0001_master` baseline (after `0002_free_user_limits`).
Adds `organizations.plan` so TIER (entitlement) is modeled as data, decoupled from
the schema-per-tenant ISOLATION axis. Idempotent (`IF NOT EXISTS`): a no-op on a
fresh DB (the baseline `create_all` already builds the column from the model) and
the real add on a DB previously stamped at `0002_free_user_limits` (and in prod).
Every existing org backfills to 'paid'.

Revision ID: 0003_organization_plan
Revises: 0002_free_user_limits
Create Date: 2026-06-30
"""

from __future__ import annotations

from alembic import op

# Revision identifiers, used by Alembic.
revision: str = "0003_organization_plan"
down_revision: str | None = "0002_free_user_limits"
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE public.organizations "
        "ADD COLUMN IF NOT EXISTS plan varchar(32) NOT NULL DEFAULT 'paid'"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE public.organizations DROP COLUMN IF EXISTS plan")
