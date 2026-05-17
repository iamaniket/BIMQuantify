"""add building_type, consequence_class, planned_start_date to projects

Adds three classification fields to the projects table for WKB MVP
backlog #9. All three are jurisdiction-neutral codes:

- building_type      -> dwelling / commercial / other (NL labels render
                        via jurisdictions/nl.py)
- consequence_class  -> cc1 / cc2 / cc3 (Eurocode EN 1990 Annex B; NL
                        Gevolgklasse GK1/2/3 maps directly to these)
- planned_start_date -> nullable Date; feeds the deadline tracker (#28)

All three columns are nullable so existing rows continue to validate.

Revision ID: d3f8e9c1b2a4
Revises: c5d7e2f8a3b1
Create Date: 2026-05-17 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "d3f8e9c1b2a4"
down_revision: str | None = "c5d7e2f8a3b1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Use raw DO blocks for CREATE TYPE — op.get_bind() with checkfirst=True
    # is unreliable on asyncpg (see f8a1c2d3e4b5 module docstring).
    op.execute("""
        DO $$ BEGIN
            CREATE TYPE buildingtype AS ENUM ('dwelling', 'commercial', 'other');
        EXCEPTION WHEN duplicate_object THEN NULL;
        END $$;
    """)
    op.execute("""
        DO $$ BEGIN
            CREATE TYPE consequenceclass AS ENUM ('cc1', 'cc2', 'cc3');
        EXCEPTION WHEN duplicate_object THEN NULL;
        END $$;
    """)

    op.add_column(
        "projects",
        sa.Column(
            "planned_start_date",
            sa.Date(),
            nullable=True,
        ),
    )
    op.add_column(
        "projects",
        sa.Column(
            "building_type",
            sa.Enum(
                "dwelling",
                "commercial",
                "other",
                name="buildingtype",
                create_type=False,
            ),
            nullable=True,
        ),
    )
    op.add_column(
        "projects",
        sa.Column(
            "consequence_class",
            sa.Enum(
                "cc1",
                "cc2",
                "cc3",
                name="consequenceclass",
                create_type=False,
            ),
            nullable=True,
        ),
    )
    op.create_index(
        "ix_projects_planned_start_date",
        "projects",
        ["planned_start_date"],
    )


def downgrade() -> None:
    op.drop_index("ix_projects_planned_start_date", table_name="projects")
    op.drop_column("projects", "consequence_class")
    op.drop_column("projects", "building_type")
    op.drop_column("projects", "planned_start_date")
    op.execute("DROP TYPE IF EXISTS consequenceclass;")
    op.execute("DROP TYPE IF EXISTS buildingtype;")
