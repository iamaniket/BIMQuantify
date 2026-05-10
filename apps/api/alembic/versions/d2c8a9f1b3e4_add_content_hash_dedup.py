"""add content_sha256, ifc_project_guid, project_id for dedup

Revision ID: d2c8a9f1b3e4
Revises: b9d1f4a3e7c2
Create Date: 2026-05-10 12:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d2c8a9f1b3e4"
down_revision: str | None = "b9d1f4a3e7c2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "project_files",
        sa.Column("content_sha256", sa.String(length=64), nullable=True),
    )
    op.add_column(
        "project_files",
        sa.Column("ifc_project_guid", sa.String(length=22), nullable=True),
    )
    op.add_column(
        "project_files",
        sa.Column(
            "project_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            nullable=True,
        ),
    )

    op.execute(
        """
        UPDATE project_files
        SET project_id = m.project_id
        FROM models m
        WHERE project_files.model_id = m.id
          AND project_files.project_id IS NULL;
        """
    )

    op.alter_column("project_files", "project_id", nullable=False)

    op.create_foreign_key(
        "fk_project_files_project_id_projects",
        "project_files",
        "projects",
        ["project_id"],
        ["id"],
        ondelete="CASCADE",
    )

    op.create_index(
        "ix_project_files_project_id",
        "project_files",
        ["project_id"],
    )
    op.create_index(
        "ix_project_files_ifc_project_guid",
        "project_files",
        ["ifc_project_guid"],
    )

    # Per-project content-hash uniqueness. Excludes rejected rows so a failed
    # upload doesn't poison the slot. Excludes NULL hash so legacy rows don't
    # collide.
    op.create_index(
        "uq_project_files_project_content_sha256",
        "project_files",
        ["project_id", "content_sha256"],
        unique=True,
        postgresql_where=sa.text(
            "content_sha256 IS NOT NULL AND status IN ('pending', 'ready')"
        ),
    )


def downgrade() -> None:
    op.drop_index("uq_project_files_project_content_sha256", table_name="project_files")
    op.drop_index("ix_project_files_ifc_project_guid", table_name="project_files")
    op.drop_index("ix_project_files_project_id", table_name="project_files")
    op.drop_constraint(
        "fk_project_files_project_id_projects", "project_files", type_="foreignkey"
    )
    op.drop_column("project_files", "project_id")
    op.drop_column("project_files", "ifc_project_guid")
    op.drop_column("project_files", "content_sha256")
