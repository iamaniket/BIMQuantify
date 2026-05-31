"""Add image_key column to organizations table.

Revision ID: 0002_org_image
Revises: 0001_master
Create Date: 2026-05-31
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0002_org_image"
down_revision: Union[str, None] = "0001_master"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "organizations",
        sa.Column("image_key", sa.String(512), nullable=True),
        schema="public",
    )


def downgrade() -> None:
    op.drop_column("organizations", "image_key", schema="public")
