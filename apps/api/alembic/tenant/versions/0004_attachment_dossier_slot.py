"""attachments.dossier_slot — per-requirement dossier classification (#N2).

Documents are categorized only coarsely (``attachment_category`` = office /
image / …) which can't tell a constructieberekening PDF from a BENG report.
This adds a nullable ``dossier_slot`` enum so a document can declare which
*dossier bevoegd gezag* requirement it satisfies (drawings, structural
calculations, fire safety, …). It's assigned from the dossier checklist UI
(upload-into-slot or link-existing), never inferred from the file.

Idempotent on purpose. The squashed 0001 baseline runs
``Base.metadata.create_all`` over the *current* models, so a freshly
provisioned schema already has the column + the ``dossierslot`` type. The
column guard makes this increment a no-op there and only does work on schemas
provisioned before the column existed. Same defensive spirit as 0003.

Runs once per tenant schema (BIMSTITCH_TENANT_SCHEMA); the tenant env sets the
search_path inside Alembic's transaction.

Revision ID: 0004_attachment_dossier_slot
Revises: 0003_notification_dismissals
Create Date: 2026-05-31
"""

from __future__ import annotations

import os
from typing import TYPE_CHECKING

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect
from sqlalchemy.dialects import postgresql

if TYPE_CHECKING:
    from collections.abc import Sequence

# Revision identifiers, used by Alembic.
revision: str = "0004_attachment_dossier_slot"
down_revision: str | None = "0003_notification_dismissals"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_ENUM_VALUES = (
    "drawings",
    "structural_calculations",
    "fire_safety",
    "energy_performance",
    "installations",
    "assurance",
    "inspection_evidence",
    "other",
)
_SLOT_WHERE = "dossier_slot IS NOT NULL AND deleted_at IS NULL"


def _schema() -> str:
    schema = os.environ.get("BIMSTITCH_TENANT_SCHEMA")
    if not schema:
        raise RuntimeError("BIMSTITCH_TENANT_SCHEMA is required for tenant migrations")
    return schema


def upgrade() -> None:
    schema = _schema()
    bind = op.get_bind()
    cols = {c["name"] for c in inspect(bind).get_columns("attachments", schema=schema)}
    if "dossier_slot" in cols:
        # Fresh schema already has it via the create_all baseline.
        return

    # Create the per-schema enum type if a partially-applied state left it out.
    values_sql = ", ".join(f"'{v}'" for v in _ENUM_VALUES)
    bind.execute(
        sa.text(
            f"DO $$ BEGIN "
            f"IF NOT EXISTS ("
            f"  SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace "
            f"  WHERE t.typname = 'dossierslot' AND n.nspname = '{schema}'"
            f") THEN CREATE TYPE \"{schema}\".dossierslot AS ENUM ({values_sql}); "
            f"END IF; END $$;"
        )
    )
    op.add_column(
        "attachments",
        sa.Column(
            "dossier_slot",
            postgresql.ENUM(*_ENUM_VALUES, name="dossierslot", create_type=False),
            nullable=True,
        ),
        schema=schema,
    )
    op.create_index(
        "ix_attachments_dossier_slot",
        "attachments",
        ["project_id", "dossier_slot"],
        schema=schema,
        postgresql_where=sa.text(_SLOT_WHERE),
    )


def downgrade() -> None:
    schema = _schema()
    bind = op.get_bind()
    cols = {c["name"] for c in inspect(bind).get_columns("attachments", schema=schema)}
    if "dossier_slot" not in cols:
        return
    op.drop_index("ix_attachments_dossier_slot", table_name="attachments", schema=schema)
    op.drop_column("attachments", "dossier_slot", schema=schema)
    bind.execute(sa.text(f'DROP TYPE IF EXISTS "{schema}".dossierslot'))
