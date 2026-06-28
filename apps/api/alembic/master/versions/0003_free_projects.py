"""Free-tier pooled `free_projects` + snag-status widening (master/`public`).

Lets a free (org-less) user group their pooled `free_models` under a pooled
`free_projects` row (still in `public`, owner-keyed RLS — never an `org_<hex>`
tenant schema, so NO `migrate_all` fan-out). Also widens `free_snags.status` to
the five `FindingStatus` values so the paid snag board is reused verbatim and
conversion maps 1:1.

Idempotent on purpose: on a fresh deploy, 0002 (now forward-safe) already
created `free_projects`, the `free_models.free_project_id` column, and the wide
snag-status shape from the live models — so every statement here guards with
`IF [NOT] EXISTS` / `checkfirst` and becomes a no-op. On an already-migrated dev
DB (old 0002), this carries the real delta.

Revision ID: 0003_free_projects
Revises: 0002_free_tier
Create Date: 2026-06-28
"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op

revision: str = "0003_free_projects"
down_revision: Union[str, None] = "0002_free_tier"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    from bimdossier_api._rls_sql import APP_ROLE, enable_free_tier_rls_statements
    from bimdossier_api.db import Base
    from bimdossier_api.models.free_project import FreeProject

    bind = op.get_bind()
    # checkfirst → skip on a fresh DB where 0002 already created it.
    Base.metadata.create_all(bind, tables=[FreeProject.__table__], checkfirst=True)

    op.execute(
        f"GRANT SELECT, INSERT, UPDATE, DELETE ON public.free_projects TO {APP_ROLE};"
    )

    # free_models.free_project_id (+ FK + index). Guarded so the fresh path
    # (where create_all already added all three from the live model) is a no-op.
    op.execute("ALTER TABLE public.free_models ADD COLUMN IF NOT EXISTS free_project_id uuid;")
    op.execute(
        """
        DO $$ BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint c
            WHERE c.conrelid = 'public.free_models'::regclass
              AND c.contype = 'f'
              AND c.confrelid = 'public.free_projects'::regclass
          ) THEN
            ALTER TABLE public.free_models
              ADD CONSTRAINT free_models_free_project_id_fkey
              FOREIGN KEY (free_project_id)
              REFERENCES public.free_projects(id) ON DELETE SET NULL;
          END IF;
        END $$;
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_free_models_free_project "
        "ON public.free_models (free_project_id);"
    )

    # free_snags.status: widen to fit 'in_progress' (11 chars) and adopt the five
    # FindingStatus values so the board UI + conversion map 1:1.
    op.execute("ALTER TABLE public.free_snags ALTER COLUMN status TYPE VARCHAR(16);")
    op.execute("ALTER TABLE public.free_snags DROP CONSTRAINT IF EXISTS ck_free_snags_status;")
    op.execute(
        "ALTER TABLE public.free_snags ADD CONSTRAINT ck_free_snags_status "
        "CHECK (status IN ('draft', 'open', 'in_progress', 'resolved', 'verified'));"
    )

    for stmt in enable_free_tier_rls_statements(("free_projects",)):
        op.execute(stmt)


def downgrade() -> None:
    from bimdossier_api._rls_sql import disable_free_tier_rls_statements
    from bimdossier_api.db import Base
    from bimdossier_api.models.free_project import FreeProject

    bind = op.get_bind()
    for stmt in disable_free_tier_rls_statements(("free_projects",)):
        op.execute(f"DO $$ BEGIN {stmt} EXCEPTION WHEN others THEN NULL; END $$;")

    op.execute("ALTER TABLE public.free_snags DROP CONSTRAINT IF EXISTS ck_free_snags_status;")
    # Best-effort revert of the value set (cannot re-narrow the column type if
    # rows already hold 'in_progress').
    op.execute(
        "ALTER TABLE public.free_snags ADD CONSTRAINT ck_free_snags_status "
        "CHECK (status IN ('open', 'closed'));"
    )
    op.execute("DROP INDEX IF EXISTS public.ix_free_models_free_project;")
    op.execute(
        "ALTER TABLE public.free_models "
        "DROP CONSTRAINT IF EXISTS free_models_free_project_id_fkey;"
    )
    op.execute("ALTER TABLE public.free_models DROP COLUMN IF EXISTS free_project_id;")
    Base.metadata.drop_all(bind, tables=[FreeProject.__table__])
