"""Initial master schema: users, organizations, organization_members, access_requests.

Creates the identity layer in the `public` schema. Tenant tables (projects, jobs,
audit_log, etc.) are NOT created here — they live in per-org schemas managed by
the tenant chain.

Revision ID: 0001_master
Revises:
Create Date: 2026-05-19
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
    from bimstitch_api._rls_sql import (
        create_app_role_statements,
        enable_rls_statements,
    )
    from bimstitch_api.db import Base, is_master_table
    # Import every model so they register with Base.metadata, then filter
    # down to the master-side tables only.
    from bimstitch_api.models import (  # noqa: F401
        AccessRequest,
        AuditLog,
        Borgingsmoment,
        Borgingsplan,
        ChecklistItem,
        ChecklistItemResult,
        Contractor,
        Deadline,
        Job,
        Model,
        Notification,
        NotificationRead,
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

    for stmt in create_app_role_statements():
        op.execute(stmt)
    for stmt in enable_rls_statements():
        op.execute(stmt)


def downgrade() -> None:
    from bimstitch_api._rls_sql import disable_rls_statements
    from bimstitch_api.db import Base, is_master_table
    from bimstitch_api.models import (  # noqa: F401
        AccessRequest,
        AuditLog,
        Borgingsmoment,
        Borgingsplan,
        ChecklistItem,
        ChecklistItemResult,
        Contractor,
        Deadline,
        Job,
        Model,
        Notification,
        NotificationRead,
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
    ):
        op.execute(f"DROP TYPE IF EXISTS {enum}")
