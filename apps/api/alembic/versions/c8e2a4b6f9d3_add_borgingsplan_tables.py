"""add borgingsplan + borgingsmomenten + checklist_items tables + RLS

Wkb MVP backlog #15 + #16: Borgingsplan data model with version/status, owns
Borgingsmomenten (planned inspection events per construction phase), each
owning ordered ChecklistItems. RLS scopes everything through project_id.

Partial unique index `ux_borgingsplans_one_active` enforces "at most one
draft-or-published plan per project" at the DB layer; superseded rows are
unbounded for the legal audit trail.

Revision ID: c8e2a4b6f9d3
Revises: b7c4e2f9d8a1
Create Date: 2026-05-18 16:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

from bimstitch_api._rls_sql import APP_ROLE, PROJECT_ID_IN_ORG_SUBQUERY

revision: str = "c8e2a4b6f9d3"
down_revision: str | None = "b7c4e2f9d8a1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Idempotent CREATE TYPE blocks (single-line enum list per asyncpg quirk).
    op.execute(
        "DO $$ BEGIN "
        "CREATE TYPE borgingsplanstatus AS ENUM ('draft', 'published', 'superseded'); "
        "EXCEPTION WHEN duplicate_object THEN NULL; "
        "END $$;"
    )
    op.execute(
        "DO $$ BEGIN "
        "CREATE TYPE borgingsmomentphase AS ENUM "
        "('foundation', 'shell', 'roof', 'finishing', 'handover', 'other'); "
        "EXCEPTION WHEN duplicate_object THEN NULL; "
        "END $$;"
    )
    op.execute(
        "DO $$ BEGIN "
        "CREATE TYPE borgingsmomentstatus AS ENUM "
        "('planned', 'in_progress', 'passed', 'failed', 'skipped'); "
        "EXCEPTION WHEN duplicate_object THEN NULL; "
        "END $$;"
    )
    op.execute(
        "DO $$ BEGIN "
        "CREATE TYPE checklistitemtype AS ENUM ('text', 'document', 'photo', 'ifc_element'); "
        "EXCEPTION WHEN duplicate_object THEN NULL; "
        "END $$;"
    )
    op.execute(
        "DO $$ BEGIN "
        "CREATE TYPE evidencetype AS ENUM "
        "('photo', 'certificate', 'measurement', 'document', 'signature'); "
        "EXCEPTION WHEN duplicate_object THEN NULL; "
        "END $$;"
    )

    # borgingsplans
    op.create_table(
        "borgingsplans",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("project_id", sa.UUID(), nullable=False),
        sa.Column("version_number", sa.Integer(), nullable=False),
        sa.Column(
            "status",
            postgresql.ENUM(
                "draft",
                "published",
                "superseded",
                name="borgingsplanstatus",
                create_type=False,
            ),
            nullable=False,
            server_default="draft",
        ),
        sa.Column("created_by_user_id", sa.UUID(), nullable=False),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("superseded_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
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
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "project_id", "version_number", name="uq_borgingsplans_project_version"
        ),
    )
    op.create_index("ix_borgingsplans_project_id", "borgingsplans", ["project_id"])
    # Partial unique: at most one draft-or-published plan per project.
    op.execute(
        "CREATE UNIQUE INDEX ux_borgingsplans_one_active "
        "ON borgingsplans(project_id) "
        "WHERE status IN ('draft', 'published');"
    )

    # borgingsmomenten
    op.create_table(
        "borgingsmomenten",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("borgingsplan_id", sa.UUID(), nullable=False),
        sa.Column("project_id", sa.UUID(), nullable=False),
        sa.Column(
            "phase",
            postgresql.ENUM(
                "foundation",
                "shell",
                "roof",
                "finishing",
                "handover",
                "other",
                name="borgingsmomentphase",
                create_type=False,
            ),
            nullable=False,
        ),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("planned_date", sa.Date(), nullable=False),
        sa.Column("actual_date", sa.Date(), nullable=True),
        sa.Column("responsible_user_id", sa.UUID(), nullable=True),
        sa.Column(
            "status",
            postgresql.ENUM(
                "planned",
                "in_progress",
                "passed",
                "failed",
                "skipped",
                name="borgingsmomentstatus",
                create_type=False,
            ),
            nullable=False,
            server_default="planned",
        ),
        sa.Column("sequence_in_phase", sa.Integer(), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
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
            ["borgingsplan_id"], ["borgingsplans.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["responsible_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_borgingsmomenten_plan_id", "borgingsmomenten", ["borgingsplan_id"])
    op.create_index("ix_borgingsmomenten_project_id", "borgingsmomenten", ["project_id"])
    op.create_index(
        "ix_borgingsmomenten_plan_phase_seq",
        "borgingsmomenten",
        ["borgingsplan_id", "phase", "sequence_in_phase"],
    )

    # checklist_items
    op.create_table(
        "checklist_items",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("borgingsmoment_id", sa.UUID(), nullable=False),
        sa.Column("project_id", sa.UUID(), nullable=False),
        sa.Column(
            "item_type",
            postgresql.ENUM(
                "text",
                "document",
                "photo",
                "ifc_element",
                name="checklistitemtype",
                create_type=False,
            ),
            nullable=False,
            server_default="text",
        ),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column(
            "evidence_type",
            postgresql.ENUM(
                "photo",
                "certificate",
                "measurement",
                "document",
                "signature",
                name="evidencetype",
                create_type=False,
            ),
            nullable=False,
        ),
        sa.Column("bbl_article_ref", sa.String(length=50), nullable=True),
        sa.Column("pass_fail_criteria", sa.Text(), nullable=True),
        sa.Column("sequence", sa.Integer(), nullable=False),
        sa.Column("linked_element_global_id", sa.String(length=22), nullable=True),
        sa.Column("linked_file_id", sa.UUID(), nullable=True),
        sa.Column("extra_data", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
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
            ["borgingsmoment_id"], ["borgingsmomenten.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["linked_file_id"], ["project_files.id"], ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_checklist_items_moment_id", "checklist_items", ["borgingsmoment_id"]
    )
    op.create_index("ix_checklist_items_project_id", "checklist_items", ["project_id"])
    op.create_index(
        "ix_checklist_items_moment_sequence",
        "checklist_items",
        ["borgingsmoment_id", "sequence"],
    )

    # Grant DML to the app role.
    op.execute(
        f"GRANT SELECT, INSERT, UPDATE, DELETE ON "
        f"borgingsplans, borgingsmomenten, checklist_items TO {APP_ROLE};"
    )

    # Enable + force RLS.
    for table in ("borgingsplans", "borgingsmomenten", "checklist_items"):
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY;")
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY;")

    op.execute(
        f"""
        CREATE POLICY borgingsplans_tenant_isolation ON borgingsplans
        USING ({PROJECT_ID_IN_ORG_SUBQUERY})
        WITH CHECK ({PROJECT_ID_IN_ORG_SUBQUERY});
        """
    )
    op.execute(
        f"""
        CREATE POLICY borgingsmomenten_tenant_isolation ON borgingsmomenten
        USING ({PROJECT_ID_IN_ORG_SUBQUERY})
        WITH CHECK ({PROJECT_ID_IN_ORG_SUBQUERY});
        """
    )
    op.execute(
        f"""
        CREATE POLICY checklist_items_tenant_isolation ON checklist_items
        USING ({PROJECT_ID_IN_ORG_SUBQUERY})
        WITH CHECK ({PROJECT_ID_IN_ORG_SUBQUERY});
        """
    )


def downgrade() -> None:
    op.execute(
        "DROP POLICY IF EXISTS checklist_items_tenant_isolation ON checklist_items;"
    )
    op.execute(
        "DROP POLICY IF EXISTS borgingsmomenten_tenant_isolation ON borgingsmomenten;"
    )
    op.execute("DROP POLICY IF EXISTS borgingsplans_tenant_isolation ON borgingsplans;")

    for table in ("checklist_items", "borgingsmomenten", "borgingsplans"):
        op.execute(f"ALTER TABLE {table} NO FORCE ROW LEVEL SECURITY;")
        op.execute(f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY;")

    op.drop_index("ix_checklist_items_moment_sequence", table_name="checklist_items")
    op.drop_index("ix_checklist_items_project_id", table_name="checklist_items")
    op.drop_index("ix_checklist_items_moment_id", table_name="checklist_items")
    op.drop_table("checklist_items")

    op.drop_index("ix_borgingsmomenten_plan_phase_seq", table_name="borgingsmomenten")
    op.drop_index("ix_borgingsmomenten_project_id", table_name="borgingsmomenten")
    op.drop_index("ix_borgingsmomenten_plan_id", table_name="borgingsmomenten")
    op.drop_table("borgingsmomenten")

    op.execute("DROP INDEX IF EXISTS ux_borgingsplans_one_active;")
    op.drop_index("ix_borgingsplans_project_id", table_name="borgingsplans")
    op.drop_table("borgingsplans")

    op.execute("DROP TYPE IF EXISTS evidencetype;")
    op.execute("DROP TYPE IF EXISTS checklistitemtype;")
    op.execute("DROP TYPE IF EXISTS borgingsmomentstatus;")
    op.execute("DROP TYPE IF EXISTS borgingsmomentphase;")
    op.execute("DROP TYPE IF EXISTS borgingsplanstatus;")
