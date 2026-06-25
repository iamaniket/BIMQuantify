"""Initial master schema: users, organizations, organization_members,
access_requests, blog_posts, blog_post_tags.

Creates the identity layer in the `public` schema via `Base.metadata.create_all`
over the live models — anything the master-side models declare lands here. Tenant
tables (projects, jobs, audit_log, etc.) are NOT created here — they live in
per-org schemas managed by the tenant chain. The former 0002 (users.locale) and
0003 (blog_posts) deltas were folded in here; blog tags are normalized into the
`blog_post_tags` table (no JSONB).

A later squash folded in the former 0002 (organizations.active_storage_limit_gb)
and 0003 (users.tokens_valid_after, the per-user token epoch / sign-out-everywhere
column) deltas. Because the upgrade is driven by `create_all` over the live
models, those columns are emitted automatically — there was nothing to add here
beyond deleting the now-redundant delta revisions.

Revision ID: 0001_master
Revises:
Create Date: 2026-06-02
"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op

# Revision identifiers, used by Alembic.
revision: str = "0001_master"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    from bimdossier_api._rls_sql import (
        create_app_role_statements,
        enable_rls_statements,
    )
    from bimdossier_api.db import Base, is_master_table
    # Import every model so they register with Base.metadata, then filter
    # down to the master-side tables only.
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
        Job,
        Model,
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


def downgrade() -> None:
    from bimdossier_api._rls_sql import disable_rls_statements
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
        Job,
        Model,
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
