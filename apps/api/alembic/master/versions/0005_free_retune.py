"""Free-tier generosity retune: lifetime findings counter + overrides + idle warning.

A forward delta on top of `0004_rename_pooled`. Three pieces:

1. `public.pooled_finding_counters` — the monotonic per-owner record the LIFETIME
   findings cap is enforced against (pooled findings are hard-deleted, so a live
   COUNT(*) would let create→delete cycling reclaim quota). DATA-PLANE: bim_app
   gets DML + an owner-OR-co-participant RLS policy (a member files snags into
   the owner's quota). BACKFILL seeds each owner's counter from their current
   live count — findings deleted before this deploy are amnestied (one-time, in
   users' favor; the cap simultaneously rises 200 → 2000).
2. `free_user_limits.max_findings` — per-user override for the findings cap
   (control-plane column; the table keeps its deliberate no-bim_app posture).
3. `pooled_documents.idle_warning_sent_at` — one-time "idle models will be
   deleted" warning stamp for the 90-day idle reaper.

Idempotent (`IF NOT EXISTS`) like 0002: the squashed baseline builds fresh DBs
via `create_all`, so on a fresh DB this is a no-op apart from RLS/grants.

Revision ID: 0005_free_retune
Revises: 0004_rename_pooled
Create Date: 2026-07-02
"""

from __future__ import annotations

from alembic import op

from bimdossier_api._rls_sql import (
    disable_pooled_finding_counter_rls_statements,
    enable_pooled_finding_counter_rls_statements,
)

# Revision identifiers, used by Alembic.
revision: str = "0005_free_retune"
down_revision: str | None = "0004_rename_pooled"
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS public.pooled_finding_counters (
            owner_user_id uuid PRIMARY KEY
                REFERENCES public.users(id) ON DELETE CASCADE,
            lifetime_created bigint NOT NULL DEFAULT 0,
            updated_at timestamptz NOT NULL DEFAULT now()
        )
        """
    )
    # Data-plane: unlike free_user_limits, the pooled bim_app session upserts
    # this on every snag create (see grant_pooled_tables_to_app_role — the table
    # is in POOLED_DML_TABLES for fresh DBs; this covers forward-migrated ones).
    op.execute(
        "GRANT SELECT, INSERT, UPDATE, DELETE ON public.pooled_finding_counters TO bim_app"
    )
    for stmt in enable_pooled_finding_counter_rls_statements():
        op.execute(stmt)
    # Backfill from live counts. GREATEST keeps a re-run (or a fresh-DB row that
    # already accumulated creates) from ever lowering the counter.
    op.execute(
        """
        INSERT INTO public.pooled_finding_counters (owner_user_id, lifetime_created)
        SELECT owner_user_id, count(*)
        FROM public.pooled_findings
        GROUP BY owner_user_id
        ON CONFLICT (owner_user_id) DO UPDATE
            SET lifetime_created = GREATEST(
                public.pooled_finding_counters.lifetime_created,
                EXCLUDED.lifetime_created
            )
        """
    )
    op.execute(
        "ALTER TABLE public.free_user_limits ADD COLUMN IF NOT EXISTS max_findings integer"
    )
    # Re-assert the control-plane boundary while touching the table: bim_app must
    # have NO grant on free_user_limits (0002's REVOKE never executed on a DB
    # squash-stamped past it, leaving the ALTER-DEFAULT-PRIVILEGES auto-grant).
    op.execute("REVOKE ALL ON public.free_user_limits FROM bim_app")
    op.execute(
        "ALTER TABLE public.pooled_documents"
        " ADD COLUMN IF NOT EXISTS idle_warning_sent_at timestamptz"
    )


def downgrade() -> None:
    op.execute(
        "ALTER TABLE public.pooled_documents DROP COLUMN IF EXISTS idle_warning_sent_at"
    )
    op.execute(
        "ALTER TABLE public.free_user_limits DROP COLUMN IF EXISTS max_findings"
    )
    for stmt in disable_pooled_finding_counter_rls_statements():
        op.execute(stmt)
    op.execute("DROP TABLE IF EXISTS public.pooled_finding_counters")
