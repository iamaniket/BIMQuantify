"""Add checklist_item_results table for inspection verdicts.

Wkb MVP backlog #19: Mobile inspection screen. Each ChecklistItemResult
records a pass/fail/not_applicable verdict for one checklist item during
a borgingsmoment inspection. One result per item (UNIQUE constraint).

Revision ID: 0003_tenant
Revises: 0002_tenant
Create Date: 2026-05-21
"""

from __future__ import annotations

import os
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy import text
from sqlalchemy.dialects import postgresql

revision: str = "0003_tenant"
down_revision: Union[str, None] = "0002_tenant"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _schema() -> str:
    schema = os.environ.get("BIMSTITCH_TENANT_SCHEMA")
    if not schema:
        raise RuntimeError("BIMSTITCH_TENANT_SCHEMA is required for tenant migrations")
    return schema


def upgrade() -> None:
    schema = _schema()

    op.execute(
        "DO $$ BEGIN "
        "CREATE TYPE inspectionverdict AS ENUM ('pass', 'fail', 'not_applicable'); "
        "EXCEPTION WHEN duplicate_object THEN NULL; "
        "END $$;"
    )

    op.create_table(
        "checklist_item_results",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("checklist_item_id", sa.UUID(), nullable=False),
        sa.Column("borgingsmoment_id", sa.UUID(), nullable=False),
        sa.Column("project_id", sa.UUID(), nullable=False),
        sa.Column(
            "verdict",
            postgresql.ENUM(
                "pass", "fail", "not_applicable",
                name="inspectionverdict",
                create_type=False,
            ),
            nullable=False,
        ),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("inspector_user_id", sa.UUID(), nullable=False),
        sa.Column(
            "inspected_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("photo_ids", postgresql.JSONB(), nullable=True),
        sa.Column("voice_note_id", sa.UUID(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["checklist_item_id"], ["checklist_items.id"], ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["borgingsmoment_id"], ["borgingsmomenten.id"], ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["project_id"], ["projects.id"], ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["inspector_user_id"], ["public.users.id"], ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("checklist_item_id", name="uq_checklist_item_results_item"),
    )
    op.create_index(
        "ix_checklist_item_results_moment_id",
        "checklist_item_results",
        ["borgingsmoment_id"],
    )
    op.create_index(
        "ix_checklist_item_results_project_id",
        "checklist_item_results",
        ["project_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_checklist_item_results_project_id", table_name="checklist_item_results")
    op.drop_index("ix_checklist_item_results_moment_id", table_name="checklist_item_results")
    op.drop_table("checklist_item_results")
    op.execute("DROP TYPE IF EXISTS inspectionverdict;")
