"""Job lifecycle controls: cancelled status + retry/progress columns.

Adds the `cancelled` value to the per-tenant `jobstatus` enum and five columns
to `jobs`: `retriable`, `error_kind`, `progress`, `retry_of` (self-FK lineage),
`attempt`. Plus a partial index on `retry_of`.

`ALTER TYPE ... ADD VALUE` runs fine inside the tenant chain's single
transaction on Postgres 12+ because the new value is not *used* in this same
migration (we only add columns). The enum lives in the tenant schema, resolved
via the session `search_path` the env already set.

Revision ID: 0002_job_lifecycle
Revises: 0001_tenant
Create Date: 2026-05-30
"""

from __future__ import annotations

import os
from typing import TYPE_CHECKING

from alembic import op
from sqlalchemy import text

if TYPE_CHECKING:
    from collections.abc import Sequence

revision: str = "0002_job_lifecycle"
down_revision: str | None = "0001_tenant"
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

    bind.execute(text(f'ALTER TYPE "{schema}".jobstatus ADD VALUE IF NOT EXISTS \'cancelled\''))

    bind.execute(
        text(
            f'ALTER TABLE "{schema}".jobs '
            "ADD COLUMN IF NOT EXISTS retriable boolean NOT NULL DEFAULT false, "
            "ADD COLUMN IF NOT EXISTS error_kind text, "
            "ADD COLUMN IF NOT EXISTS progress integer NOT NULL DEFAULT 0, "
            "ADD COLUMN IF NOT EXISTS retry_of uuid, "
            "ADD COLUMN IF NOT EXISTS attempt integer NOT NULL DEFAULT 1"
        )
    )
    bind.execute(
        text(
            f'ALTER TABLE "{schema}".jobs '
            "ADD CONSTRAINT jobs_retry_of_fkey "
            f'FOREIGN KEY (retry_of) REFERENCES "{schema}".jobs(id) ON DELETE SET NULL'
        )
    )
    bind.execute(
        text(
            f'CREATE INDEX IF NOT EXISTS ix_jobs_retry_of ON "{schema}".jobs (retry_of) '
            "WHERE retry_of IS NOT NULL"
        )
    )


def downgrade() -> None:
    schema = _schema()
    bind = op.get_bind()

    bind.execute(text(f'DROP INDEX IF EXISTS "{schema}".ix_jobs_retry_of'))
    bind.execute(text(f'ALTER TABLE "{schema}".jobs DROP CONSTRAINT IF EXISTS jobs_retry_of_fkey'))
    bind.execute(
        text(
            f'ALTER TABLE "{schema}".jobs '
            "DROP COLUMN IF EXISTS retriable, "
            "DROP COLUMN IF EXISTS error_kind, "
            "DROP COLUMN IF EXISTS progress, "
            "DROP COLUMN IF EXISTS retry_of, "
            "DROP COLUMN IF EXISTS attempt"
        )
    )
    # Postgres cannot drop an enum value; `cancelled` remains on `jobstatus`.
