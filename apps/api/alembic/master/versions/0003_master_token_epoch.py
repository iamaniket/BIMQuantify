"""Add tokens_valid_after to users (per-user token epoch / sign-out-everywhere).

Revision ID: 0003_master
Revises: 0002_master
Create Date: 2026-06-10
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0003_master"
down_revision: Union[str, None] = "0002_master"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 0001_master uses create_all() from live models, so if the User model
    # already declares this column the table is born with it (e.g. fresh test
    # DBs). Guard against that to keep the migration idempotent.
    conn = op.get_bind()
    result = conn.execute(
        sa.text(
            "SELECT 1 FROM information_schema.columns "
            "WHERE table_schema = 'public' "
            "AND table_name = 'users' "
            "AND column_name = 'tokens_valid_after'"
        )
    )
    if result.scalar() is None:
        op.add_column(
            "users",
            sa.Column("tokens_valid_after", sa.DateTime(timezone=True), nullable=True),
            schema="public",
        )


def downgrade() -> None:
    op.drop_column("users", "tokens_valid_after", schema="public")
