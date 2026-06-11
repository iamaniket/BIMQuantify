"""Add project_files.floor_plans_storage_key (per-level floor-plan artifact).

Mirrors the existing outline_storage_key artifact column. The processor emits a
`.floorplans.bin` artifact (section cut + IfcSpace rooms per storey); the API
stores its S3 key here and presigns it into the viewer bundle.

Additive + nullable, so no backfill. `ADD COLUMN IF NOT EXISTS` keeps this a
no-op on freshly-provisioned schemas (the squashed 0001 baseline runs
`Base.metadata.create_all`, which already emits the model-declared column) while
still adding it to schemas stamped at 0001 before the column existed. Runs
per-schema via `scripts.migrate_all` (BIMSTITCH_TENANT_SCHEMA).

Revision ID: 0002_floor_plans_key
Revises: 0001_tenant
Create Date: 2026-06-11
"""

from __future__ import annotations

import os

from alembic import op
from sqlalchemy import text

# Revision identifiers, used by Alembic.
revision: str = "0002_floor_plans_key"
down_revision: str | None = "0001_tenant"
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None


def _schema() -> str:
    schema = os.environ.get("BIMSTITCH_TENANT_SCHEMA")
    if not schema:
        raise RuntimeError("BIMSTITCH_TENANT_SCHEMA is required for tenant migrations")
    return schema


def upgrade() -> None:
    bind = op.get_bind()
    schema = _schema()
    bind.execute(
        text(
            f'ALTER TABLE "{schema}".project_files '
            f"ADD COLUMN IF NOT EXISTS floor_plans_storage_key VARCHAR(512)"
        )
    )


def downgrade() -> None:
    bind = op.get_bind()
    schema = _schema()
    bind.execute(
        text(
            f'ALTER TABLE "{schema}".project_files '
            f"DROP COLUMN IF EXISTS floor_plans_storage_key"
        )
    )
