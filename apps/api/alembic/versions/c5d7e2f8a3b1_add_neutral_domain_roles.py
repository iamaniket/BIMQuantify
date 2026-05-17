"""add neutral domain roles to projectrole enum

Extends the Postgres `projectrole` enum with three jurisdiction-neutral
domain roles (inspector, contractor, client) defined in
wkb_mvp_backlog.csv #7. The values are deliberately language-neutral codes
so non-NL projects (DE/BE/FR roadmap) can reuse the same enum and render
locale-specific labels via the portal i18n catalog.

Semantic mapping for the NL/WKB market:
  - inspector  -> kwaliteitsborger (sole signing authority on the
                  completion_declaration)
  - contractor -> aannemer
  - client     -> opdrachtgever

The enum value used by existing rows (owner/editor/viewer) is unchanged,
so no data backfill is required.

`ALTER TYPE ... ADD VALUE` cannot run inside a transaction block in
older Postgres versions; Postgres 16 (our docker-compose target) accepts
it inline. We use IF NOT EXISTS for idempotency.

Downgrade is a no-op: Postgres does not support `ALTER TYPE ... DROP VALUE`
without rewriting every table that uses the enum, and there is no value
in attempting that here. If a true rollback is ever needed, manually
follow the swap-enum dance documented in the Postgres manual.

Revision ID: c5d7e2f8a3b1
Revises: a1b2c3d4e5f6
Create Date: 2026-05-13 14:00:00.000000
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c5d7e2f8a3b1"
down_revision: str | None = "a1b2c3d4e5f6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("ALTER TYPE projectrole ADD VALUE IF NOT EXISTS 'inspector';")
    op.execute("ALTER TYPE projectrole ADD VALUE IF NOT EXISTS 'contractor';")
    op.execute("ALTER TYPE projectrole ADD VALUE IF NOT EXISTS 'client';")


def downgrade() -> None:
    # See module docstring: Postgres has no `ALTER TYPE ... DROP VALUE`.
    pass
