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
    # Idempotent: on fresh DBs the prior `0001_master` runs `create_all` from
    # the current models, which already creates `public.users.locale`. On
    # older DBs the column genuinely doesn't exist and we add it here.
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing = {col["name"] for col in inspector.get_columns("users", schema="public")}
    if "locale" in existing:
        return
    op.add_column(
        "users",
        sa.Column("locale", sa.String(length=8), nullable=True),
        schema="public",
    )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing = {col["name"] for col in inspector.get_columns("users", schema="public")}
    if "locale" not in existing:
        return
    op.drop_column("users", "locale", schema="public")
