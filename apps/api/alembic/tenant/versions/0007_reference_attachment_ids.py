"""Add reference_attachment_ids to findings and checklist_item_results.

Findings and inspection results can now reference existing project documents
(drawings, certificates, calculations) via a JSONB string list, following the
established ``photo_ids`` pattern.

Idempotent: the squashed 0001 baseline runs ``Base.metadata.create_all`` over
the *current* models, so a freshly provisioned schema already has the columns.
The column guard makes this increment a no-op there and only does work on
schemas provisioned before the column existed.

Revision ID: 0007_reference_attachment_ids
Revises: 0006_report_signing
Create Date: 2026-05-31
"""

from __future__ import annotations

import os
from typing import TYPE_CHECKING

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect
from sqlalchemy.dialects.postgresql import JSONB

if TYPE_CHECKING:
    from collections.abc import Sequence

revision: str = "0007_reference_attachment_ids"
down_revision: str | None = "0006_report_signing"
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
    insp = inspect(bind)

    finding_cols = {c["name"] for c in insp.get_columns("findings", schema=schema)}
    if "reference_attachment_ids" not in finding_cols:
        op.add_column(
            "findings",
            sa.Column("reference_attachment_ids", JSONB, nullable=True),
            schema=schema,
        )

    result_cols = {c["name"] for c in insp.get_columns("checklist_item_results", schema=schema)}
    if "reference_attachment_ids" not in result_cols:
        op.add_column(
            "checklist_item_results",
            sa.Column("reference_attachment_ids", JSONB, nullable=True),
            schema=schema,
        )


def downgrade() -> None:
    schema = _schema()
    bind = op.get_bind()
    insp = inspect(bind)

    result_cols = {c["name"] for c in insp.get_columns("checklist_item_results", schema=schema)}
    if "reference_attachment_ids" in result_cols:
        op.drop_column("checklist_item_results", "reference_attachment_ids", schema=schema)

    finding_cols = {c["name"] for c in insp.get_columns("findings", schema=schema)}
    if "reference_attachment_ids" in finding_cols:
        op.drop_column("findings", "reference_attachment_ids", schema=schema)
