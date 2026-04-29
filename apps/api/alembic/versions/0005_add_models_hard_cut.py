"""Add models entity between Project and ProjectFile (hard cut on project_files)

Revision ID: 0005_add_models_hard_cut
Revises: 0004_project_file_extraction
Create Date: 2026-04-29

This is a HARD CUT migration on `project_files`: existing rows are dropped and
the table is recreated with `model_id` (NOT NULL FK to models) and
`version_number` (NOT NULL, UNIQUE per model_id). The hard cut is acceptable
because there is no production data yet.

The downgrade does NOT recreate the legacy `project_files` shape — there is no
preserved data to migrate back. If a true round-trip is ever needed, copy the
CREATE TABLE / RLS blocks from migrations 0003 and 0004 into the downgrade.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from fastapi_users_db_sqlalchemy.generics import GUID
from sqlalchemy.dialects import postgresql

from bimstitch_api._rls_sql import (
    APP_ROLE,
    MODEL_ID_IN_ORG_SUBQUERY,
    PROJECT_ID_IN_ORG_SUBQUERY,
)

revision: str = "0005_add_models_hard_cut"
down_revision: str | None = "0004_project_file_extraction"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


MODEL_DISCIPLINE_VALUES = (
    "architectural",
    "structural",
    "mep",
    "coordination",
    "other",
)
MODEL_STATUS_VALUES = ("draft", "active", "archived")
IFC_SCHEMA_VALUES = ("IFC2X3", "IFC4", "IFC4X1", "IFC4X3", "unknown")
PROJECT_FILE_STATUS_VALUES = ("pending", "ready", "rejected")
EXTRACTION_STATUS_VALUES = ("not_started", "queued", "running", "succeeded", "failed")


def upgrade() -> None:
    # ------------------------------------------------------------------
    # 1. Tear down existing project_files entirely (hard cut).
    # ------------------------------------------------------------------
    op.execute("DROP POLICY IF EXISTS project_files_tenant_isolation ON project_files;")
    op.execute("ALTER TABLE project_files NO FORCE ROW LEVEL SECURITY;")
    op.execute("ALTER TABLE project_files DISABLE ROW LEVEL SECURITY;")

    op.drop_index("ix_project_files_extraction_status", table_name="project_files")
    op.drop_index("ix_project_files_status_created_at", table_name="project_files")
    op.drop_index("ix_project_files_project_id", table_name="project_files")
    op.drop_table("project_files")

    # The ifcschema, projectfilestatus, extractionstatus enums are reusable
    # by the new project_files shape, so we leave them intact.

    # ------------------------------------------------------------------
    # 2. Create model enums.
    # ------------------------------------------------------------------
    discipline_enum = postgresql.ENUM(*MODEL_DISCIPLINE_VALUES, name="modeldiscipline")
    discipline_enum.create(op.get_bind(), checkfirst=False)

    status_enum = postgresql.ENUM(*MODEL_STATUS_VALUES, name="modelstatus")
    status_enum.create(op.get_bind(), checkfirst=False)

    # ------------------------------------------------------------------
    # 3. Create models table.
    # ------------------------------------------------------------------
    op.create_table(
        "models",
        sa.Column("id", GUID(), primary_key=True),
        sa.Column(
            "project_id",
            GUID(),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column(
            "discipline",
            postgresql.ENUM(*MODEL_DISCIPLINE_VALUES, name="modeldiscipline", create_type=False),
            nullable=False,
        ),
        sa.Column(
            "status",
            postgresql.ENUM(*MODEL_STATUS_VALUES, name="modelstatus", create_type=False),
            nullable=False,
            server_default="active",
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
        sa.UniqueConstraint("project_id", "name", name="uq_models_project_name"),
    )
    op.create_index("ix_models_project_id", "models", ["project_id"])
    op.create_index("ix_models_status", "models", ["status"])

    op.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON models TO {APP_ROLE};")
    op.execute("ALTER TABLE models ENABLE ROW LEVEL SECURITY;")
    op.execute("ALTER TABLE models FORCE ROW LEVEL SECURITY;")
    op.execute("DROP POLICY IF EXISTS models_tenant_isolation ON models;")
    op.execute(
        f"""
        CREATE POLICY models_tenant_isolation ON models
        USING ({PROJECT_ID_IN_ORG_SUBQUERY})
        WITH CHECK ({PROJECT_ID_IN_ORG_SUBQUERY});
        """
    )

    # ------------------------------------------------------------------
    # 4. Recreate project_files with model_id + version_number.
    # ------------------------------------------------------------------
    op.create_table(
        "project_files",
        sa.Column("id", GUID(), primary_key=True),
        sa.Column(
            "model_id",
            GUID(),
            sa.ForeignKey("models.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("version_number", sa.Integer(), nullable=False),
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
                *PROJECT_FILE_STATUS_VALUES,
                name="projectfilestatus",
                create_type=False,
            ),
            nullable=False,
            server_default="pending",
        ),
        sa.Column("rejection_reason", sa.Text(), nullable=True),
        sa.Column(
            "extraction_status",
            postgresql.ENUM(*EXTRACTION_STATUS_VALUES, name="extractionstatus", create_type=False),
            nullable=False,
            server_default="not_started",
        ),
        sa.Column("extraction_error", sa.Text(), nullable=True),
        sa.Column("extraction_started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("extraction_finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("extractor_version", sa.String(length=64), nullable=True),
        sa.Column("fragments_storage_key", sa.String(length=512), nullable=True),
        sa.Column("metadata_storage_key", sa.String(length=512), nullable=True),
        sa.Column("properties_storage_key", sa.String(length=512), nullable=True),
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
        sa.UniqueConstraint("model_id", "version_number", name="uq_project_files_model_version"),
    )
    op.create_index("ix_project_files_model_id", "project_files", ["model_id"])
    op.create_index(
        "ix_project_files_status_created_at",
        "project_files",
        ["status", "created_at"],
    )
    op.create_index(
        "ix_project_files_extraction_status",
        "project_files",
        ["extraction_status"],
    )

    op.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON project_files TO {APP_ROLE};")
    op.execute("ALTER TABLE project_files ENABLE ROW LEVEL SECURITY;")
    op.execute("ALTER TABLE project_files FORCE ROW LEVEL SECURITY;")
    op.execute("DROP POLICY IF EXISTS project_files_tenant_isolation ON project_files;")
    op.execute(
        f"""
        CREATE POLICY project_files_tenant_isolation ON project_files
        USING ({MODEL_ID_IN_ORG_SUBQUERY})
        WITH CHECK ({MODEL_ID_IN_ORG_SUBQUERY});
        """
    )


def downgrade() -> None:
    # Tear down the new project_files + models. Does NOT recreate the legacy
    # project_files shape — there is no preserved data.
    op.execute("DROP POLICY IF EXISTS project_files_tenant_isolation ON project_files;")
    op.execute("ALTER TABLE project_files NO FORCE ROW LEVEL SECURITY;")
    op.execute("ALTER TABLE project_files DISABLE ROW LEVEL SECURITY;")
    op.drop_index("ix_project_files_extraction_status", table_name="project_files")
    op.drop_index("ix_project_files_status_created_at", table_name="project_files")
    op.drop_index("ix_project_files_model_id", table_name="project_files")
    op.drop_table("project_files")

    op.execute("DROP POLICY IF EXISTS models_tenant_isolation ON models;")
    op.execute("ALTER TABLE models NO FORCE ROW LEVEL SECURITY;")
    op.execute("ALTER TABLE models DISABLE ROW LEVEL SECURITY;")
    op.drop_index("ix_models_status", table_name="models")
    op.drop_index("ix_models_project_id", table_name="models")
    op.drop_table("models")

    postgresql.ENUM(*MODEL_STATUS_VALUES, name="modelstatus").drop(op.get_bind(), checkfirst=False)
    postgresql.ENUM(*MODEL_DISCIPLINE_VALUES, name="modeldiscipline").drop(
        op.get_bind(), checkfirst=False
    )
