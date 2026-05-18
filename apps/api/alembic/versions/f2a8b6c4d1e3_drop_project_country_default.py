"""drop projects.country server_default so callers must supply a country

The schema-level NL default was a backward-compat shim from the jurisdiction
foundation migration (a1b2c3d4e5f6). Now that the API enforces an explicit
country in the request schema, the DB no longer needs the silent fallback —
keeping it would mask client bugs (a missing country slipping through as NL).

Column stays NOT NULL; only the server_default is removed.

Revision ID: f2a8b6c4d1e3
Revises: e4a9c1b6f7d2
Create Date: 2026-05-18 12:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "f2a8b6c4d1e3"
down_revision: str | None = "e4a9c1b6f7d2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.alter_column(
        "projects",
        "country",
        existing_type=sa.String(length=2),
        existing_nullable=False,
        server_default=None,
    )


def downgrade() -> None:
    op.alter_column(
        "projects",
        "country",
        existing_type=sa.String(length=2),
        existing_nullable=False,
        server_default="NL",
    )
