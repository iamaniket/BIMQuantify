"""project_files extraction columns + extractionstatus enum

Revision ID: 0004_project_file_extraction
Revises: 0003_project_files
Create Date: 2026-04-29
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0004_project_file_extraction"
down_revision: str | None = "0003_project_files"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


EXTRACTION_STATUS_VALUES = ("not_started", "queued", "running", "succeeded", "failed")


def upgrade() -> None:
    extraction_status_enum = postgresql.ENUM(
        *EXTRACTION_STATUS_VALUES, name="extractionstatus"
    )
    extraction_status_enum.create(op.get_bind(), checkfirst=False)

    op.add_column(
        "project_files",
        sa.Column(
            "extraction_status",
            postgresql.ENUM(
                *EXTRACTION_STATUS_VALUES, name="extractionstatus", create_type=False
            ),
            nullable=False,
            server_default="not_started",
        ),
    )
    op.add_column(
        "project_files",
        sa.Column("extraction_error", sa.Text(), nullable=True),
    )
    op.add_column(
        "project_files",
        sa.Column("extraction_started_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "project_files",
        sa.Column("extraction_finished_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "project_files",
        sa.Column("extractor_version", sa.String(length=64), nullable=True),
    )
    op.add_column(
        "project_files",
        sa.Column("fragments_storage_key", sa.String(length=512), nullable=True),
    )
    op.add_column(
        "project_files",
        sa.Column("metadata_storage_key", sa.String(length=512), nullable=True),
    )
    op.add_column(
        "project_files",
        sa.Column("properties_storage_key", sa.String(length=512), nullable=True),
    )

    op.create_index(
        "ix_project_files_extraction_status",
        "project_files",
        ["extraction_status"],
    )


def downgrade() -> None:
    op.drop_index("ix_project_files_extraction_status", table_name="project_files")

    op.drop_column("project_files", "properties_storage_key")
    op.drop_column("project_files", "metadata_storage_key")
    op.drop_column("project_files", "fragments_storage_key")
    op.drop_column("project_files", "extractor_version")
    op.drop_column("project_files", "extraction_finished_at")
    op.drop_column("project_files", "extraction_started_at")
    op.drop_column("project_files", "extraction_error")
    op.drop_column("project_files", "extraction_status")

    postgresql.ENUM(*EXTRACTION_STATUS_VALUES, name="extractionstatus").drop(
        op.get_bind(), checkfirst=False
    )
