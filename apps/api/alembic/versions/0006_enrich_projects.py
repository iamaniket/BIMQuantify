"""Enrich projects with construction metadata + contractors table.

Revision ID: 0006_enrich_projects
Revises: 0005_add_models_hard_cut
Create Date: 2026-05-01

Adds:
- `contractors` table (org-scoped, with RLS).
- New columns on `projects`: reference_code, status, phase, delivery_date,
  address fields (street/house_number/postal_code/city/municipality/bag_id),
  permit_number, contractor_id (FK to contractors, SET NULL on delete).
- `projectstatus` and `projectphase` enums.
- Partial unique index on `(organization_id, reference_code)` where ref code
  is set, so multiple NULL ref codes are allowed but a non-null code must be
  unique within an org.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from fastapi_users_db_sqlalchemy.generics import GUID
from sqlalchemy.dialects import postgresql

from bimstitch_api._rls_sql import APP_ROLE

revision: str = "0006_enrich_projects"
down_revision: str | None = "0005_add_models_hard_cut"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


PROJECT_STATUS_VALUES = (
    "planning",
    "ontwerp",
    "vergunning",
    "uitvoering",
    "oplevering",
    "gereed",
    "on_hold",
)
PROJECT_PHASE_VALUES = (
    "ontwerp",
    "bestek",
    "werkvoorbereiding",
    "ruwbouw",
    "afbouw",
    "oplevering",
)


CONTRACTORS_TENANT_POLICY = (
    "organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid"
)


def upgrade() -> None:
    # ------------------------------------------------------------------
    # 1. Create enum types.
    # ------------------------------------------------------------------
    project_status_enum = postgresql.ENUM(*PROJECT_STATUS_VALUES, name="projectstatus")
    project_status_enum.create(op.get_bind(), checkfirst=False)

    project_phase_enum = postgresql.ENUM(*PROJECT_PHASE_VALUES, name="projectphase")
    project_phase_enum.create(op.get_bind(), checkfirst=False)

    # ------------------------------------------------------------------
    # 2. Create contractors table.
    # ------------------------------------------------------------------
    op.create_table(
        "contractors",
        sa.Column("id", GUID(), primary_key=True),
        sa.Column(
            "organization_id",
            GUID(),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("kvk_number", sa.String(length=20), nullable=True),
        sa.Column("contact_email", sa.String(length=320), nullable=True),
        sa.Column("contact_phone", sa.String(length=50), nullable=True),
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
        sa.UniqueConstraint("organization_id", "name", name="uq_contractors_org_name"),
    )
    op.create_index("ix_contractors_organization_id", "contractors", ["organization_id"])

    op.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON contractors TO {APP_ROLE};")
    op.execute("ALTER TABLE contractors ENABLE ROW LEVEL SECURITY;")
    op.execute("ALTER TABLE contractors FORCE ROW LEVEL SECURITY;")
    op.execute("DROP POLICY IF EXISTS contractors_tenant_isolation ON contractors;")
    op.execute(
        f"""
        CREATE POLICY contractors_tenant_isolation ON contractors
        USING ({CONTRACTORS_TENANT_POLICY})
        WITH CHECK ({CONTRACTORS_TENANT_POLICY});
        """
    )

    # ------------------------------------------------------------------
    # 3. Add new columns to projects.
    # ------------------------------------------------------------------
    op.add_column(
        "projects", sa.Column("reference_code", sa.String(length=50), nullable=True)
    )
    op.add_column(
        "projects",
        sa.Column(
            "status",
            postgresql.ENUM(*PROJECT_STATUS_VALUES, name="projectstatus", create_type=False),
            nullable=False,
            server_default="planning",
        ),
    )
    op.add_column(
        "projects",
        sa.Column(
            "phase",
            postgresql.ENUM(*PROJECT_PHASE_VALUES, name="projectphase", create_type=False),
            nullable=False,
            server_default="ontwerp",
        ),
    )
    op.add_column("projects", sa.Column("delivery_date", sa.Date(), nullable=True))
    op.add_column("projects", sa.Column("street", sa.String(length=255), nullable=True))
    op.add_column("projects", sa.Column("house_number", sa.String(length=20), nullable=True))
    op.add_column("projects", sa.Column("postal_code", sa.String(length=7), nullable=True))
    op.add_column("projects", sa.Column("city", sa.String(length=255), nullable=True))
    op.add_column("projects", sa.Column("municipality", sa.String(length=255), nullable=True))
    op.add_column("projects", sa.Column("bag_id", sa.String(length=50), nullable=True))
    op.add_column("projects", sa.Column("permit_number", sa.String(length=100), nullable=True))
    op.add_column(
        "projects",
        sa.Column(
            "contractor_id",
            GUID(),
            sa.ForeignKey("contractors.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )

    op.create_index("ix_projects_status", "projects", ["status"])
    op.create_index("ix_projects_contractor_id", "projects", ["contractor_id"])
    op.create_index(
        "uq_projects_org_reference_code",
        "projects",
        ["organization_id", "reference_code"],
        unique=True,
        postgresql_where=sa.text("reference_code IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("uq_projects_org_reference_code", table_name="projects")
    op.drop_index("ix_projects_contractor_id", table_name="projects")
    op.drop_index("ix_projects_status", table_name="projects")

    op.drop_column("projects", "contractor_id")
    op.drop_column("projects", "permit_number")
    op.drop_column("projects", "bag_id")
    op.drop_column("projects", "municipality")
    op.drop_column("projects", "city")
    op.drop_column("projects", "postal_code")
    op.drop_column("projects", "house_number")
    op.drop_column("projects", "street")
    op.drop_column("projects", "delivery_date")
    op.drop_column("projects", "phase")
    op.drop_column("projects", "status")
    op.drop_column("projects", "reference_code")

    op.execute("DROP POLICY IF EXISTS contractors_tenant_isolation ON contractors;")
    op.execute("ALTER TABLE contractors NO FORCE ROW LEVEL SECURITY;")
    op.execute("ALTER TABLE contractors DISABLE ROW LEVEL SECURITY;")
    op.drop_index("ix_contractors_organization_id", table_name="contractors")
    op.drop_table("contractors")

    postgresql.ENUM(*PROJECT_PHASE_VALUES, name="projectphase").drop(
        op.get_bind(), checkfirst=False
    )
    postgresql.ENUM(*PROJECT_STATUS_VALUES, name="projectstatus").drop(
        op.get_bind(), checkfirst=False
    )
