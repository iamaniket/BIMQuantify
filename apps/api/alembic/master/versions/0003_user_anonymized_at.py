"""users.anonymized_at — in-place anonymization timestamp (M-db1).

Adds the nullable ``public.users.anonymized_at`` column. It is stamped the
moment an account is anonymized in lieu of a hard delete: ``UserManager.delete``
scrubs PII, disables auth, drops org memberships, and sets this column, keeping
the row so the ~12 tenant tables that FK ``public.users`` with ON DELETE
RESTRICT (finding, project, certificate, capture_link, …) stay valid and the
audit/authorship trail survives. NULL = a live account.

On a fresh DB the live ORM model already declares ``anonymized_at`` (create_all
in the 0001 baseline emits it), so this delta only matters for upgrading existing
deployments — ``ADD COLUMN IF NOT EXISTS`` makes it a fresh-DB no-op.

Revision ID: 0003_user_anonymized_at
Revises: 0002_org_purged_at
Create Date: 2026-06-28
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op
from sqlalchemy import text

revision: str = "0003_user_anonymized_at"
down_revision: str | None = "0002_org_purged_at"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.get_bind().execute(
        text("ALTER TABLE public.users ADD COLUMN IF NOT EXISTS anonymized_at TIMESTAMPTZ")
    )


def downgrade() -> None:
    op.get_bind().execute(
        text("ALTER TABLE public.users DROP COLUMN IF EXISTS anonymized_at")
    )
