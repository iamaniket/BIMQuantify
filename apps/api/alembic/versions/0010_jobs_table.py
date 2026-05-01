"""Add jobs table for tenant-level job tracking.

Revision ID: 0010_jobs_table
Revises: 0009_project_lifecycle
Create Date: 2026-05-01
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

from bimstitch_api._rls_sql import APP_ROLE

revision: str = "0010_jobs_table"
down_revision: str | None = "0009_project_lifecycle"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


JOB_TYPE_VALUES = ("ifc_extraction", "pdf_extraction", "verification", "batch_update")
JOB_STATUS_VALUES = ("pending", "started", "running", "succeeded", "failed")


def upgrade() -> None:
    jobtype_enum = postgresql.ENUM(*JOB_TYPE_VALUES, name="jobtype")
    jobtype_enum.create(op.get_bind(), checkfirst=False)

    jobstatus_enum = postgresql.ENUM(*JOB_STATUS_VALUES, name="jobstatus")
    jobstatus_enum.create(op.get_bind(), checkfirst=False)

    op.create_table(
        "jobs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("projects.id", ondelete="SET NULL"), nullable=True),
        sa.Column("file_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("project_files.id", ondelete="SET NULL"), nullable=True),
        sa.Column("job_type", postgresql.ENUM(*JOB_TYPE_VALUES, name="jobtype", create_type=False), nullable=False),
        sa.Column("status", postgresql.ENUM(*JOB_STATUS_VALUES, name="jobstatus", create_type=False), nullable=False, server_default="pending"),
        sa.Column("payload", postgresql.JSONB(), nullable=False, server_default="{}"),
        sa.Column("result", postgresql.JSONB(), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("created_by_user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
    )

    op.create_index("ix_jobs_organization_id", "jobs", ["organization_id"])
    op.create_index("ix_jobs_project_id", "jobs", ["project_id"], postgresql_where=sa.text("project_id IS NOT NULL"))
    op.create_index("ix_jobs_file_id", "jobs", ["file_id"], postgresql_where=sa.text("file_id IS NOT NULL"))
    op.create_index("ix_jobs_status", "jobs", ["status"])
    op.create_index("ix_jobs_job_type", "jobs", ["job_type"])
    op.create_index("ix_jobs_org_created_at", "jobs", ["organization_id", sa.text("created_at DESC")])

    op.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON jobs TO {APP_ROLE};")
    op.execute("ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;")
    op.execute("ALTER TABLE jobs FORCE ROW LEVEL SECURITY;")
    op.execute(
        "CREATE POLICY jobs_tenant_isolation ON jobs "
        "USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid) "
        "WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);"
    )


def downgrade() -> None:
    op.execute("DROP POLICY IF EXISTS jobs_tenant_isolation ON jobs;")
    op.execute("ALTER TABLE jobs NO FORCE ROW LEVEL SECURITY;")
    op.execute("ALTER TABLE jobs DISABLE ROW LEVEL SECURITY;")

    op.drop_index("ix_jobs_org_created_at", table_name="jobs")
    op.drop_index("ix_jobs_job_type", table_name="jobs")
    op.drop_index("ix_jobs_status", table_name="jobs")
    op.drop_index("ix_jobs_file_id", table_name="jobs")
    op.drop_index("ix_jobs_project_id", table_name="jobs")
    op.drop_index("ix_jobs_organization_id", table_name="jobs")

    op.drop_table("jobs")

    postgresql.ENUM(*JOB_STATUS_VALUES, name="jobstatus").drop(op.get_bind(), checkfirst=False)
    postgresql.ENUM(*JOB_TYPE_VALUES, name="jobtype").drop(op.get_bind(), checkfirst=False)
