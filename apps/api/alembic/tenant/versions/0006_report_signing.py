"""reports.signed_at / signed_by_user_id / signature_hash — verklaring
sign-to-lock (#32).

The squashed 0001 baseline runs ``Base.metadata.create_all`` over the current
models, so a freshly provisioned schema already has these columns + the FK. This
increment only backfills schemas provisioned before the columns existed; the
column guard makes it a no-op on fresh schemas. Purely additive — same
defensive spirit as 0004.

Runs once per tenant schema (BIMSTITCH_TENANT_SCHEMA); the tenant env sets the
search_path inside Alembic's transaction.

Revision ID: 0006_report_signing
Revises: 0005_report_and_job_types
Create Date: 2026-05-31
"""

from __future__ import annotations

import os
from typing import TYPE_CHECKING

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect
from sqlalchemy.dialects import postgresql

if TYPE_CHECKING:
    from collections.abc import Sequence

# Revision identifiers, used by Alembic.
revision: str = "0006_report_signing"
down_revision: str | None = "0005_report_and_job_types"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_FK_NAME = "fk_reports_signed_by_user"


def _schema() -> str:
    schema = os.environ.get("BIMSTITCH_TENANT_SCHEMA")
    if not schema:
        raise RuntimeError("BIMSTITCH_TENANT_SCHEMA is required for tenant migrations")
    return schema


def upgrade() -> None:
    schema = _schema()
    bind = op.get_bind()
    cols = {c["name"] for c in inspect(bind).get_columns("reports", schema=schema)}

    if "signed_at" not in cols:
        op.add_column(
            "reports",
            sa.Column("signed_at", sa.DateTime(timezone=True), nullable=True),
            schema=schema,
        )
    if "signed_by_user_id" not in cols:
        op.add_column(
            "reports",
            sa.Column("signed_by_user_id", postgresql.UUID(as_uuid=True), nullable=True),
            schema=schema,
        )
        op.create_foreign_key(
            _FK_NAME,
            "reports",
            "users",
            ["signed_by_user_id"],
            ["id"],
            source_schema=schema,
            referent_schema="public",
            ondelete="SET NULL",
        )
    if "signature_hash" not in cols:
        op.add_column(
            "reports",
            sa.Column("signature_hash", sa.String(length=64), nullable=True),
            schema=schema,
        )


def downgrade() -> None:
    schema = _schema()
    bind = op.get_bind()
    cols = {c["name"] for c in inspect(bind).get_columns("reports", schema=schema)}
    if "signature_hash" in cols:
        op.drop_column("reports", "signature_hash", schema=schema)
    if "signed_by_user_id" in cols:
        op.drop_constraint(_FK_NAME, "reports", schema=schema, type_="foreignkey")
        op.drop_column("reports", "signed_by_user_id", schema=schema)
    if "signed_at" in cols:
        op.drop_column("reports", "signed_at", schema=schema)
