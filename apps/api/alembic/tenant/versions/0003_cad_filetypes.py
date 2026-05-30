"""CAD file support: add dxf/dwg to `filetype` and `dxf_extraction` to `jobtype`.

Three `ALTER TYPE ... ADD VALUE` statements run fine inside the tenant chain's
single transaction on Postgres 12+ because none of the new values are *used* in
this same migration (no column defaults reference them). The enums live in the
tenant schema, resolved via the session `search_path` the env already set.

Revision ID: 0003_cad_filetypes
Revises: 0002_job_lifecycle
Create Date: 2026-05-30
"""

from __future__ import annotations

import os
from typing import TYPE_CHECKING

from alembic import op
from sqlalchemy import text

if TYPE_CHECKING:
    from collections.abc import Sequence

revision: str = "0003_cad_filetypes"
down_revision: str | None = "0002_job_lifecycle"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _schema() -> str:
    schema = os.environ.get("BIMSTITCH_TENANT_SCHEMA")
    if not schema:
        raise RuntimeError("BIMSTITCH_TENANT_SCHEMA is required for tenant migrations")
    return schema


def upgrade() -> None:
    schema = _schema()
    bind = op.get_bind()

    bind.execute(text(f'ALTER TYPE "{schema}".filetype ADD VALUE IF NOT EXISTS \'dxf\''))
    bind.execute(text(f'ALTER TYPE "{schema}".filetype ADD VALUE IF NOT EXISTS \'dwg\''))
    bind.execute(
        text(f'ALTER TYPE "{schema}".jobtype ADD VALUE IF NOT EXISTS \'dxf_extraction\'')
    )


def downgrade() -> None:
    # Postgres cannot drop an enum value; `dxf`/`dwg`/`dxf_extraction` remain.
    pass
