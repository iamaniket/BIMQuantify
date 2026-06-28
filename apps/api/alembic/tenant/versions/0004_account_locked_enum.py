"""Add notificationeventtype value 'account_locked' (shared public enum).

Security finding H6 — account-lockout alerts are delivered as a targeted
``account_locked`` notification to org admins + platform super-admins.

The ``notificationeventtype`` enum is shared in the ``public`` schema (the
enums-shared-in-public convention), so the value is added with an UNQUALIFIED
``ALTER TYPE ... ADD VALUE IF NOT EXISTS`` — the same pattern ``0003`` used for
``finding_mentioned``. ``IF NOT EXISTS`` keeps the per-schema migrate_all
fan-out idempotent (the first run that reaches ``public`` adds it; later
per-schema runs are no-ops), and the value is only added here — never used in
the same transaction — so it is safe inside Alembic's migration transaction on
PG 12+.

On a fresh DB the live ORM model already declares the value (baseline
``create_all`` emits the enum), so this delta is only for upgrading existing
deployments.

Revision ID: 0004_account_locked_enum
Revises: 0003_finding_comments
Create Date: 2026-06-28
"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op
from sqlalchemy import text

revision: str = "0004_account_locked_enum"
down_revision: Union[str, None] = "0003_finding_comments"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.get_bind().execute(
        text("ALTER TYPE notificationeventtype ADD VALUE IF NOT EXISTS 'account_locked'")
    )


def downgrade() -> None:
    # Postgres cannot drop an enum value; leave `account_locked` in place
    # (harmless — a removed value would orphan any row still referencing it).
    pass
