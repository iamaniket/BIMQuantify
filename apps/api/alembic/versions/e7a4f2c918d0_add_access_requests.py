"""add access_requests table

Revision ID: e7a4f2c918d0
Revises: d2c8a9f1b3e4
Create Date: 2026-05-12 14:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "e7a4f2c918d0"
down_revision: str | None = "d2c8a9f1b3e4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "access_requests",
        sa.Column(
            "id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            primary_key=True,
        ),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("work_email", sa.String(length=320), nullable=False),
        sa.Column("company", sa.String(length=255), nullable=False),
        sa.Column("role", sa.String(length=120), nullable=False),
        sa.Column("company_size", sa.String(length=20), nullable=False),
        sa.Column("country", sa.String(length=2), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column(
            "status",
            sa.Enum(
                "new",
                "approved",
                "rejected",
                name="accessrequeststatus",
                native_enum=True,
            ),
            nullable=False,
            server_default="new",
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index(
        "ix_access_requests_work_email", "access_requests", ["work_email"]
    )
    op.create_index("ix_access_requests_status", "access_requests", ["status"])
    op.create_index(
        "ix_access_requests_created_at", "access_requests", ["created_at"]
    )


def downgrade() -> None:
    op.drop_index("ix_access_requests_created_at", table_name="access_requests")
    op.drop_index("ix_access_requests_status", table_name="access_requests")
    op.drop_index("ix_access_requests_work_email", table_name="access_requests")
    op.drop_table("access_requests")
    op.execute("DROP TYPE IF EXISTS accessrequeststatus")
