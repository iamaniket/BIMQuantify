"""PDF page-rasterization artifact + job type.

Adds:
  * ``project_files.pdf_pages_storage_key`` — manifest (pages.json) of the
    server-rasterized PDF page images the mobile viewer's ImageRasterSource
    loads (PDFs render pdfjs-free on the device).
  * ``jobtype`` enum value ``pdf_pages_rasterization``.

The ``jobtype`` enum lives in the shared ``public`` schema (see the
enums-shared-in-public convention), so the value is added with an UNQUALIFIED
``ALTER TYPE ... ADD VALUE IF NOT EXISTS`` — ``search_path`` resolves it to
``public`` and ``IF NOT EXISTS`` makes the per-schema ``migrate_all`` fan-out
idempotent. The column add targets the active tenant schema's ``project_files``.

On a fresh DB the live ORM models already declare both (create_all in the
baseline emits them), so this delta is only for upgrading existing deployments.

Revision ID: 0002_pdf_pages_raster
Revises: 0001_tenant
Create Date: 2026-06-26
"""

from __future__ import annotations

import os
from typing import Sequence, Union

from alembic import op
from sqlalchemy import text

revision: str = "0002_pdf_pages_raster"
down_revision: Union[str, None] = "0001_tenant"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _schema() -> str:
    schema = os.environ.get("BIMDOSSIER_TENANT_SCHEMA")
    if not schema:
        raise RuntimeError("BIMDOSSIER_TENANT_SCHEMA is required for tenant migrations")
    return schema


def upgrade() -> None:
    schema = _schema()
    bind = op.get_bind()
    bind.execute(
        text(
            f'ALTER TABLE "{schema}".project_files '
            f"ADD COLUMN IF NOT EXISTS pdf_pages_storage_key VARCHAR(512)"
        )
    )
    # Shared public enum — unqualified + IF NOT EXISTS (idempotent across the
    # migrate_all fan-out). The value is only added here (never used in the same
    # transaction), so this is safe inside Alembic's migration transaction on PG 12+.
    bind.execute(
        text("ALTER TYPE jobtype ADD VALUE IF NOT EXISTS 'pdf_pages_rasterization'")
    )


def downgrade() -> None:
    schema = _schema()
    bind = op.get_bind()
    bind.execute(
        text(f'ALTER TABLE "{schema}".project_files DROP COLUMN IF EXISTS pdf_pages_storage_key')
    )
    # Postgres cannot drop an enum value; leave `pdf_pages_rasterization` in place
    # (harmless — a removed value would orphan any row still referencing it).
