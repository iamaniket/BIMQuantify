"""add instrument_id to projects

WKB MVP backlog #10 — toegelaten instrument selection per project.

`instrument_id` is a free String(64) (not an enum) because the list
of valid instruments per jurisdiction (NL: TloKB register) changes
~twice a year and is hand-maintained in `jurisdictions/nl.py`. Server
validation (router._validate_instrument) rejects unregistered ids,
not a DB constraint — same pattern as Project.country.

Revision ID: e4a9c1b6f7d2
Revises: d3f8e9c1b2a4
Create Date: 2026-05-18 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "e4a9c1b6f7d2"
down_revision: str | None = "d3f8e9c1b2a4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "projects",
        sa.Column("instrument_id", sa.String(length=64), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("projects", "instrument_id")
