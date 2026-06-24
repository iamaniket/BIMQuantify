"""Add idempotency_key to findings + project_files (offline-replay dedup).

The mobile app keeps an outbox of writes made while offline and replays them on
reconnect. To make a replayed `POST /findings` / `POST /attachments/initiate`
safe (a lost response must not create a duplicate), the client sends a stable
`Idempotency-Key`; the server stores it on the created row behind a per-user
partial-unique index and returns the original row on replay. See
`bimstitch_api/idempotency.py`.

Adds, to BOTH tenant tables:
  - nullable `idempotency_key varchar(200)` — NULL for online (portal) creates
    and every pre-existing row, so they are unaffected.
  - a partial-unique index on `(creator/uploader, idempotency_key)` —
    `WHERE idempotency_key IS NOT NULL` so only offline-origin rows are
    constrained; scoped to the creator so a leaked key can't replay another
    member's write.

Idempotent on purpose: the 0001 baseline provisions fresh tenant schemas via
`Base.metadata.create_all` over the live ORM models (which now declare the
column + index), so a brand-new tenant already has them; `IF NOT EXISTS` makes
this revision a no-op there while still patching tenants provisioned earlier.
Runs against the schema named in BIMSTITCH_TENANT_SCHEMA (same convention as
0003). Apply across every org schema with
`uv run python -m bimstitch_api.scripts.migrate_all` (verify with `--check`).

Revision ID: 0006_idempotency_key
Revises: 0005_snag_list_enums
Create Date: 2026-06-24
"""

from __future__ import annotations

import os

from alembic import op
from sqlalchemy import text

# Revision identifiers, used by Alembic.
revision = "0006_idempotency_key"
down_revision = "0005_snag_list_enums"
branch_labels = None
depends_on = None


def _schema() -> str:
    schema = os.environ.get("BIMSTITCH_TENANT_SCHEMA")
    if not schema:
        raise RuntimeError("BIMSTITCH_TENANT_SCHEMA is required for tenant migrations")
    return schema


def upgrade() -> None:
    schema = _schema()
    op.execute(
        text(
            f'ALTER TABLE "{schema}".findings '
            f"ADD COLUMN IF NOT EXISTS idempotency_key varchar(200)"
        )
    )
    op.execute(
        text(
            f"CREATE UNIQUE INDEX IF NOT EXISTS uq_findings_creator_idempotency_key "
            f'ON "{schema}".findings (created_by_user_id, idempotency_key) '
            f"WHERE idempotency_key IS NOT NULL"
        )
    )
    op.execute(
        text(
            f'ALTER TABLE "{schema}".project_files '
            f"ADD COLUMN IF NOT EXISTS idempotency_key varchar(200)"
        )
    )
    op.execute(
        text(
            f"CREATE UNIQUE INDEX IF NOT EXISTS uq_project_files_uploader_idempotency_key "
            f'ON "{schema}".project_files (uploaded_by_user_id, idempotency_key) '
            f"WHERE idempotency_key IS NOT NULL"
        )
    )


def downgrade() -> None:
    schema = _schema()
    op.execute(
        text(f'DROP INDEX IF EXISTS "{schema}".uq_project_files_uploader_idempotency_key')
    )
    op.execute(
        text(f'ALTER TABLE "{schema}".project_files DROP COLUMN IF EXISTS idempotency_key')
    )
    op.execute(
        text(f'DROP INDEX IF EXISTS "{schema}".uq_findings_creator_idempotency_key')
    )
    op.execute(text(f'ALTER TABLE "{schema}".findings DROP COLUMN IF EXISTS idempotency_key'))
