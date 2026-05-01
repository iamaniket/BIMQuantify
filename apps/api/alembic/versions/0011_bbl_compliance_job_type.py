"""Add bbl_compliance_check to jobtype enum.

Revision ID: 0011_bbl_compliance
Revises: 0010_jobs_table
Create Date: 2026-05-01
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0011_bbl_compliance"
down_revision: str | None = "0010_jobs_table"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("ALTER TYPE jobtype ADD VALUE IF NOT EXISTS 'bbl_compliance_check'")


def downgrade() -> None:
    # PostgreSQL does not support removing values from an enum type.
    # The value will remain but be unused after downgrade.
    pass
