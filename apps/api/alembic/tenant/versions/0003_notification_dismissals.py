"""add notification_dismissals to tenant schema

Per-user dismissal of org-shared notifications. Notifications carry no
``user_id`` (the schema name is the org), so dismissal — like read state —
is tracked per user. Mirrors ``notification_reads`` exactly: composite PK
``(notification_id, user_id)`` with CASCADE on both FKs. Lets a user hide a
notification from their own feed without hard-deleting the row the rest of
the org still sees.

Idempotent on purpose. The squashed 0001 baseline runs
``Base.metadata.create_all`` over the *current* models, and importing the
notification model module registers ``NotificationDismissal`` with the
metadata — so a freshly provisioned schema already has this table. The
``has_table`` guard makes this increment a no-op there and only does work on
schemas provisioned before the model existed. Same defensive spirit as 0001's
``CREATE INDEX IF NOT EXISTS`` statements.

Runs once per tenant schema (BIMSTITCH_TENANT_SCHEMA); the tenant env sets the
search_path inside Alembic's transaction.

Revision ID: 0003_notification_dismissals
Revises: 0002_findings_linked_model_id
Create Date: 2026-05-31
"""

from __future__ import annotations

import os
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect
from sqlalchemy.dialects.postgresql import UUID

# Revision identifiers, used by Alembic.
revision: str = "0003_notification_dismissals"
down_revision: Union[str, None] = "0002_findings_linked_model_id"
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
    if inspect(bind).has_table("notification_dismissals", schema=schema):
        return
    op.create_table(
        "notification_dismissals",
        sa.Column("notification_id", UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", UUID(as_uuid=True), nullable=False),
        sa.Column(
            "dismissed_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        # Same-schema FK; CASCADE so dismissals vanish with their notification.
        sa.ForeignKeyConstraint(
            ["notification_id"],
            [f"{schema}.notifications.id"],
            ondelete="CASCADE",
        ),
        # Cross-schema FK to the shared users table (resolves regardless of
        # search_path), mirroring how 0001 emits master-table FKs.
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["public.users.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("notification_id", "user_id"),
        schema=schema,
    )


def downgrade() -> None:
    schema = _schema()
    bind = op.get_bind()
    if inspect(bind).has_table("notification_dismissals", schema=schema):
        op.drop_table("notification_dismissals", schema=schema)
