"""Add users.locale column for per-user language preference.

Nullable on purpose — NULL means "use platform default" (currently "nl",
defined in `bimstitch_api.i18n.PLATFORM_DEFAULT_LOCALE`). The resolver
in `bimstitch_api.i18n.resolution.resolve_user_locale` returns the
platform default when the column is NULL, so no backfill is needed.

New users created by admin invite land with NULL; they can set their
preference later via a profile-update endpoint.

Revision ID: 0002_user_locale
Revises: 0001_master
Create Date: 2026-06-02
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# Revision identifiers, used by Alembic.
revision: str = "0002_user_locale"
down_revision: Union[str, None] = "0001_master"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("locale", sa.String(length=8), nullable=True),
        schema="public",
    )


def downgrade() -> None:
    op.drop_column("users", "locale", schema="public")
