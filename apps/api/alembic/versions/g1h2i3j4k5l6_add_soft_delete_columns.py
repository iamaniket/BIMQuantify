"""add deleted_at soft-delete columns to models + project_files

Wkb MVP backlog #37: generalize the soft-delete pattern from Project's
`lifecycle_state` to other entities via a shared SoftDeleteMixin. This
migration adds nullable `deleted_at` columns to `models` and
`project_files` — purely additive, no data backfill required because the
default is NULL ("never deleted").

A partial index speeds up the common "active rows only" query without
bloating storage for the deleted-rows view (which is rare-read).

Revision ID: g1h2i3j4k5l6
Revises: c8e2a4b6f9d3
Create Date: 2026-05-18 21:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "g1h2i3j4k5l6"
down_revision: str | None = "c8e2a4b6f9d3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "models",
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "project_files",
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
    )

    op.create_index(
        "ix_models_active",
        "models",
        ["project_id"],
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.create_index(
        "ix_project_files_active",
        "project_files",
        ["model_id"],
        postgresql_where=sa.text("deleted_at IS NULL"),
    )


def downgrade() -> None:
    op.drop_index("ix_project_files_active", table_name="project_files")
    op.drop_index("ix_models_active", table_name="models")
    op.drop_column("project_files", "deleted_at")
    op.drop_column("models", "deleted_at")
