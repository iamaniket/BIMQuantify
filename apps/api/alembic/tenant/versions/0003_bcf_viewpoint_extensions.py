"""BCF viewpoint x-ray + measurements columns.

Adds the nullable JSONB columns `bcf_viewpoints.xray` and
`bcf_viewpoints.measurements` (non-standard BCF extensions persisted alongside
the standard camera/components/clipping-plane state).

Idempotent and safe on schemas already stamped at 0002: a fresh schema gets
both columns from the squashed baseline's `Base.metadata.create_all` (they are
declared on the BcfViewpoint model), so each add is guarded on column existence
and no-ops on a fresh schema. On a pre-existing schema it adds only what's
missing.

Revision ID: 0003_bcf_viewpoint_extensions
Revises: 0002_finding_templates
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
revision: str = "0003_bcf_viewpoint_extensions"
down_revision: str | None = "0002_finding_templates"
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

    if not _column_exists(bind, schema, "bcf_viewpoints", "xray"):
        bind.execute(text(f'ALTER TABLE "{schema}".bcf_viewpoints ADD COLUMN xray jsonb'))
    if not _column_exists(bind, schema, "bcf_viewpoints", "measurements"):
        bind.execute(
            text(f'ALTER TABLE "{schema}".bcf_viewpoints ADD COLUMN measurements jsonb')
        )


def downgrade() -> None:
    bind = op.get_bind()
    schema = _schema()
    bind.execute(text(f'ALTER TABLE "{schema}".bcf_viewpoints DROP COLUMN IF EXISTS measurements'))
    bind.execute(text(f'ALTER TABLE "{schema}".bcf_viewpoints DROP COLUMN IF EXISTS xray'))
