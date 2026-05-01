"""Add project lifecycle state for archive/remove semantics.

Revision ID: 0009_project_lifecycle
Revises: 0008_file_type_column
Create Date: 2026-05-01
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0009_project_lifecycle"
down_revision: str | None = "0008_file_type_column"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


PROJECT_LIFECYCLE_VALUES = ("active", "archived", "removed")


def upgrade() -> None:
    lifecycle_enum = postgresql.ENUM(
        *PROJECT_LIFECYCLE_VALUES,
        name="projectlifecyclestate",
    )
    lifecycle_enum.create(op.get_bind(), checkfirst=False)

    op.add_column(
        "projects",
        sa.Column(
            "lifecycle_state",
            postgresql.ENUM(
                *PROJECT_LIFECYCLE_VALUES,
                name="projectlifecyclestate",
                create_type=False,
            ),
            nullable=False,
            server_default="active",
        ),
    )
    op.create_index("ix_projects_lifecycle_state", "projects", ["lifecycle_state"])


def downgrade() -> None:
    op.drop_index("ix_projects_lifecycle_state", table_name="projects")
    op.drop_column("projects", "lifecycle_state")
    postgresql.ENUM(*PROJECT_LIFECYCLE_VALUES, name="projectlifecyclestate").drop(
        op.get_bind(), checkfirst=False
    )