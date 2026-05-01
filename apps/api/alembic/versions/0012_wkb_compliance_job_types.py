"""Add wkb_compliance_check and compliance_check to jobtype enum.

Revision ID: 0012_wkb_compliance
Revises: 0011_bbl_compliance
Create Date: 2026-05-01
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0012_wkb_compliance"
down_revision: str | None = "0011_bbl_compliance"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("ALTER TYPE jobtype ADD VALUE IF NOT EXISTS 'wkb_compliance_check'")
    op.execute("ALTER TYPE jobtype ADD VALUE IF NOT EXISTS 'compliance_check'")


def downgrade() -> None:
    pass
