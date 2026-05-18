"""add risks table + riskcategory/risklevel enums + RLS

Wkb MVP backlog #13: Risicobeoordeling data model. A Risk row hangs off
a project (CASCADE delete) and carries Bbl category, severity level,
description, mitigation, optional responsible party + Bbl article ref.

Tenancy is enforced via RLS scoped through projects.organization_id —
same shape as the existing `models` and `project_members` policies.

Revision ID: b7c4e2f9d8a1
Revises: f2a8b6c4d1e3
Create Date: 2026-05-18 14:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

from bimstitch_api._rls_sql import APP_ROLE, PROJECT_ID_IN_ORG_SUBQUERY

revision: str = "b7c4e2f9d8a1"
down_revision: str | None = "f2a8b6c4d1e3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Idempotent CREATE TYPE — op.get_bind() with checkfirst=True is
    # unreliable on asyncpg (see f8a1c2d3e4b5 module docstring). The CREATE
    # TYPE list is kept on a single line because the asyncpg DO-block parser
    # has bitten us when the enum spans multiple physical lines.
    op.execute(
        "DO $$ BEGIN "
        "CREATE TYPE riskcategory AS ENUM "
        "('structural_safety', 'fire_safety', 'health', 'energy_efficiency', 'usability'); "
        "EXCEPTION WHEN duplicate_object THEN NULL; "
        "END $$;"
    )
    op.execute(
        "DO $$ BEGIN "
        "CREATE TYPE risklevel AS ENUM ('low', 'medium', 'high'); "
        "EXCEPTION WHEN duplicate_object THEN NULL; "
        "END $$;"
    )

    op.create_table(
        "risks",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("project_id", sa.UUID(), nullable=False),
        sa.Column(
            "category",
            postgresql.ENUM(
                "structural_safety",
                "fire_safety",
                "health",
                "energy_efficiency",
                "usability",
                name="riskcategory",
                create_type=False,
            ),
            nullable=False,
        ),
        sa.Column(
            "level",
            postgresql.ENUM(
                "low", "medium", "high", name="risklevel", create_type=False
            ),
            nullable=False,
        ),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("mitigation", sa.Text(), nullable=False),
        sa.Column("responsible_party", sa.String(length=255), nullable=True),
        sa.Column("bbl_article_ref", sa.String(length=50), nullable=True),
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
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_risks_project_id", "risks", ["project_id"])
    op.create_index(
        "ix_risks_project_category_level",
        "risks",
        ["project_id", "category", "level"],
    )

    # Grant DML to the app role.
    op.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON risks TO {APP_ROLE};")

    # Enable + force RLS.
    op.execute("ALTER TABLE risks ENABLE ROW LEVEL SECURITY;")
    op.execute("ALTER TABLE risks FORCE ROW LEVEL SECURITY;")

    op.execute(
        f"""
        CREATE POLICY risks_tenant_isolation ON risks
        USING ({PROJECT_ID_IN_ORG_SUBQUERY})
        WITH CHECK ({PROJECT_ID_IN_ORG_SUBQUERY});
        """
    )


def downgrade() -> None:
    op.execute("DROP POLICY IF EXISTS risks_tenant_isolation ON risks;")
    op.execute("ALTER TABLE risks NO FORCE ROW LEVEL SECURITY;")
    op.execute("ALTER TABLE risks DISABLE ROW LEVEL SECURITY;")

    op.drop_index("ix_risks_project_category_level", table_name="risks")
    op.drop_index("ix_risks_project_id", table_name="risks")
    op.drop_table("risks")

    op.execute("DROP TYPE IF EXISTS risklevel;")
    op.execute("DROP TYPE IF EXISTS riskcategory;")
