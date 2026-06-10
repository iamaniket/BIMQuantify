"""BCF topic model-version + dimension columns.

Adds two nullable/defaulted columns to ``bcf_topics`` so an issue records the
exact model *version* it was raised against and whether it is a 2D (drawing) or
3D (IFC) issue:

  * ``linked_file_id`` — FK → ``project_files.id`` (ON DELETE SET NULL). The
    specific ProjectFile version. Indexed (``ix_bcf_topics_linked_file_id``).
  * ``is_2d`` — boolean NOT NULL DEFAULT false. Topic-level dimension flag,
    denormalized from the viewpoint so the list endpoint can hard-filter by
    viewer type without joining viewpoints.

(``linked_model_id`` already exists from the baseline — this only adds the
version + dimension.)

Idempotent: each add is guarded on column existence so a fresh schema (where
``Base.metadata.create_all`` already declared the columns) no-ops cleanly; a
pre-existing schema gets only what's missing.

Revision ID: 0006_bcf_topic_version_dim
Revises: 0005_project_file_outline_key
Create Date: 2026-06-10

(Revision id kept ≤32 chars to fit ``alembic_version.version_num VARCHAR(32)``.)
"""

from __future__ import annotations

import os
from typing import TYPE_CHECKING

from alembic import op
from sqlalchemy import text

if TYPE_CHECKING:
    from collections.abc import Sequence

# Revision identifiers, used by Alembic.
revision: str = "0006_bcf_topic_version_dim"
down_revision: str | None = "0005_project_file_outline_key"
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


def _index_exists(bind, schema: str, index: str) -> bool:
    return (
        bind.execute(
            text(
                "SELECT 1 FROM pg_indexes "
                "WHERE schemaname = :s AND indexname = :i"
            ),
            {"s": schema, "i": index},
        ).scalar()
        is not None
    )


def upgrade() -> None:
    bind = op.get_bind()
    schema = _schema()

    if not _column_exists(bind, schema, "bcf_topics", "linked_file_id"):
        bind.execute(
            text(
                f'ALTER TABLE "{schema}".bcf_topics '
                f'ADD COLUMN linked_file_id uuid '
                f'REFERENCES "{schema}".project_files(id) ON DELETE SET NULL'
            )
        )

    if not _column_exists(bind, schema, "bcf_topics", "is_2d"):
        bind.execute(
            text(
                f'ALTER TABLE "{schema}".bcf_topics '
                "ADD COLUMN is_2d boolean NOT NULL DEFAULT false"
            )
        )

    if not _index_exists(bind, schema, "ix_bcf_topics_linked_file_id"):
        bind.execute(
            text(
                f'CREATE INDEX ix_bcf_topics_linked_file_id '
                f'ON "{schema}".bcf_topics (linked_file_id)'
            )
        )


def downgrade() -> None:
    bind = op.get_bind()
    schema = _schema()
    bind.execute(
        text(f'DROP INDEX IF EXISTS "{schema}".ix_bcf_topics_linked_file_id')
    )
    bind.execute(
        text(f'ALTER TABLE "{schema}".bcf_topics DROP COLUMN IF EXISTS is_2d')
    )
    bind.execute(
        text(f'ALTER TABLE "{schema}".bcf_topics DROP COLUMN IF EXISTS linked_file_id')
    )
