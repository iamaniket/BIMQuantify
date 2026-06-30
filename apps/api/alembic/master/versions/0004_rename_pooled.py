"""Rename the pooled free-tier surface ``free_*`` → ``pooled_*`` (isolation rename).

The pooled data plane was named with a ``free_`` prefix that conflated ISOLATION
(the pooled-in-``public`` data plane) with TIER (the free plan, now modeled
explicitly via ``organizations.plan`` / entitlements). The models, ``_rls_sql``
generators and the squashed ``0001_initial_master`` baseline were already updated
to emit ``pooled_*``; this delta transitions an EXISTING database (one stamped at
``0003`` whose physical tables are still ``free_*``) to match — preserving every
row (``ALTER … RENAME``, never drop/recreate).

**Idempotent + guarded so it is safe on BOTH starting points:**

* FRESH DB — ``0001`` already built ``pooled_*`` (+ pooled RLS). Here the
  ``free_*`` tables do not exist, so every ``to_regclass`` guard is false and the
  ``%free%`` introspection loops match nothing → the structural block is a no-op.
  The RLS recreate runs ``CREATE OR REPLACE`` / ``DROP POLICY IF EXISTS`` and so
  re-asserts the identical pooled policies (net no-op).
* EXISTING DB (stamped ``≤0003`` with ``free_*``) — the real rename runs.

These are MASTER (``public``) tables, NOT tenant tables, so there is **no
``migrate_all`` fan-out** — this delta runs once against ``public``.

``downgrade`` reverses the STRUCTURAL renames (``pooled_*`` → ``free_*``) only; it
does NOT recreate the old ``free_*``-named RLS (those generators no longer exist in
``_rls_sql``). It is an escape hatch for reverting the whole deploy — the prior
code revision's ``0001`` owns RLS in that world. ``up → down → up`` therefore
round-trips cleanly (the final ``up`` re-asserts the pooled RLS).

Revision ID: 0004_rename_pooled
Revises: 0003_organization_plan
Create Date: 2026-06-30
"""

from __future__ import annotations

from alembic import op

# Revision identifiers, used by Alembic.
revision: str = "0004_rename_pooled"
down_revision: str | None = "0003_organization_plan"
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None

# The 11 pooled data tables (free_user_limits is the ENTITLEMENT control-plane
# table and deliberately KEEPS its `free_` name — it is NOT in this list).
_POOLED_TABLES: tuple[str, ...] = (
    "projects",
    "documents",
    "project_files",
    "project_members",
    "findings",
    "levels",
    "aligned_sheets",
    "notifications",
    "notification_user_state",
    "attachments",
    "finding_attachments",
)


def _rename_tables_sql(src_prefix: str, dst_prefix: str) -> str:
    """Guarded ``ALTER TABLE IF-exists RENAME`` for each of the 11 pooled tables."""
    lines = []
    for stem in _POOLED_TABLES:
        src = f"{src_prefix}{stem}"
        dst = f"{dst_prefix}{stem}"
        lines.append(
            f"  IF to_regclass('public.{src}') IS NOT NULL THEN\n"
            f"    EXECUTE 'ALTER TABLE public.{src} RENAME TO {dst}';\n"
            f"  END IF;"
        )
    return "\n".join(lines)


def _structural_block(src: str, dst: str) -> str:
    """A single PL/pgSQL DO block that renames the pooled surface ``src_`` → ``dst_``.

    Order matters:
      1. Drop EVERY policy on the src_/dst_ tables + the 3 SECURITY-DEFINER helpers
         (both name variants) so nothing depends on the columns/tables being renamed
         and no stale policy survives the rename.
      2. Rename the 11 tables (guarded).
      3. Rename ``<src>_`` columns → ``<dst>_`` on the now-``<dst>_`` tables.
      4. Rename CONSTRAINTS (ck_/uq_/pk/fk) containing ``<src>`` → replace with
         ``<dst>`` — BEFORE pure indexes, because renaming a unique/PK constraint
         also renames its backing index (avoids a name clash with step 5).
      5. Rename pure INDEXES (ix_/unique Index()) containing ``<src>`` → ``<dst>``.
    """
    return f"""
DO $$
DECLARE
    r record;
BEGIN
    -- 1a. Drop all RLS policies on the pooled surface (either naming).
    FOR r IN
        SELECT schemaname, tablename, policyname
        FROM pg_policies
        WHERE schemaname = 'public'
          AND (tablename LIKE '{src}\\_%' OR tablename LIKE '{dst}\\_%')
          AND tablename <> 'free_user_limits'
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, r.tablename);
    END LOOP;

    -- 1b. Drop the 3 SECURITY-DEFINER helpers (both name variants).
    DROP FUNCTION IF EXISTS public.free_is_member(uuid, uuid);
    DROP FUNCTION IF EXISTS public.free_is_project_owner(uuid, uuid);
    DROP FUNCTION IF EXISTS public.free_document_project(uuid);
    DROP FUNCTION IF EXISTS public.pooled_is_member(uuid, uuid);
    DROP FUNCTION IF EXISTS public.pooled_is_project_owner(uuid, uuid);
    DROP FUNCTION IF EXISTS public.pooled_document_project(uuid);

    -- 2. Rename the 11 tables.
{_rename_tables_sql(f"{src}_", f"{dst}_")}

    -- 3. Rename `<src>_`-prefixed columns on the now-`<dst>_` tables.
    FOR r IN
        SELECT c.table_name, c.column_name
        FROM information_schema.columns c
        WHERE c.table_schema = 'public'
          AND c.table_name LIKE '{dst}\\_%'
          AND c.table_name <> 'free_user_limits'
          AND c.column_name LIKE '{src}\\_%'
    LOOP
        EXECUTE format(
            'ALTER TABLE public.%I RENAME COLUMN %I TO %I',
            r.table_name, r.column_name,
            regexp_replace(r.column_name, '^{src}_', '{dst}_')
        );
    END LOOP;

    -- 4. Rename CONSTRAINTS containing '{src}' (renames backing indexes too).
    FOR r IN
        SELECT rel.relname AS table_name, con.conname
        FROM pg_constraint con
        JOIN pg_class rel ON rel.oid = con.conrelid
        JOIN pg_namespace ns ON ns.oid = rel.relnamespace
        WHERE ns.nspname = 'public'
          AND rel.relname LIKE '{dst}\\_%'
          AND rel.relname <> 'free_user_limits'
          AND con.conname LIKE '%{src}%'
    LOOP
        EXECUTE format(
            'ALTER TABLE public.%I RENAME CONSTRAINT %I TO %I',
            r.table_name, r.conname, replace(r.conname, '{src}', '{dst}')
        );
    END LOOP;

    -- 5. Rename remaining pure INDEXES containing '{src}'.
    FOR r IN
        SELECT indexname
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND tablename LIKE '{dst}\\_%'
          AND tablename <> 'free_user_limits'
          AND indexname LIKE '%{src}%'
    LOOP
        EXECUTE format(
            'ALTER INDEX public.%I RENAME TO %I',
            r.indexname, replace(r.indexname, '{src}', '{dst}')
        );
    END LOOP;
END $$;
"""


def upgrade() -> None:
    # Structural rename free_* -> pooled_* (idempotent / guarded).
    op.execute(_structural_block("free", "pooled"))

    # Recreate the pooled RLS (functions + owner-OR-member / recipient policies +
    # grants) under the pooled names. CREATE OR REPLACE / DROP POLICY IF EXISTS make
    # this safe whether or not it already existed — so a fresh DB is a net no-op.
    from bimdossier_api._rls_sql import (
        enable_pooled_aligned_sheet_rls_statements,
        enable_pooled_attachment_rls_statements,
        enable_pooled_level_rls_statements,
        enable_pooled_member_rls_statements,
        enable_pooled_notification_rls_statements,
        grant_pooled_tables_to_app_role,
    )

    for stmt in grant_pooled_tables_to_app_role():
        op.execute(stmt)
    for stmt in enable_pooled_member_rls_statements():
        op.execute(stmt)
    for stmt in enable_pooled_level_rls_statements():
        op.execute(stmt)
    for stmt in enable_pooled_aligned_sheet_rls_statements():
        op.execute(stmt)
    for stmt in enable_pooled_notification_rls_statements():
        op.execute(stmt)
    for stmt in enable_pooled_attachment_rls_statements():
        op.execute(stmt)


def downgrade() -> None:
    # Structural reverse only (pooled_* -> free_*). RLS is left dropped on the
    # free_* tables — the old free_*-named generators no longer exist in code, and
    # a real rollback reverts the whole deploy (prior 0001 owns RLS). up→down→up
    # round-trips because the next upgrade() re-asserts the pooled RLS.
    op.execute(_structural_block("pooled", "free"))
