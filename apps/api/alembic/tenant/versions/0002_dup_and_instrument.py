"""Tenant delta: findings.duplicate_of_finding_id + projects.instrument_ref.

Quick-wins backend (item 4 duplicate detection, item 8 instrument bundle) added
two tenant columns. The tenant baseline (0001) is ``create_all`` over the live
models, so freshly-provisioned orgs already have these; this delta patches
PRE-EXISTING org schemas via ``scripts.migrate_all``. Every statement is guarded
(``IF NOT EXISTS`` / catalog checks) so it is a no-op where create_all already
ran — safe to replay in-process on a new org too.

Revision ID: 0002_dup_and_instrument
Revises: 0001_tenant
"""

from __future__ import annotations

import os
from typing import Sequence, Union

from alembic import op
from sqlalchemy import text

revision: str = "0002_dup_and_instrument"
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

    # item 4 — duplicate linkage (self-FK, SET NULL).
    bind.execute(
        text(
            f'ALTER TABLE "{schema}".findings '
            f"ADD COLUMN IF NOT EXISTS duplicate_of_finding_id UUID"
        )
    )
    # Add the FK only if no foreign key already covers the column (create_all on a
    # new org schema may have made it with an auto-generated name).
    bind.execute(
        text(
            f"""
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1
                    FROM information_schema.key_column_usage kcu
                    JOIN information_schema.table_constraints tc
                      ON tc.constraint_name = kcu.constraint_name
                     AND tc.constraint_schema = kcu.constraint_schema
                    WHERE kcu.table_schema = '{schema}'
                      AND kcu.table_name = 'findings'
                      AND kcu.column_name = 'duplicate_of_finding_id'
                      AND tc.constraint_type = 'FOREIGN KEY'
                ) THEN
                    ALTER TABLE "{schema}".findings
                        ADD CONSTRAINT fk_findings_duplicate_of_finding_id
                        FOREIGN KEY (duplicate_of_finding_id)
                        REFERENCES "{schema}".findings (id) ON DELETE SET NULL;
                END IF;
            END $$;
            """
        )
    )

    # item 8 — the admitted-instrument the project targets.
    bind.execute(
        text(
            f'ALTER TABLE "{schema}".projects '
            f"ADD COLUMN IF NOT EXISTS instrument_ref VARCHAR(50)"
        )
    )


def downgrade() -> None:
    schema = _schema()
    bind = op.get_bind()
    bind.execute(
        text(
            f'ALTER TABLE "{schema}".findings '
            f"DROP CONSTRAINT IF EXISTS fk_findings_duplicate_of_finding_id"
        )
    )
    bind.execute(
        text(
            f'ALTER TABLE "{schema}".findings '
            f"DROP COLUMN IF EXISTS duplicate_of_finding_id"
        )
    )
    bind.execute(
        text(f'ALTER TABLE "{schema}".projects DROP COLUMN IF EXISTS instrument_ref')
    )
