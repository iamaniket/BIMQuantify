"""Add project_files.annotation_state (image annotation vectors).

Adds a nullable JSONB column holding the editable `Annotation2D[]` document for
image attachments (the markup drawn over a photo plus a pointer to the source
version). The displayed bytes remain the flattened raster uploaded as a new
attachment version; this column keeps the markup re-editable.

It is a plain ADD COLUMN — no Postgres `Enum` is touched — so the tenant
fan-out is the cheap kind. Run across every org schema with
`uv run python -m bimstitch_api.scripts.migrate_all`.

`IF NOT EXISTS` makes the upgrade idempotent: a freshly provisioned schema runs
the 0001 baseline via `create_all` (which already emits the column from the
model) and then this revision becomes a no-op, while an existing deployed schema
gets the column added.

The `search_path` is set to the target tenant schema by the env, so the
unqualified table name resolves to the right schema.

Revision ID: 0002_annotation_state
Revises: 0001_tenant
Create Date: 2026-06-19
"""

from __future__ import annotations

from alembic import op

revision = "0002_annotation_state"
down_revision = "0001_tenant"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE project_files ADD COLUMN IF NOT EXISTS annotation_state JSONB")


def downgrade() -> None:
    op.execute("ALTER TABLE project_files DROP COLUMN IF EXISTS annotation_state")
