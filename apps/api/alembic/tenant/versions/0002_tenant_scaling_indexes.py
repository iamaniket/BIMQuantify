"""Scaling indexes for high-growth tenant tables.

Adds three indexes to every tenant schema (parameterized by
BIMSTITCH_TENANT_SCHEMA, like 0001):

1. ix_jobs_payload_framework — expression index on jobs.(payload->>'framework').
   Compliance lookups filter Job.payload["framework"].astext == 'bbl' (see
   routers/compliance.py::_load_latest_compliance_job). `framework` is data,
   not schema (jurisdiction-blind JobType), so we index the JSONB path rather
   than promoting it to a column. Without this, every compliance lookup is a
   seq scan over the org's whole jobs table.

2. ix_findings_project_created — (project_id, created_at DESC) WHERE
   deleted_at IS NULL. Backs the findings list endpoint's
   `ORDER BY created_at DESC` over the soft-delete-filtered set; the existing
   (project_id) / (project_id, status) indexes don't support the sort.

3. ix_audit_created_at — (created_at DESC). Supports the unfiltered admin
   audit feed. Every existing audit_log index carries created_at as a
   secondary column, so a feed ordered by created_at alone can't use them.

Revision ID: 0002_tenant
Revises: 0001_tenant
Create Date: 2026-05-29
"""

from __future__ import annotations

import os
from typing import Sequence, Union

from alembic import op
from sqlalchemy import text

# Revision identifiers, used by Alembic.
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
    bind = op.get_bind()
    schema = _schema()

    bind.execute(
        text(
            f"CREATE INDEX IF NOT EXISTS ix_jobs_payload_framework "
            f"ON \"{schema}\".jobs ((payload ->> 'framework'))"
        )
    )
    bind.execute(
        text(
            f"CREATE INDEX IF NOT EXISTS ix_findings_project_created "
            f'ON "{schema}".findings (project_id, created_at DESC) '
            f"WHERE deleted_at IS NULL"
        )
    )
    bind.execute(
        text(
            f"CREATE INDEX IF NOT EXISTS ix_audit_created_at "
            f'ON "{schema}".audit_log (created_at DESC)'
        )
    )


def downgrade() -> None:
    bind = op.get_bind()
    schema = _schema()
    bind.execute(text(f'DROP INDEX IF EXISTS "{schema}".ix_audit_created_at'))
    bind.execute(text(f'DROP INDEX IF EXISTS "{schema}".ix_findings_project_created'))
    bind.execute(text(f'DROP INDEX IF EXISTS "{schema}".ix_jobs_payload_framework'))
