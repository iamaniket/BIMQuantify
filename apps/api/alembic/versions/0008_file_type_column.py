"""Add file_type column to project_files.

Revision ID: 0008_file_type_column
Revises: 0007_project_coordinates
Create Date: 2026-05-01

Discriminator column so the upload/view flow can branch between IFC (3D
fragments pipeline) and PDF (direct viewing, no extraction). Existing rows
are backfilled as 'ifc'.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0008_file_type_column"
down_revision: str | None = "0007_project_coordinates"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

FILE_TYPE_VALUES = ("ifc", "pdf")


def upgrade() -> None:
    filetype_enum = postgresql.ENUM(*FILE_TYPE_VALUES, name="filetype")
    filetype_enum.create(op.get_bind(), checkfirst=False)

    op.add_column(
        "project_files",
        sa.Column(
            "file_type",
            filetype_enum,
            nullable=False,
            server_default="ifc",
        ),
    )
    op.create_index("ix_project_files_file_type", "project_files", ["file_type"])


def downgrade() -> None:
    op.drop_index("ix_project_files_file_type", table_name="project_files")
    op.drop_column("project_files", "file_type")
    postgresql.ENUM(name="filetype").drop(op.get_bind(), checkfirst=False)
