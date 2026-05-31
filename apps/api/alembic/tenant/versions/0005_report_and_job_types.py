"""report + job enum values for the assurance_plan / completion_declaration /
dossier report types (backlog #31/#32/#33).

The squashed 0001 baseline runs ``Base.metadata.create_all`` over the current
models, so a freshly provisioned schema already has these enum values the moment
the model enums declare them. This increment only backfills schemas provisioned
*before* the values existed. ``ADD VALUE IF NOT EXISTS`` is natively idempotent,
so re-running is a no-op on every schema — same defensive spirit as 0002–0004.

PG16 allows ``ALTER TYPE … ADD VALUE`` inside a transaction block; the only
restriction (a newly added value can't be *used* in the same transaction)
doesn't apply here — we only add them, never reference them. Downgrade is a
no-op: Postgres cannot drop an enum value without recreating the type and
rewriting every column that uses it, and these values are additive-only.

Runs once per tenant schema (BIMSTITCH_TENANT_SCHEMA); the tenant env sets the
search_path inside Alembic's transaction.

Revision ID: 0005_report_and_job_types
Revises: 0004_attachment_dossier_slot
Create Date: 2026-05-31
"""

from __future__ import annotations

import os
from typing import TYPE_CHECKING

import sqlalchemy as sa
from alembic import op

if TYPE_CHECKING:
    from collections.abc import Sequence

# Revision identifiers, used by Alembic.
revision: str = "0005_report_and_job_types"
down_revision: str | None = "0004_attachment_dossier_slot"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# enum type name -> new values to add (assurance_plan / completion_declaration /
# dossier on `reporttype`; the matching renderer JobTypes on `jobtype`).
_NEW_VALUES: dict[str, tuple[str, ...]] = {
    "reporttype": ("assurance_plan", "completion_declaration", "dossier"),
    "jobtype": (
        "assurance_plan_report",
        "completion_declaration_report",
        "dossier_report",
    ),
}


def _schema() -> str:
    schema = os.environ.get("BIMSTITCH_TENANT_SCHEMA")
    if not schema:
        raise RuntimeError("BIMSTITCH_TENANT_SCHEMA is required for tenant migrations")
    return schema


def _enum_exists(bind: sa.Connection, schema: str, type_name: str) -> bool:
    """Return True if the given enum type exists in the tenant schema."""
    row = bind.execute(
        sa.text(
            "SELECT 1 FROM pg_type t "
            "JOIN pg_namespace n ON n.oid = t.typnamespace "
            "WHERE n.nspname = :schema AND t.typname = :type_name"
        ),
        {"schema": schema, "type_name": type_name},
    ).fetchone()
    return row is not None


def upgrade() -> None:
    schema = _schema()
    bind = op.get_bind()
    for type_name, values in _NEW_VALUES.items():
        if not _enum_exists(bind, schema, type_name):
            # Enum doesn't exist yet in this schema — nothing to alter.
            # The 0001 baseline's create_all will have created the enum with
            # all current values for freshly provisioned schemas; for schemas
            # provisioned before the reports/jobs tables existed, the tables
            # (and their enum types) simply aren't there yet.
            continue
        for value in values:
            bind.execute(
                sa.text(
                    f'ALTER TYPE "{schema}".{type_name} '
                    f"ADD VALUE IF NOT EXISTS '{value}'"
                )
            )


def downgrade() -> None:
    # Additive-only: Postgres can't drop an enum value without recreating the
    # type (and rewriting every column that uses it). No-op by design — matches
    # the additive-only style of the surrounding tenant increments.
    pass
