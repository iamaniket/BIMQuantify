"""organizations.purged_at — hard-purge timestamp for the two-phase org lifecycle.

Adds the nullable ``public.organizations.purged_at`` column. It is set the moment
an org is HARD-purged (storage wiped + tenant schema dropped) and stays NULL while
the org is only soft-deleted-but-retained. Together with ``deleted_at`` it encodes
the lifecycle: active -> soft-deleted (deleted_at set, purged_at NULL, recoverable)
-> purged (both set, data gone). See admin/provisioning.py::purge_organization.

On a fresh DB the live ORM model already declares ``purged_at`` (create_all in the
0001 baseline emits it), so this delta is only for upgrading existing deployments —
``ADD COLUMN IF NOT EXISTS`` makes it a fresh-DB no-op.

Revision ID: 0002_org_purged_at
Revises: 0001_master
Create Date: 2026-06-27
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op
from sqlalchemy import text

revision: str = "0002_org_purged_at"
down_revision: str | None = "0001_master"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.get_bind().execute(
        text(
            "ALTER TABLE public.organizations "
            "ADD COLUMN IF NOT EXISTS purged_at TIMESTAMPTZ"
        )
    )


def downgrade() -> None:
    op.get_bind().execute(
        text("ALTER TABLE public.organizations DROP COLUMN IF EXISTS purged_at")
    )
