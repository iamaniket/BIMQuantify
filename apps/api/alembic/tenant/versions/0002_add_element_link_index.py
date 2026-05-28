"""Add partial index on checklist_items(linked_file_id, linked_element_global_id).

Speeds up lookups for the element-inspections endpoint that queries checklist
items linked to a specific IFC element in a specific file.

Revision ID: 0002_element_link_idx
Revises: 0001_tenant
Create Date: 2026-05-28
"""

from __future__ import annotations

import os
from typing import Sequence, Union

from alembic import op
from sqlalchemy import text

# Revision identifiers, used by Alembic.
revision: str = "0002_element_link_idx"
down_revision: Union[str, None] = "0001_tenant"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _schema() -> str:
    schema = os.environ.get("BIMSTITCH_TENANT_SCHEMA")
    if not schema:
        raise RuntimeError("BIMSTITCH_TENANT_SCHEMA is required for tenant migrations")
    return schema


def upgrade() -> None:
    schema = _schema()
    op.get_bind().execute(
        text(
            f"CREATE INDEX IF NOT EXISTS ix_checklist_items_element_link "
            f'ON "{schema}".checklist_items (linked_file_id, linked_element_global_id) '
            f"WHERE linked_element_global_id IS NOT NULL"
        )
    )


def downgrade() -> None:
    schema = _schema()
    op.get_bind().execute(
        text(f'DROP INDEX IF EXISTS "{schema}".ix_checklist_items_element_link')
    )
