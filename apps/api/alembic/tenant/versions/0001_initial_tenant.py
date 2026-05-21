"""Initial tenant schema.

Creates all tenant-side tables via Base.metadata.create_all(), then adds
partial unique indexes that aren't expressible in model __table_args__.

Runs against the schema named in BIMSTITCH_TENANT_SCHEMA. FKs to master
tables (users) are emitted as `public.users(id)` so they resolve
regardless of search_path.

Revision ID: 0001_tenant
Revises:
Create Date: 2026-05-19
"""

from __future__ import annotations

import os
from typing import Sequence, Union

from alembic import op
from sqlalchemy import text

revision: str = "0001_tenant"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _schema() -> str:
    schema = os.environ.get("BIMSTITCH_TENANT_SCHEMA")
    if not schema:
        raise RuntimeError("BIMSTITCH_TENANT_SCHEMA is required for tenant migrations")
    return schema


def upgrade() -> None:
    from bimstitch_api.db import Base, is_tenant_table
    from bimstitch_api.models import (  # noqa: F401
        AccessRequest,
        AuditLog,
        Borgingsmoment,
        Borgingsplan,
        ChecklistItem,
        ChecklistItemResult,
        Contractor,
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
    tenant_tables = [t for t in Base.metadata.tables.values() if is_tenant_table(t)]
    Base.metadata.create_all(bind, tables=tenant_tables)

    schema = _schema()
    bind.execute(
        text(
            f'CREATE UNIQUE INDEX IF NOT EXISTS ux_borgingsplans_one_active '
            f'ON "{schema}".borgingsplans(project_id) '
            f"WHERE status IN ('draft', 'published')"
        )
    )


def downgrade() -> None:
    from bimstitch_api.db import Base, is_tenant_table
    from bimstitch_api.models import (  # noqa: F401
        AccessRequest,
        AuditLog,
        Borgingsmoment,
        Borgingsplan,
        ChecklistItem,
        ChecklistItemResult,
        Contractor,
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
    schema = _schema()
    bind.execute(text(f'DROP INDEX IF EXISTS "{schema}".ux_borgingsplans_one_active'))
    tenant_tables = [t for t in Base.metadata.tables.values() if is_tenant_table(t)]
    Base.metadata.drop_all(bind, tables=tenant_tables)
    for enum in (
        "borgingsmomentphase",
        "borgingsmomentstatus",
        "borgingsplanstatus",
        "checklistitemtype",
        "evidencetype",
        "extractionstatus",
        "filetype",
        "ifcschema",
        "inspectionverdict",
        "jobstatus",
        "jobtype",
        "modeldiscipline",
        "modelstatus",
        "notificationeventtype",
        "projectfilestatus",
        "projectlifecyclestate",
        "projectphase",
        "projectrole",
        "projectstatus",
        "reportstatus",
        "reporttype",
        "riskcategory",
        "risklevel",
        "buildingtype",
        "consequenceclass",
    ):
        bind.execute(text(f'DROP TYPE IF EXISTS "{schema}".{enum}'))
