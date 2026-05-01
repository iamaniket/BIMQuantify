"""Add latitude/longitude columns to projects.

Revision ID: 0007_project_coordinates
Revises: 0006_enrich_projects
Create Date: 2026-05-01

WGS84 (EPSG:4326) site coordinates. Populated from PDOK Locatieserver lookup
so the portal can render a free PDOK aerial thumbnail without needing a
user-uploaded image.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0007_project_coordinates"
down_revision: str | None = "0006_enrich_projects"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("projects", sa.Column("latitude", sa.Float(), nullable=True))
    op.add_column("projects", sa.Column("longitude", sa.Float(), nullable=True))


def downgrade() -> None:
    op.drop_column("projects", "longitude")
    op.drop_column("projects", "latitude")
