"""Add seat_limit to organizations.

`seat_limit` is the max number of consumed seats (pending + active + suspended
members) a tenant may have. NULL means unlimited.

Revision ID: 0002_seat_limit
Revises: 0001_master
Create Date: 2026-05-19
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0002_seat_limit"
down_revision: Union[str, None] = "0001_master"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _column_exists(table: str, column: str, schema: str = "public") -> bool:
    bind = op.get_bind()
    result = bind.execute(
        sa.text(
            "SELECT 1 FROM information_schema.columns "
            "WHERE table_schema = :schema AND table_name = :table AND column_name = :column"
        ),
        {"schema": schema, "table": table, "column": column},
    )
    return result.scalar() is not None


def upgrade() -> None:
    if not _column_exists("organizations", "seat_limit"):
        op.add_column(
            "organizations",
            sa.Column("seat_limit", sa.Integer(), nullable=True),
            schema="public",
        )


def downgrade() -> None:
    op.drop_column("organizations", "seat_limit", schema="public")
