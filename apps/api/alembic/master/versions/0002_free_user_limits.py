"""Per-user free-tier limit overrides — `public.free_user_limits`.

A forward delta on top of the squashed `0001_master` baseline. The baseline builds
the schema from the live models via `create_all`, so on a FRESH database the
`free_user_limits` table is already created the moment its model is registered —
hence this migration is written idempotently (`IF NOT EXISTS`): it is a no-op on a
fresh DB and actually creates the table on a DB previously stamped at `0001_master`
(and in production). No RLS / no `bim_app` grant: this is control-plane data that
only super-admin (RLS-bypassing) sessions ever read or write.

Revision ID: 0002_free_user_limits
Revises: 0001_master
Create Date: 2026-06-29
"""

from __future__ import annotations

from alembic import op

# Revision identifiers, used by Alembic.
revision: str = "0002_free_user_limits"
down_revision: str | None = "0001_master"
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS public.free_user_limits (
            user_id uuid PRIMARY KEY
                REFERENCES public.users(id) ON DELETE CASCADE,
            max_projects integer,
            max_members_per_project integer,
            max_documents integer,
            storage_max_bytes bigint,
            account_max_age_days integer,
            expiry_exempt boolean NOT NULL DEFAULT false,
            updated_at timestamptz NOT NULL DEFAULT now(),
            updated_by_user_id uuid
                REFERENCES public.users(id) ON DELETE SET NULL
        )
        """
    )
    # Control-plane isolation is "bim_app has no grant on this table" — but absence
    # of a GRANT is unreliable: `create_app_role_statements()`'s ALTER DEFAULT
    # PRIVILEGES (run in 0001) auto-grants DML on any table created AFTER it by the
    # same role, which would catch this table on a DB previously stamped at a
    # pre-`free_user_limits` 0001 then forward-migrated. Assert the boundary with an
    # explicit REVOKE rather than relying on the table having pre-existed the ALTER.
    # No-op on a fresh DB (create_all built the table before the ALTER, so no grant
    # exists to revoke); load-bearing on the legacy-stamp path.
    op.execute("REVOKE ALL ON public.free_user_limits FROM bim_app")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS public.free_user_limits")
