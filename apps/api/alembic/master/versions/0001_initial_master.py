"""Initial master schema — the single baseline for the master chain.

Creates the entire `public` schema via `Base.metadata.create_all` over the live
master-side models — anything the models declare lands here, so the schema follows
the models with no per-column DDL. This covers both the identity layer (users,
organizations, organization_members, access_requests, blog_posts, blog_post_tags)
AND the pooled free-tier surface (pooled_projects, pooled_documents, pooled_project_files,
pooled_project_members, pooled_findings, pooled_levels, pooled_aligned_sheets,
pooled_notifications, pooled_notification_user_state, pooled_attachments,
pooled_finding_attachments). Tenant tables (projects, jobs, audit_log, etc.) are NOT
created here — they live in per-org schemas managed by the tenant chain.

The handful of things create_all cannot express are applied in upgrade() below:
the partial-unique lower(work_email) dedup on active access-requests; the app role
+ identity RLS; the explicit DML grants on the free tables; and the free-tier RLS
(owner-OR-member policies + SECURITY DEFINER helpers, recipient-scoped notification
policies). The owner-only `enable_free_tier_rls_statements` is deliberately NOT
used — the final state is the member-aware policy set.

This baseline folds the former free-tier delta chain (0002_free_tier …
0013_pooled_attachments) back into one revision; the schema it produces is identical.

Revision ID: 0001_master
Revises:
Create Date: 2026-06-02
"""

from __future__ import annotations

from alembic import op

# Revision identifiers, used by Alembic.
revision: str = "0001_master"
down_revision: str | None = None
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None


def upgrade() -> None:
    from bimdossier_api._rls_sql import (
        create_app_role_statements,
        enable_pooled_aligned_sheet_rls_statements,
        enable_pooled_attachment_rls_statements,
        enable_pooled_level_rls_statements,
        enable_pooled_member_rls_statements,
        enable_pooled_notification_rls_statements,
        enable_rls_statements,
        grant_pooled_tables_to_app_role,
    )
    from bimdossier_api.db import Base, is_master_table

    # Import every model so they register with Base.metadata, then filter
    # down to the master-side tables only. The explicit names are documentation —
    # the `bimdossier_api.models` package __init__ imports all of them, so the
    # free-tier tables register (and so create_all emits them) regardless.
    from bimdossier_api.models import (  # noqa: F401
        AccessRequest,
        AuditLog,
        BlogPost,
        BlogPostTag,
        Borgingsmoment,
        Borgingsplan,
        ChecklistItem,
        ChecklistItemResult,
        Deadline,
        Document,
        PooledAlignedSheet,
        PooledAttachment,
        PooledDocument,
        PooledFinding,
        PooledFindingAttachment,
        PooledLevel,
        PooledNotification,
        PooledNotificationUserState,
        PooledProject,
        PooledProjectFile,
        PooledProjectMember,
        Job,
        Notification,
        NotificationUserState,
        Organization,
        OrganizationMember,
        Project,
        ProjectFile,
        ProjectMember,
        Report,
        Risk,
        User,
    )

    bind = op.get_bind()
    master_tables = [t for t in Base.metadata.tables.values() if is_master_table(t)]
    Base.metadata.create_all(bind, tables=master_tables)

    # Partial unique index that dedups active access-requests by email. The
    # filter excludes `rejected` rows so a previously-rejected applicant can
    # retry. The expression can't be declared in __table_args__ (lower() +
    # postgresql_where is awkward), so we create it as raw SQL after the
    # tables exist. Mirrored in tests/conftest.py for the create_all-based
    # test bootstrap.
    op.execute(
        """
        CREATE UNIQUE INDEX ux_access_requests_active_email
        ON public.access_requests (lower(work_email))
        WHERE status IN ('new', 'approved')
        """
    )

    for stmt in create_app_role_statements():
        op.execute(stmt)
    for stmt in enable_rls_statements():
        op.execute(stmt)

    # Free-tier surface (folds in former deltas 0002…0013). create_app_role only
    # grants the identity tables, so the pooled free tables need explicit DML
    # grants; then the member-aware owner-OR-member RLS (which creates the
    # SECURITY DEFINER helpers), the level / aligned-sheet / attachment policies
    # that reuse those helpers, and the recipient-scoped notification policies.
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
    from bimdossier_api._rls_sql import (
        disable_pooled_aligned_sheet_rls_statements,
        disable_pooled_attachment_rls_statements,
        disable_pooled_level_rls_statements,
        disable_pooled_member_rls_statements,
        disable_pooled_notification_rls_statements,
        disable_rls_statements,
    )
    from bimdossier_api.db import Base, is_master_table
    from bimdossier_api.models import (  # noqa: F401
        AccessRequest,
        AuditLog,
        BlogPost,
        BlogPostTag,
        Borgingsmoment,
        Borgingsplan,
        ChecklistItem,
        ChecklistItemResult,
        Deadline,
        Document,
        PooledAlignedSheet,
        PooledAttachment,
        PooledDocument,
        PooledFinding,
        PooledFindingAttachment,
        PooledLevel,
        PooledNotification,
        PooledNotificationUserState,
        PooledProject,
        PooledProjectFile,
        PooledProjectMember,
        Job,
        Notification,
        NotificationUserState,
        Organization,
        OrganizationMember,
        Project,
        ProjectFile,
        ProjectMember,
        Report,
        Risk,
        User,
    )

    bind = op.get_bind()
    # Reverse the free-tier setup first (policies + SECURITY DEFINER helpers),
    # then the identity RLS, then drop every master table.
    for stmt in disable_pooled_attachment_rls_statements():
        op.execute(stmt)
    for stmt in disable_pooled_notification_rls_statements():
        op.execute(stmt)
    for stmt in disable_pooled_aligned_sheet_rls_statements():
        op.execute(stmt)
    for stmt in disable_pooled_level_rls_statements():
        op.execute(stmt)
    for stmt in disable_pooled_member_rls_statements():
        op.execute(stmt)
    for stmt in disable_rls_statements():
        op.execute(stmt)
    master_tables = [t for t in Base.metadata.tables.values() if is_master_table(t)]
    Base.metadata.drop_all(bind, tables=master_tables)

    # Enum types are dropped explicitly because drop_all leaves them behind.
    for enum in (
        "organizationmemberstatus",
        "organizationstatus",
        "accessrequeststatus",
        "blogpoststatus",
    ):
        op.execute(f"DROP TYPE IF EXISTS {enum}")
