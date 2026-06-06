"""Add active_storage_limit_gb to organizations.

Revision ID: 0002_master
Revises: 0001_master
Create Date: 2026-06-06
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0002_master"
down_revision: Union[str, None] = "0001_master"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "organizations",
        sa.Column("active_storage_limit_gb", sa.Integer(), nullable=True),
        schema="public",
    )


def downgrade() -> None:
    op.drop_column("organizations", "active_storage_limit_gb", schema="public")
