"""add reports table + compliance_report JobType + RLS

Revision ID: f8a1c2d3e4b5
Revises: cada7e3b831b
Create Date: 2026-05-12 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

from bimstitch_api._rls_sql import APP_ROLE

# revision identifiers, used by Alembic.
revision: str = "f8a1c2d3e4b5"
down_revision: str | None = "cada7e3b831b"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


_ORG_MATCH = (
    "organization_id = "
    "NULLIF(current_setting('app.current_org_id', true), '')::uuid"
)


def upgrade() -> None:
    # Extend the existing JobType enum with the new compliance_report variant.
    # ALTER TYPE ... ADD VALUE cannot run inside a transaction block in older
    # postgres; alembic 1.13+ on PG 12+ handles this if we use COMMIT autocommit
    # — but a safer pattern is to commit the surrounding transaction first.
    # In practice this works in our docker-compose Postgres 16 setup directly.
    op.execute("ALTER TYPE jobtype ADD VALUE IF NOT EXISTS 'compliance_report';")

    # New enums for reports.
    report_type_enum = sa.Enum(
        "compliance_report",
        name="reporttype",
    )
    report_type_enum.create(op.get_bind(), checkfirst=True)

    report_status_enum = sa.Enum(
        "queued",
        "running",
        "ready",
        "failed",
        name="reportstatus",
    )
    report_status_enum.create(op.get_bind(), checkfirst=True)

    op.create_table(
        "reports",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("organization_id", sa.UUID(), nullable=False),
        sa.Column("project_id", sa.UUID(), nullable=False),
        sa.Column(
            "report_type",
            sa.Enum("compliance_report", name="reporttype", create_type=False),
            nullable=False,
        ),
        sa.Column(
            "status",
            sa.Enum("queued", "running", "ready", "failed", name="reportstatus", create_type=False),
            nullable=False,
            server_default="queued",
        ),
        sa.Column("job_id", sa.UUID(), nullable=True),
        sa.Column("source_job_id", sa.UUID(), nullable=True),
        sa.Column("storage_key", sa.Text(), nullable=True),
        sa.Column("byte_size", sa.BigInteger(), nullable=True),
        sa.Column("sha256", sa.String(length=64), nullable=True),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("locale", sa.String(length=8), nullable=False, server_default="nl"),
        sa.Column(
            "params",
            sa.dialects.postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("created_by_user_id", sa.UUID(), nullable=True),
        sa.Column(
            "finished_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["organization_id"], ["organizations.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["job_id"], ["jobs.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["source_job_id"], ["jobs.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(
            ["created_by_user_id"], ["users.id"], ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_reports_organization_id", "reports", ["organization_id"])
    op.create_index(
        "ix_reports_project_created_at",
        "reports",
        ["project_id", sa.literal_column("created_at DESC")],
    )
    op.create_index("ix_reports_status", "reports", ["status"])
    op.create_index(
        "ix_reports_job_id",
        "reports",
        ["job_id"],
        postgresql_where=sa.text("job_id IS NOT NULL"),
    )
    op.create_index("ix_reports_report_type", "reports", ["report_type"])

    # Grant DML to the app role.
    op.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON reports TO {APP_ROLE};")

    # Enable + force RLS.
    op.execute("ALTER TABLE reports ENABLE ROW LEVEL SECURITY;")
    op.execute("ALTER TABLE reports FORCE ROW LEVEL SECURITY;")

    op.execute(
        f"""
        CREATE POLICY reports_tenant_isolation ON reports
        USING ({_ORG_MATCH})
        WITH CHECK ({_ORG_MATCH});
        """
    )


def downgrade() -> None:
    op.execute("DROP POLICY IF EXISTS reports_tenant_isolation ON reports;")
    op.execute("ALTER TABLE reports NO FORCE ROW LEVEL SECURITY;")
    op.execute("ALTER TABLE reports DISABLE ROW LEVEL SECURITY;")

    op.drop_index("ix_reports_report_type", table_name="reports")
    op.drop_index("ix_reports_job_id", table_name="reports")
    op.drop_index("ix_reports_status", table_name="reports")
    op.drop_index("ix_reports_project_created_at", table_name="reports")
    op.drop_index("ix_reports_organization_id", table_name="reports")
    op.drop_table("reports")

    sa.Enum(name="reportstatus").drop(op.get_bind(), checkfirst=True)
    sa.Enum(name="reporttype").drop(op.get_bind(), checkfirst=True)

    # Note: removing an enum value from JobType requires recreating the enum.
    # We don't reverse it on downgrade — leaving 'compliance_report' in the
    # enum is harmless if no rows reference it.
