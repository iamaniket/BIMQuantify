"""Deadline filing fields — reference_number, filing_notes, filed_at.

Adds three nullable columns to the `deadlines` table so the filing flow
can record the OLO/Omgevingsloket reference number, free-text notes,
and the timestamp when the user confirmed the filing.

Idempotent: each column add is guarded by `_column_exists` so a fresh
schema (where `Base.metadata.create_all` already declared the columns)
no-ops cleanly.

Revision ID: 0004_deadline_filing_fields
Revises: 0003_bcf_viewpoint_extensions
Create Date: 2026-06-09
"""

from __future__ import annotations

import os
from typing import TYPE_CHECKING

from alembic import op
from sqlalchemy import text

if TYPE_CHECKING:
    from collections.abc import Sequence

# Revision identifiers, used by Alembic.
revision: str = "0004_deadline_filing_fields"
down_revision: str | None = "0003_bcf_viewpoint_extensions"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _schema() -> str:
    schema = os.environ.get("BIMSTITCH_TENANT_SCHEMA")
    if not schema:
        raise RuntimeError("BIMSTITCH_TENANT_SCHEMA is required for tenant migrations")
    return schema


def _column_exists(bind, schema: str, table: str, column: str) -> bool:
    return (
        bind.execute(
            text(
                "SELECT 1 FROM information_schema.columns "
                "WHERE table_schema = :s AND table_name = :t AND column_name = :c"
            ),
            {"s": schema, "t": table, "c": column},
        ).scalar()
        is not None
    )


def upgrade() -> None:
    bind = op.get_bind()
    schema = _schema()

    if not _column_exists(bind, schema, "deadlines", "reference_number"):
        bind.execute(
            text(f'ALTER TABLE "{schema}".deadlines ADD COLUMN reference_number varchar(100)')
        )
    if not _column_exists(bind, schema, "deadlines", "filing_notes"):
        bind.execute(
            text(f'ALTER TABLE "{schema}".deadlines ADD COLUMN filing_notes text')
        )
    if not _column_exists(bind, schema, "deadlines", "filed_at"):
        bind.execute(
            text(f'ALTER TABLE "{schema}".deadlines ADD COLUMN filed_at timestamptz')
        )


def downgrade() -> None:
    bind = op.get_bind()
    schema = _schema()
    bind.execute(text(f'ALTER TABLE "{schema}".deadlines DROP COLUMN IF EXISTS filed_at'))
    bind.execute(text(f'ALTER TABLE "{schema}".deadlines DROP COLUMN IF EXISTS filing_notes'))
    bind.execute(text(f'ALTER TABLE "{schema}".deadlines DROP COLUMN IF EXISTS reference_number'))
