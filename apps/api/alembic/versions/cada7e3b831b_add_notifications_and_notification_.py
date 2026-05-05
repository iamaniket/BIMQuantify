"""add notifications and notification_reads tables

Revision ID: cada7e3b831b
Revises: 0001_initial
Create Date: 2026-05-04 17:43:56.939856
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

from bimstitch_api._rls_sql import APP_ROLE

# revision identifiers, used by Alembic.
revision: str = "cada7e3b831b"
down_revision: str | None = "0001_initial"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_NEW_TABLES = ("notifications", "notification_reads")

_ORG_MATCH = (
    "organization_id = "
    "NULLIF(current_setting('app.current_org_id', true), '')::uuid"
)
_USER_MATCH = (
    "user_id = "
    "NULLIF(current_setting('app.current_user_id', true), '')::uuid"
)


def upgrade() -> None:
    op.create_table(
        "notifications",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("organization_id", sa.UUID(), nullable=False),
        sa.Column("project_id", sa.UUID(), nullable=True),
        sa.Column("file_id", sa.UUID(), nullable=True),
        sa.Column("job_id", sa.UUID(), nullable=True),
        sa.Column(
            "event_type",
            sa.Enum(
                "job_started",
                "job_succeeded",
                "job_failed",
                "job_progress",
                name="notificationeventtype",
            ),
            nullable=False,
        ),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["file_id"], ["project_files.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["job_id"], ["jobs.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(
            ["organization_id"], ["organizations.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_notifications_org_created_at",
        "notifications",
        ["organization_id", sa.literal_column("created_at DESC")],
        unique=False,
    )
    op.create_index(
        "ix_notifications_organization_id",
        "notifications",
        ["organization_id"],
        unique=False,
    )
    op.create_table(
        "notification_reads",
        sa.Column("notification_id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column(
            "read_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["notification_id"], ["notifications.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("notification_id", "user_id"),
    )

    # Grant DML privileges to the app role.
    op.execute(
        f"GRANT SELECT, INSERT, UPDATE, DELETE ON {', '.join(_NEW_TABLES)} TO {APP_ROLE};"
    )

    # Enable RLS + FORCE on new tables.
    for table in _NEW_TABLES:
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY;")
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY;")

    # notifications: org match (same shape as jobs).
    op.execute(
        f"""
        CREATE POLICY notifications_tenant_isolation ON notifications
        USING ({_ORG_MATCH})
        WITH CHECK ({_ORG_MATCH});
        """
    )

    # notification_reads: user match.
    op.execute(
        f"""
        CREATE POLICY notification_reads_user_isolation ON notification_reads
        USING ({_USER_MATCH})
        WITH CHECK ({_USER_MATCH});
        """
    )


def downgrade() -> None:
    op.execute(
        "DROP POLICY IF EXISTS notification_reads_user_isolation ON notification_reads;"
    )
    op.execute(
        "DROP POLICY IF EXISTS notifications_tenant_isolation ON notifications;"
    )
    for table in reversed(_NEW_TABLES):
        op.execute(f"ALTER TABLE {table} NO FORCE ROW LEVEL SECURITY;")
        op.execute(f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY;")

    op.drop_table("notification_reads")
    op.drop_index("ix_notifications_organization_id", table_name="notifications")
    op.drop_index("ix_notifications_org_created_at", table_name="notifications")
    op.drop_table("notifications")
