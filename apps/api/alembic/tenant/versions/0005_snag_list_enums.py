"""Add `snag_list` report type + `snag_list_report` job type enum values (#G2).

Grows two enums so the per-recipient bevindingen snag-list PDF can be created
and rendered:
  - `reporttype` gains `snag_list` (the Report row's type)
  - `jobtype`    gains `snag_list_report` (the worker pipeline)

Type names are left UNQUALIFIED so they resolve via the migration's
`search_path` (`"<schema>", public`, set by the tenant env) — the same
convention as 0002_annotation_state / 0004_buildingtype_funcs. In the current
databases every enum lives in shared `public`, so the first org's run appends
the values and the rest are idempotent no-ops, each still stamping its own
`alembic_version`. A freshly provisioned schema runs the 0001 baseline via
`Base.metadata.create_all` (which already emits every value from the ORM model),
so this revision is a no-op there too.

PostgreSQL 12+ permits `ADD VALUE` inside a transaction as long as the new value
is not *used* in the same transaction — we only add, never insert — so it is
safe under Alembic's per-migration transaction.

Run across every org schema with
`uv run python -m bimstitch_api.scripts.migrate_all` (verify with `--check`).

`downgrade` is a no-op: PostgreSQL cannot drop a value from an enum without
recreating the type, and the appended values are inert if unused.

Revision ID: 0005_snag_list_enums
Revises: 0004_buildingtype_funcs
Create Date: 2026-06-23
"""

from __future__ import annotations

from alembic import op

revision = "0005_snag_list_enums"
down_revision = "0004_buildingtype_funcs"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TYPE reporttype ADD VALUE IF NOT EXISTS 'snag_list'")
    op.execute("ALTER TYPE jobtype ADD VALUE IF NOT EXISTS 'snag_list_report'")


def downgrade() -> None:
    # PostgreSQL cannot remove a value from an enum without recreating the type.
    # The appended values are inert if unused, so downgrade is intentionally a
    # no-op.
    pass
