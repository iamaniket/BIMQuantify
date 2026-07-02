"""Free-tier snag-list PDF reports — `public.pooled_reports`.

A forward delta on `0005_free_retune`. The pooled mirror of the tenant `Report`
row (reports are tenant-only; free users have no schema), used by the free
snag-list PDF export: create → detached Job dispatch → processor renders via the
existing snag-list pipeline → `/internal/jobs/pooled-report-callback` stamps the
row ready. Owner-OR-member RLS (mirrors pooled_attachments); explicit bim_app
grant (create_app_role_statements' ALTER DEFAULT PRIVILEGES doesn't reach tables
create_all already made on fresh DBs, and forward-migrated DBs need it anyway).

Idempotent (`IF NOT EXISTS`) like 0002/0005. Master chain only — no
`migrate_all` fan-out (public table).

Revision ID: 0006_pooled_reports
Revises: 0005_free_retune
Create Date: 2026-07-02
"""

from __future__ import annotations

from alembic import op

from bimdossier_api._rls_sql import (
    disable_pooled_report_rls_statements,
    enable_pooled_report_rls_statements,
)

# Revision identifiers, used by Alembic.
revision: str = "0006_pooled_reports"
down_revision: str | None = "0005_free_retune"
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS public.pooled_reports (
            id uuid PRIMARY KEY,
            owner_user_id uuid NOT NULL
                REFERENCES public.users(id) ON DELETE CASCADE,
            pooled_project_id uuid NOT NULL
                REFERENCES public.pooled_projects(id) ON DELETE CASCADE,
            created_by_user_id uuid
                REFERENCES public.users(id) ON DELETE SET NULL,
            report_type varchar(32) NOT NULL DEFAULT 'snag_list'
                CONSTRAINT ck_pooled_reports_report_type
                CHECK (report_type IN ('snag_list')),
            status varchar(16) NOT NULL DEFAULT 'queued'
                CONSTRAINT ck_pooled_reports_status
                CHECK (status IN ('queued', 'running', 'ready', 'failed')),
            job_id uuid,
            storage_key text,
            byte_size bigint,
            sha256 varchar(64),
            title varchar(255) NOT NULL,
            locale varchar(8) NOT NULL,
            params jsonb NOT NULL DEFAULT '{}'::jsonb,
            error text,
            finished_at timestamptz,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_pooled_reports_project_created "
        "ON public.pooled_reports (pooled_project_id, created_at DESC)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_pooled_reports_owner "
        "ON public.pooled_reports (owner_user_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_pooled_reports_status "
        "ON public.pooled_reports (status)"
    )
    op.execute(
        "GRANT SELECT, INSERT, UPDATE, DELETE ON public.pooled_reports TO bim_app"
    )
    for stmt in enable_pooled_report_rls_statements():
        op.execute(stmt)


def downgrade() -> None:
    for stmt in disable_pooled_report_rls_statements():
        op.execute(stmt)
    op.execute("DROP TABLE IF EXISTS public.pooled_reports")
