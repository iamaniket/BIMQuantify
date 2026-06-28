"""Initial tenant schema — the single baseline for the tenant chain.

The upgrade is driven by `Base.metadata.create_all` over the live tenant models
(enumerated in upgrade()'s import block), so anything the models declare — every
table, column, enum, and model-declared index (including expression / partial /
unique indexes via `Index(text(...), postgresql_where=...)`) — lands here
automatically. Only the handful of indexes the model layer cannot express are
created explicitly in upgrade() below.

The `audit_log` append-only guard (a REVOKE plus a BEFORE UPDATE/DELETE trigger)
is the one thing create_all does NOT express. It is applied per schema by the
provisioning saga / seed via `grant_schema_to_app_role`
(`audit_log_append_only_statements`), not by this baseline.

Runs against the schema named in BIMDOSSIER_TENANT_SCHEMA. FKs to master tables
(users) are emitted as `public.users(id)` so they resolve regardless of
search_path — audit_log's user_id / impersonator_user_id rely on this.

Revision ID: 0001_tenant
Revises:
Create Date: 2026-06-10
"""

from __future__ import annotations

import os
from typing import Sequence, Union

from alembic import op
from sqlalchemy import text

# Revision identifiers, used by Alembic.
revision: str = "0001_tenant"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _schema() -> str:
    schema = os.environ.get("BIMDOSSIER_TENANT_SCHEMA")
    if not schema:
        raise RuntimeError("BIMDOSSIER_TENANT_SCHEMA is required for tenant migrations")
    return schema


def upgrade() -> None:
    from bimdossier_api.db import Base, is_tenant_table

    # Importing the models package registers every tenant model with
    # Base.metadata (its __init__ imports all of them, incl. the BCF and
    # org-certificate tables). The explicit names below are documentation.
    from bimdossier_api.models import (  # noqa: F401
        AccessRequest,
        AlignedSheet,
        AuditLog,
        BcfComment,
        BcfTopic,
        BcfTopicLabel,
        BcfViewpoint,
        Borgingsmoment,
        Borgingsplan,
        CaptureLink,
        Certificate,
        ChecklistItem,
        ChecklistItemResult,
        ChecklistItemResultAttachment,
        Deadline,
        DeadlineNotificationLog,
        DeadlineNotificationSettings,
        Finding,
        FindingAttachment,
        Job,
        Level,
        Document,
        Notification,
        NotificationUserState,
        OrgCertificate,
        OrgCertificateTag,
        Organization,
        OrganizationMember,
        PdfPage,
        Project,
        ProjectFile,
        ProjectMember,
        Report,
        Risk,
        Storey,
        User,
    )

    bind = op.get_bind()
    tenant_tables = [t for t in Base.metadata.tables.values() if is_tenant_table(t)]
    Base.metadata.create_all(bind, tables=tenant_tables)

    schema = _schema()
    bind.execute(
        text(
            f"CREATE UNIQUE INDEX IF NOT EXISTS ux_borgingsplans_one_active "
            f'ON "{schema}".borgingsplans(project_id) '
            f"WHERE status IN ('draft', 'published')"
        )
    )
    bind.execute(
        text(
            f"CREATE INDEX IF NOT EXISTS ix_checklist_items_element_link "
            f'ON "{schema}".checklist_items (linked_file_id, linked_element_global_id) '
            f"WHERE linked_element_global_id IS NOT NULL"
        )
    )
    # One auto-draft finding per failed checklist item (the future #22 hook
    # relies on this). Partial so manually-created findings (null source) are
    # unconstrained.
    bind.execute(
        text(
            f"CREATE UNIQUE INDEX IF NOT EXISTS uq_findings_source_item "
            f'ON "{schema}".findings (source_checklist_item_id) '
            f"WHERE source_checklist_item_id IS NOT NULL"
        )
    )

    # Scaling indexes (formerly 0002). Expression/partial indexes the model's
    # create_all does not emit: the JSONB framework path that every compliance
    # lookup filters on, the soft-delete-aware findings feed sort, and the
    # unfiltered audit feed sort.
    bind.execute(
        text(
            f"CREATE INDEX IF NOT EXISTS ix_jobs_payload_framework "
            f"ON \"{schema}\".jobs ((payload ->> 'framework'))"
        )
    )
    bind.execute(
        text(
            f"CREATE INDEX IF NOT EXISTS ix_findings_project_created "
            f'ON "{schema}".findings (project_id, created_at DESC) '
            f"WHERE deleted_at IS NULL"
        )
    )
    bind.execute(
        text(
            f"CREATE INDEX IF NOT EXISTS ix_audit_created_at "
            f'ON "{schema}".audit_log (created_at DESC)'
        )
    )


def downgrade() -> None:
    from bimdossier_api.db import Base, is_tenant_table
    from bimdossier_api.models import (  # noqa: F401
        AccessRequest,
        AlignedSheet,
        AuditLog,
        BcfComment,
        BcfTopic,
        BcfTopicLabel,
        BcfViewpoint,
        Borgingsmoment,
        Borgingsplan,
        CaptureLink,
        Certificate,
        ChecklistItem,
        ChecklistItemResult,
        ChecklistItemResultAttachment,
        Deadline,
        DeadlineNotificationLog,
        DeadlineNotificationSettings,
        Finding,
        FindingAttachment,
        Job,
        Level,
        Document,
        Notification,
        NotificationUserState,
        OrgCertificate,
        OrgCertificateTag,
        Organization,
        OrganizationMember,
        PdfPage,
        Project,
        ProjectFile,
        ProjectMember,
        Report,
        Risk,
        Storey,
        User,
    )

    bind = op.get_bind()
    schema = _schema()
    bind.execute(text(f'DROP INDEX IF EXISTS "{schema}".ix_audit_created_at'))
    bind.execute(text(f'DROP INDEX IF EXISTS "{schema}".ix_findings_project_created'))
    bind.execute(text(f'DROP INDEX IF EXISTS "{schema}".ix_jobs_payload_framework'))
    bind.execute(text(f'DROP INDEX IF EXISTS "{schema}".uq_findings_source_item'))
    bind.execute(text(f'DROP INDEX IF EXISTS "{schema}".ix_checklist_items_element_link'))
    bind.execute(text(f'DROP INDEX IF EXISTS "{schema}".ux_borgingsplans_one_active'))
    tenant_tables = [t for t in Base.metadata.tables.values() if is_tenant_table(t)]
    Base.metadata.drop_all(bind, tables=tenant_tables)
    for enum in (
        "borgingsmomentphase",
        "borgingsmomentstatus",
        "borgingsplanstatus",
        "checklistitemtype",
        "certificatetype",
        "certificatestatus",
        "attachmentcategory",
        "dossierslot",
        "evidencetype",
        "extractionstatus",
        "findingseverity",
        "findingstatus",
        "filetype",
        "ifcschema",
        "jobstatus",
        "jobtype",
        "documentdiscipline",
        "documentstatus",
        "notificationeventtype",
        "projectfilerole",
        "projectfilestatus",
        "projectlifecyclestate",
        "projectphase",
        "projectrole",
        "reportstatus",
        "reporttype",
        "riskcategory",
        "risklevel",
        "buildingtype",
        "deadlinestatus",
        "inspectionverdict",
    ):
        bind.execute(text(f'DROP TYPE IF EXISTS "{schema}".{enum}'))
