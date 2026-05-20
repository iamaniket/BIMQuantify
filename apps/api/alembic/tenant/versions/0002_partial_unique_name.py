"""Make project name/reference_code uniqueness exclude soft-deleted rows.

The old `uq_projects_name` constraint blocked name reuse after a project was
soft-deleted (lifecycle_state = 'removed'). Replace it with a partial unique
index that only enforces uniqueness among non-removed projects. Same treatment
for `uq_projects_reference_code`.

Revision ID: 0002_tenant
Revises: 0001_tenant
Create Date: 2026-05-20
"""

from __future__ import annotations

import os
from typing import Sequence, Union

from alembic import op
from sqlalchemy import text

revision: str = "0002_tenant"
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
    bind = op.get_bind()

    # --- name uniqueness: full constraint → partial index ---
    bind.execute(
        text(f'ALTER TABLE "{schema}".projects DROP CONSTRAINT IF EXISTS uq_projects_name')
    )
    bind.execute(
        text(
            f'DROP INDEX IF EXISTS "{schema}".uq_projects_name'
        )
    )
    bind.execute(
        text(
            f'CREATE UNIQUE INDEX uq_projects_name_active '
            f'ON "{schema}".projects(name) '
            f"WHERE lifecycle_state != 'removed'"
        )
    )

    # --- reference_code uniqueness: add removed exclusion ---
    bind.execute(
        text(f'DROP INDEX IF EXISTS "{schema}".uq_projects_reference_code')
    )
    bind.execute(
        text(
            f'CREATE UNIQUE INDEX uq_projects_reference_code '
            f'ON "{schema}".projects(reference_code) '
            f"WHERE reference_code IS NOT NULL AND lifecycle_state != 'removed'"
        )
    )


def downgrade() -> None:
    schema = _schema()
    bind = op.get_bind()

    bind.execute(
        text(f'DROP INDEX IF EXISTS "{schema}".uq_projects_name_active')
    )
    bind.execute(
        text(
            f'ALTER TABLE "{schema}".projects '
            f"ADD CONSTRAINT uq_projects_name UNIQUE (name)"
        )
    )

    bind.execute(
        text(f'DROP INDEX IF EXISTS "{schema}".uq_projects_reference_code')
    )
    bind.execute(
        text(
            f'CREATE UNIQUE INDEX uq_projects_reference_code '
            f'ON "{schema}".projects(reference_code) '
            f"WHERE reference_code IS NOT NULL"
        )
    )
