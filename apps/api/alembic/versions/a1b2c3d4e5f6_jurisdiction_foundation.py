"""jurisdiction foundation: country column, neutral status/phase, single compliance_check JobType

Merges the two prior branch heads (e7a4f2c918d0 access_requests + f8a1c2d3e4b5 reports)
and lands the schema changes needed to make NL a first-class jurisdiction while
keeping the door open for multi-country expansion:

* `projects.country` — ISO 3166-1 alpha-2; default 'NL'.
* `projectstatus` / `projectphase` enums — Dutch values renamed to neutral codes.
* `jobtype` enum — `bbl_compliance_check` and `wkb_compliance_check` collapsed into
  the single `compliance_check` value (framework moves into job.payload).
* `reports.locale` — drop the 'nl' server default (server resolves from the
  project's jurisdiction at request time).

Revision ID: a1b2c3d4e5f6
Revises: e7a4f2c918d0, f8a1c2d3e4b5
Create Date: 2026-05-13 12:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a1b2c3d4e5f6"
# Merge migration: list both prior heads so alembic can walk back to either.
down_revision: str | tuple[str, ...] | None = ("e7a4f2c918d0", "f8a1c2d3e4b5")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# ---------------------------------------------------------------------------
# Enum value maps (forward + reverse)
# ---------------------------------------------------------------------------

_STATUS_RENAMES_FORWARD: tuple[tuple[str, str], ...] = (
    ("ontwerp", "design"),
    ("vergunning", "permit_review"),
    ("uitvoering", "construction"),
    ("oplevering", "handover"),
    ("gereed", "complete"),
)

_PHASE_RENAMES_FORWARD: tuple[tuple[str, str], ...] = (
    ("ontwerp", "design"),
    ("bestek", "tender"),
    ("werkvoorbereiding", "work_prep"),
    ("ruwbouw", "shell"),
    ("afbouw", "finishing"),
    ("oplevering", "handover"),
)

_NEW_JOBTYPE_VALUES = (
    "ifc_extraction",
    "pdf_extraction",
    "verification",
    "batch_update",
    "compliance_check",
    "compliance_report",
)

_OLD_JOBTYPE_VALUES = (
    "ifc_extraction",
    "pdf_extraction",
    "verification",
    "batch_update",
    "bbl_compliance_check",
    "wkb_compliance_check",
    "compliance_check",
    "compliance_report",
)


def _rename_enum_values(type_name: str, mapping: tuple[tuple[str, str], ...]) -> None:
    for old, new in mapping:
        op.execute(f"ALTER TYPE {type_name} RENAME VALUE '{old}' TO '{new}';")


# ---------------------------------------------------------------------------
# Upgrade
# ---------------------------------------------------------------------------


def upgrade() -> None:
    # --- 1. projects.country ------------------------------------------------
    op.add_column(
        "projects",
        sa.Column(
            "country",
            sa.String(length=2),
            nullable=False,
            server_default="NL",
        ),
    )
    op.create_index(
        "ix_projects_organization_id_country",
        "projects",
        ["organization_id", "country"],
    )

    # --- 2. Collapse jobtype enum -------------------------------------------
    # First, migrate any rows that still reference the old framework-specific
    # values. Framework moves into payload so downstream consumers can find it.
    op.execute(
        """
        UPDATE jobs
        SET payload = COALESCE(payload, '{}'::jsonb)
                      || jsonb_build_object('framework', 'bbl')
        WHERE job_type = 'bbl_compliance_check'
          AND NOT (payload ? 'framework');
        """
    )
    op.execute(
        """
        UPDATE jobs
        SET payload = COALESCE(payload, '{}'::jsonb)
                      || jsonb_build_object('framework', 'wkb')
        WHERE job_type = 'wkb_compliance_check'
          AND NOT (payload ? 'framework');
        """
    )
    # Cast existing rows to the unified value. After this point, no row
    # references bbl_compliance_check / wkb_compliance_check.
    op.execute(
        """
        ALTER TYPE jobtype RENAME TO jobtype_old;
        """
    )
    new_enum_sql = ", ".join(f"'{v}'" for v in _NEW_JOBTYPE_VALUES)
    op.execute(f"CREATE TYPE jobtype AS ENUM ({new_enum_sql});")
    op.execute(
        """
        ALTER TABLE jobs
        ALTER COLUMN job_type TYPE jobtype USING (
            CASE job_type::text
                WHEN 'bbl_compliance_check' THEN 'compliance_check'
                WHEN 'wkb_compliance_check' THEN 'compliance_check'
                ELSE job_type::text
            END
        )::jobtype;
        """
    )
    op.execute("DROP TYPE jobtype_old;")

    # --- 3. Rename projectstatus / projectphase values ---------------------
    _rename_enum_values("projectstatus", _STATUS_RENAMES_FORWARD)
    _rename_enum_values("projectphase", _PHASE_RENAMES_FORWARD)

    # --- 4. Drop reports.locale server default ------------------------------
    op.alter_column(
        "reports",
        "locale",
        existing_type=sa.String(length=8),
        existing_nullable=False,
        server_default=None,
    )


# ---------------------------------------------------------------------------
# Downgrade
# ---------------------------------------------------------------------------


def downgrade() -> None:
    # Reverse projectstatus / projectphase renames.
    _rename_enum_values(
        "projectstatus",
        tuple((new, old) for old, new in _STATUS_RENAMES_FORWARD),
    )
    _rename_enum_values(
        "projectphase",
        tuple((new, old) for old, new in _PHASE_RENAMES_FORWARD),
    )

    # Reverse reports.locale default.
    op.alter_column(
        "reports",
        "locale",
        existing_type=sa.String(length=8),
        existing_nullable=False,
        server_default="nl",
    )

    # Recreate jobtype with the old values. Use payload.framework (if set) to
    # restore bbl_compliance_check / wkb_compliance_check for compliance checks.
    op.execute("ALTER TYPE jobtype RENAME TO jobtype_new;")
    old_enum_sql = ", ".join(f"'{v}'" for v in _OLD_JOBTYPE_VALUES)
    op.execute(f"CREATE TYPE jobtype AS ENUM ({old_enum_sql});")
    op.execute(
        """
        ALTER TABLE jobs
        ALTER COLUMN job_type TYPE jobtype USING (
            CASE
                WHEN job_type::text = 'compliance_check'
                     AND (payload ->> 'framework') = 'wkb'
                THEN 'wkb_compliance_check'
                WHEN job_type::text = 'compliance_check'
                     AND (payload ->> 'framework') = 'bbl'
                THEN 'bbl_compliance_check'
                ELSE job_type::text
            END
        )::jobtype;
        """
    )
    op.execute("DROP TYPE jobtype_new;")

    # Drop country column.
    op.drop_index("ix_projects_organization_id_country", table_name="projects")
    op.drop_column("projects", "country")
