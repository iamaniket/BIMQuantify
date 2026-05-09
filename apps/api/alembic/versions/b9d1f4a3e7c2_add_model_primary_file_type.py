"""add primary_file_type to models

Revision ID: b9d1f4a3e7c2
Revises: cada7e3b831b
Create Date: 2026-05-09 12:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "b9d1f4a3e7c2"
down_revision: str | None = "cada7e3b831b"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "models",
        sa.Column(
            "primary_file_type",
            postgresql.ENUM("ifc", "pdf", name="filetype", create_type=False),
            nullable=True,
        ),
    )

    # Backfill from the earliest ready project_files row per model.
    op.execute(
        """
        UPDATE models
        SET primary_file_type = sub.file_type
        FROM (
            SELECT DISTINCT ON (model_id) model_id, file_type
            FROM project_files
            WHERE status = 'ready'
            ORDER BY model_id, version_number ASC
        ) AS sub
        WHERE models.id = sub.model_id
          AND models.primary_file_type IS NULL;
        """
    )


def downgrade() -> None:
    op.drop_column("models", "primary_file_type")
