"""Add Bbl gebruiksfunctie values to the `buildingtype` enum.

Grows the `buildingtype` enum from the original 3 values
(dwelling/commercial/other) to the full Dutch Bbl "gebruiksfuncties" set by
appending 10 new codes via `ALTER TYPE ... ADD VALUE`.

The type name is left UNQUALIFIED so it resolves via the migration's
`search_path` (`"<schema>", public`, set by the tenant env) — the same
convention as 0002_annotation_state. This is deliberately layout-agnostic: it
resolves to the org schema's enum if one exists there, otherwise the shared
`public.buildingtype` (how the current databases are actually provisioned — all
enum types live in `public` and every tenant's `projects.building_type`
references it). Either way the right type is altered.

`IF NOT EXISTS` makes this idempotent across the per-schema fan-out: when the
enum is shared in `public`, the first org's run appends the values and the rest
are no-ops, each still stamping its own `alembic_version` to this revision. A
freshly provisioned schema runs the 0001 baseline via `Base.metadata.create_all`
(which already emits every value from the ORM model), so this revision is a
no-op there too. PostgreSQL 12+ permits `ADD VALUE` inside a transaction as long
as the new value is not *used* in the same transaction — we only add, never
insert — so it is safe under Alembic's per-migration transaction. New values are
appended to the end of the enum; ordering is irrelevant because nothing sorts on
the enum type.

Run across every org schema with
`uv run python -m bimstitch_api.scripts.migrate_all` (verify with `--check`).

`downgrade` is a no-op: PostgreSQL cannot drop a value from an enum without
recreating the type, and the appended values are inert if unused.

Revision ID: 0004_buildingtype_funcs
Revises: 0003_model_head_file_id
Create Date: 2026-06-23
"""

from __future__ import annotations

from alembic import op

revision = "0004_buildingtype_funcs"
down_revision = "0003_model_head_file_id"
branch_labels = None
depends_on = None

# Bbl gebruiksfuncties added on top of the original dwelling/commercial/other.
_NEW_VALUES = (
    "assembly",
    "cell",
    "healthcare",
    "industrial",
    "office",
    "accommodation",
    "education",
    "sport",
    "retail",
    "non_building",
)


def upgrade() -> None:
    for value in _NEW_VALUES:
        op.execute(f"ALTER TYPE buildingtype ADD VALUE IF NOT EXISTS '{value}'")


def downgrade() -> None:
    # PostgreSQL cannot remove a value from an enum without recreating the type.
    # The appended values are inert if unused, so downgrade is intentionally a
    # no-op.
    pass
