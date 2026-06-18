"""Initial tenant schema (squashed baseline).

Tables: projects, project_members, models, project_files, jobs, reports,
contractors, notifications, notification_reads, notification_dismissals, risks,
borgingsplans, borgingsmomenten, checklist_items, checklist_item_results,
checklist_item_result_attachments, capture_links, findings, finding_attachments,
org_templates, certificates, org_certificates, org_certificate_tags,
bcf_topics, bcf_topic_labels, bcf_comments, bcf_viewpoints, audit_log,
deadline_notification_log, deadline_notification_settings.

This is the single squashed baseline for the tenant chain — the former
0002 (org_certificates), 0003 (bcf_tables), 0004 (document_versioning) and the
later anchor-generalization migration were folded in here. The anchor geometry
is now dedicated `anchor_x/y/z` + `anchor_page` columns (no JSONB), and the
former JSONB id/tag arrays are normalized into `finding_attachments`,
`checklist_item_result_attachments`, `org_certificate_tags` and
`bcf_topic_labels`. Because the upgrade is driven by `Base.metadata.create_all`
over the live models, anything the models declare — every table, column, enum,
and model-declared index (including expression / partial / unique indexes via
`Index(text(...), postgresql_where=...)`) — lands here automatically. Only the
handful of indexes the model layer cannot express are created explicitly in
upgrade() below.

A later squash folded in the former 0002–0006 add-ons (org_templates;
the unified finding-form + report-layout template table — formerly
finding_templates — with a single `config` JSONB; reports.template_id;
project_files.floor_plans_storage_key, formerly the standalone 0002 migration;
bcf_viewpoints.xray/measurements; deadlines.reference_number/filing_notes/
filed_at; project_files.outline_storage_key; project_files.detected_kind
(content-based discipline classification: architectural/structural/mep/mixed/
none); bcf_topics.linked_file_id/is_2d)
and flattened the bcf_viewpoints camera vectors from three JSONB columns
(camera_view_point/camera_direction/camera_up_vector) into nine dedicated Float
columns (camera_vp_x/y/z, camera_dir_x/y/z, camera_up_x/y/z) — same fixed-shape
{x,y,z} JSONB removal as the anchor flattening above.
and dropped model anchoring from attachments and certificates: `project_files`
(role='attachment') and `certificates` no longer carry the
`linked_element_global_id` / `linked_model_id` / `linked_file_id` /
`linked_file_type` / `anchor_x/y/z` / `anchor_page` columns. Findings keep
their anchor (the only coordinate-anchored entity marker); the shared validator
lives in `schemas/anchor.py`.

There is no longer a separate `attachments` table: attachments are rows in the
unified `project_files` table, distinguished by `role = 'attachment'`. The
per-role dedup and version-group indexes are declared on the `ProjectFile`
model, so create_all emits them — nothing attachment-specific is needed here.

Runs against the schema named in BIMSTITCH_TENANT_SCHEMA. FKs to master tables
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
    schema = os.environ.get("BIMSTITCH_TENANT_SCHEMA")
    if not schema:
        raise RuntimeError("BIMSTITCH_TENANT_SCHEMA is required for tenant migrations")
    return schema


def upgrade() -> None:
    from bimstitch_api.db import Base, is_tenant_table

    # Importing the models package registers every tenant model with
    # Base.metadata (its __init__ imports all of them, incl. the BCF and
    # org-certificate tables). The explicit names below are documentation.
    from bimstitch_api.models import (  # noqa: F401
        AccessRequest,
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
        Contractor,
        Deadline,
        DeadlineNotificationLog,
        DeadlineNotificationSettings,
        Finding,
        FindingAttachment,
        Job,
        Model,
        Notification,
        NotificationRead,
        OrgCertificate,
        OrgCertificateTag,
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
    from bimstitch_api.db import Base, is_tenant_table
    from bimstitch_api.models import (  # noqa: F401
        AccessRequest,
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
        Contractor,
        Deadline,
        DeadlineNotificationLog,
        DeadlineNotificationSettings,
        Finding,
        FindingAttachment,
        Job,
        Model,
        Notification,
        NotificationRead,
        OrgCertificate,
        OrgCertificateTag,
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
        "modeldiscipline",
        "modelstatus",
        "notificationeventtype",
        "projectfilerole",
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
        "deadlinestatus",
        "inspectionverdict",
    ):
        bind.execute(text(f'DROP TYPE IF EXISTS "{schema}".{enum}'))
