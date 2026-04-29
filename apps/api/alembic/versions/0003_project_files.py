"""project_files table + RLS policy + grants

Revision ID: 0003_project_files
Revises: 0002_projects_and_rls
Create Date: 2026-04-28
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from fastapi_users_db_sqlalchemy.generics import GUID
from sqlalchemy.dialects import postgresql

from bimstitch_api._rls_sql import APP_ROLE, PROJECT_ID_IN_ORG_SUBQUERY

revision: str = "0003_project_files"
down_revision: str | None = "0002_projects_and_rls"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


IFC_SCHEMA_VALUES = ("IFC2X3", "IFC4", "IFC4X1", "IFC4X3", "unknown")
PROJECT_FILE_STATUS_VALUES = ("pending", "ready", "rejected")


def upgrade() -> None:
    ifc_schema_enum = postgresql.ENUM(*IFC_SCHEMA_VALUES, name="ifcschema")
    ifc_schema_enum.create(op.get_bind(), checkfirst=False)

    status_enum = postgresql.ENUM(*PROJECT_FILE_STATUS_VALUES, name="projectfilestatus")
    status_enum.create(op.get_bind(), checkfirst=False)

    op.create_table(
        "project_files",
        sa.Column("id", GUID(), primary_key=True),
        sa.Column(
            "project_id",
            GUID(),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "uploaded_by_user_id",
            GUID(),
            sa.ForeignKey("users.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("storage_key", sa.String(length=512), nullable=False, unique=True),
        sa.Column("original_filename", sa.String(length=512), nullable=False),
        sa.Column("size_bytes", sa.BigInteger(), nullable=False),
        sa.Column("content_type", sa.String(length=255), nullable=False),
        sa.Column(
            "ifc_schema",
            postgresql.ENUM(*IFC_SCHEMA_VALUES, name="ifcschema", create_type=False),
            nullable=True,
        ),
        sa.Column(
            "status",
            postgresql.ENUM(
                *PROJECT_FILE_STATUS_VALUES, name="projectfilestatus", create_type=False
            ),
            nullable=False,
            server_default="pending",
        ),
        sa.Column("rejection_reason", sa.Text(), nullable=True),
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
        sa.CheckConstraint("size_bytes >= 0", name="ck_project_files_size_nonneg"),
    )
    op.create_index("ix_project_files_project_id", "project_files", ["project_id"])
    op.create_index(
        "ix_project_files_status_created_at",
        "project_files",
        ["status", "created_at"],
    )

    op.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON project_files TO {APP_ROLE};")
    op.execute("ALTER TABLE project_files ENABLE ROW LEVEL SECURITY;")
    op.execute("ALTER TABLE project_files FORCE ROW LEVEL SECURITY;")
    op.execute("DROP POLICY IF EXISTS project_files_tenant_isolation ON project_files;")
    op.execute(
        f"""
        CREATE POLICY project_files_tenant_isolation ON project_files
        USING ({PROJECT_ID_IN_ORG_SUBQUERY})
        WITH CHECK ({PROJECT_ID_IN_ORG_SUBQUERY});
        """
    )


def downgrade() -> None:
    op.execute("DROP POLICY IF EXISTS project_files_tenant_isolation ON project_files;")
    op.execute("ALTER TABLE project_files NO FORCE ROW LEVEL SECURITY;")
    op.execute("ALTER TABLE project_files DISABLE ROW LEVEL SECURITY;")

    op.drop_index("ix_project_files_status_created_at", table_name="project_files")
    op.drop_index("ix_project_files_project_id", table_name="project_files")
    op.drop_table("project_files")

    postgresql.ENUM(*PROJECT_FILE_STATUS_VALUES, name="projectfilestatus").drop(
        op.get_bind(), checkfirst=False
    )
    postgresql.ENUM(*IFC_SCHEMA_VALUES, name="ifcschema").drop(op.get_bind(), checkfirst=False)
