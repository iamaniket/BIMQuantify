"""Project file outline artifact key — outline_storage_key.

Adds a nullable `outline_storage_key` column to `project_files` so the
extraction callback can persist the precomputed hard-edge outline artifact
(`*.outline.bin`) the processor uploads alongside fragments. Files extracted
before this change keep NULL and the viewer falls back to client-side
edge computation.

Idempotent: the column add is guarded by `_column_exists` so a fresh
schema (where `Base.metadata.create_all` already declared the column)
no-ops cleanly.

Revision ID: 0005_project_file_outline_key
Revises: 0004_deadline_filing_fields
Create Date: 2026-06-10
"""

from __future__ import annotations

import os
from typing import TYPE_CHECKING

from alembic import op
from sqlalchemy import text

if TYPE_CHECKING:
    from collections.abc import Sequence

# Revision identifiers, used by Alembic.
revision: str = "0005_project_file_outline_key"
down_revision: str | None = "0004_deadline_filing_fields"
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

    if not _column_exists(bind, schema, "project_files", "outline_storage_key"):
        bind.execute(
            text(
                f'ALTER TABLE "{schema}".project_files '
                "ADD COLUMN outline_storage_key varchar(512)"
            )
        )


def downgrade() -> None:
    bind = op.get_bind()
    schema = _schema()
    bind.execute(
        text(f'ALTER TABLE "{schema}".project_files DROP COLUMN IF EXISTS outline_storage_key')
    )
