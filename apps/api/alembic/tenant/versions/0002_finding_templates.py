"""Finding templates (custom finding forms).

Adds the `finding_templates` table plus the `findings.template_id` /
`findings.custom_values` columns.

Idempotent and safe on schemas already stamped at 0001: a fresh schema gets all
of this from the squashed baseline's `Base.metadata.create_all` (FindingTemplate
is registered in the models package, and the new Finding columns are on the
model), so every step here is guarded (checkfirst / column-existence) and no-ops
on a fresh schema. On a pre-existing schema it adds only what's missing.

Revision ID: 0002_finding_templates
Revises: 0001_tenant
Create Date: 2026-06-08
"""

from __future__ import annotations

import os
from typing import TYPE_CHECKING

from alembic import op
from sqlalchemy import text

if TYPE_CHECKING:
    from collections.abc import Sequence

# Revision identifiers, used by Alembic.
revision: str = "0002_finding_templates"
down_revision: str | None = "0001_tenant"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _schema() -> str:
    schema = os.environ.get("BIMSTITCH_TENANT_SCHEMA")
    if not schema:
        raise RuntimeError("BIMSTITCH_TENANT_SCHEMA is required for tenant migrations")
    return schema


def _column_exists(bind, schema: str, table: str, column: str) -> bool:
    return (
        bind.execute(
            text(
                "SELECT 1 FROM information_schema.columns "
                "WHERE table_schema = :s AND table_name = :t AND column_name = :c"
            ),
            {"s": schema, "t": table, "c": column},
        ).scalar()
        is not None
    )


def upgrade() -> None:
    from bimstitch_api.models import FindingTemplate

    bind = op.get_bind()
    schema = _schema()

    # 1. Create finding_templates if absent — including the model-declared
    #    partial-unique-default and active indexes. checkfirst → no-op on a fresh
    #    schema where create_all already emitted it.
    FindingTemplate.__table__.create(bind, checkfirst=True)

    # 2. Add the two findings columns only where they don't already exist. On a
    #    fresh schema create_all already added the columns AND the FK, so we skip
    #    both — re-adding the FK under a different name would duplicate it.
    if not _column_exists(bind, schema, "findings", "template_id"):
        bind.execute(text(f'ALTER TABLE "{schema}".findings ADD COLUMN template_id uuid'))
        bind.execute(
            text(
                f'ALTER TABLE "{schema}".findings '
                f"ADD CONSTRAINT fk_findings_template_id "
                f'FOREIGN KEY (template_id) REFERENCES "{schema}".finding_templates(id) '
                f"ON DELETE SET NULL"
            )
        )
    if not _column_exists(bind, schema, "findings", "custom_values"):
        bind.execute(text(f'ALTER TABLE "{schema}".findings ADD COLUMN custom_values jsonb'))


def downgrade() -> None:
    from bimstitch_api.models import FindingTemplate

    bind = op.get_bind()
    schema = _schema()
    bind.execute(
        text(f'ALTER TABLE "{schema}".findings DROP CONSTRAINT IF EXISTS fk_findings_template_id')
    )
    bind.execute(text(f'ALTER TABLE "{schema}".findings DROP COLUMN IF EXISTS custom_values'))
    bind.execute(text(f'ALTER TABLE "{schema}".findings DROP COLUMN IF EXISTS template_id'))
    FindingTemplate.__table__.drop(bind, checkfirst=True)
