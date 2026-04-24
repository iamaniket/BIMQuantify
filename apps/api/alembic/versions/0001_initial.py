"""initial: organizations + users

Revision ID: 0001_initial
Revises:
Create Date: 2026-04-24
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from fastapi_users_db_sqlalchemy.generics import GUID

revision: str = "0001_initial"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "organizations",
        sa.Column("id", GUID(), primary_key=True),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.UniqueConstraint("name", name="uq_organizations_name"),
    )
    op.create_index("ix_organizations_name", "organizations", ["name"])

    op.create_table(
        "users",
        sa.Column("id", GUID(), primary_key=True),
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column("hashed_password", sa.String(length=1024), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("is_superuser", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("is_verified", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("full_name", sa.String(length=255), nullable=True),
        sa.Column(
            "organization_id",
            GUID(),
            sa.ForeignKey("organizations.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index("ix_users_email", "users", ["email"], unique=True)
    op.create_index("ix_users_organization_id", "users", ["organization_id"])


def downgrade() -> None:
    op.drop_index("ix_users_organization_id", table_name="users")
    op.drop_index("ix_users_email", table_name="users")
    op.drop_table("users")
    op.drop_index("ix_organizations_name", table_name="organizations")
    op.drop_table("organizations")
