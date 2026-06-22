"""Add models.head_file_id — current-revision pointer (F7 restore-as-head).

Adds a nullable `head_file_id` FK on `models` referencing `project_files(id)`
with `ON DELETE SET NULL`. When NULL the model's head is derived as the highest
`version_number` (unchanged behaviour); when set it pins the head to a chosen
older version (the "restore version as head" feature).

Idempotent on purpose: the 0001 baseline provisions fresh tenant schemas via
`Base.metadata.create_all` over the live ORM models, so a brand-new tenant
already has this column (the ORM now declares it). `ADD COLUMN IF NOT EXISTS`
makes this revision a no-op there while still adding the column to tenants
provisioned before it existed. Runs against the schema named in
BIMSTITCH_TENANT_SCHEMA (same convention as 0001).

Revision ID: 0003_model_head_file_id
Revises: 0002_annotation_state
Create Date: 2026-06-22
"""

from __future__ import annotations

import os
from collections.abc import Sequence

from alembic import op
from sqlalchemy import text

# Revision identifiers, used by Alembic.
revision: str = "0003_model_head_file_id"
down_revision: str | None = "0002_annotation_state"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _schema() -> str:
    schema = os.environ.get("BIMSTITCH_TENANT_SCHEMA")
    if not schema:
        raise RuntimeError("BIMSTITCH_TENANT_SCHEMA is required for tenant migrations")
    return schema


def upgrade() -> None:
    schema = _schema()
    op.execute(
        text(
            f'ALTER TABLE "{schema}".models '
            f"ADD COLUMN IF NOT EXISTS head_file_id uuid "
            f'REFERENCES "{schema}".project_files(id) ON DELETE SET NULL'
        )
    )


def downgrade() -> None:
    schema = _schema()
    op.execute(text(f'ALTER TABLE "{schema}".models DROP COLUMN IF EXISTS head_file_id'))
