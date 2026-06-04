"""Add BCF topics, viewpoints, and comments tables.

BCF 2.1/3.0 import/export: server-persisted BCF topics with viewpoints,
snapshots, and comments for BIM collaboration format exchange.

Revision ID: 0003_bcf_tables
Revises: 0002_org_certificates
Create Date: 2026-06-04
"""

from __future__ import annotations

import os
from typing import Sequence, Union

from alembic import op
from sqlalchemy import text

revision: str = "0003_bcf_tables"
down_revision: Union[str, None] = "0002_org_certificates"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _schema() -> str:
    schema = os.environ.get("BIMSTITCH_TENANT_SCHEMA")
    if not schema:
        raise RuntimeError("BIMSTITCH_TENANT_SCHEMA is required for tenant migrations")
    return schema


def upgrade() -> None:
    schema = _schema()
    bind = op.get_bind()

    bind.execute(text(f'SET LOCAL search_path = "{schema}", public'))

    # -- bcf_topics ----------------------------------------------------------
    bind.execute(
        text(
            "CREATE TABLE IF NOT EXISTS bcf_topics ("
            "    id UUID PRIMARY KEY, "
            "    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE, "
            "    guid VARCHAR(36) NOT NULL UNIQUE, "
            "    title VARCHAR(255) NOT NULL, "
            "    description TEXT, "
            "    topic_type VARCHAR(50) NOT NULL DEFAULT 'Issue', "
            "    topic_status VARCHAR(50) NOT NULL DEFAULT 'Open', "
            "    priority VARCHAR(50), "
            "    stage VARCHAR(50), "
            "    assigned_to VARCHAR(255), "
            "    labels JSONB DEFAULT '[]', "
            "    due_date DATE, "
            "    creation_author VARCHAR(255) NOT NULL, "
            "    creation_date TIMESTAMPTZ NOT NULL, "
            "    modified_author VARCHAR(255), "
            "    modified_date TIMESTAMPTZ, "
            "    linked_finding_id UUID REFERENCES findings(id) ON DELETE SET NULL, "
            "    linked_model_id UUID REFERENCES models(id) ON DELETE SET NULL, "
            "    created_by_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT, "
            "    bcf_version VARCHAR(10) NOT NULL, "
            "    import_source VARCHAR(255), "
            "    created_at TIMESTAMPTZ NOT NULL DEFAULT now(), "
            "    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), "
            "    deleted_at TIMESTAMPTZ"
            ")"
        )
    )

    bind.execute(text("CREATE INDEX IF NOT EXISTS ix_bcf_topics_project_id ON bcf_topics (project_id)"))
    bind.execute(text("CREATE INDEX IF NOT EXISTS ix_bcf_topics_project_status ON bcf_topics (project_id, topic_status)"))
    bind.execute(text("CREATE INDEX IF NOT EXISTS ix_bcf_topics_linked_finding_id ON bcf_topics (linked_finding_id)"))
    bind.execute(text("CREATE INDEX IF NOT EXISTS ix_bcf_topics_linked_model_id ON bcf_topics (linked_model_id)"))
    bind.execute(text("CREATE INDEX IF NOT EXISTS ix_bcf_topics_created_by_user_id ON bcf_topics (created_by_user_id)"))

    # -- bcf_viewpoints ------------------------------------------------------
    bind.execute(
        text(
            "CREATE TABLE IF NOT EXISTS bcf_viewpoints ("
            "    id UUID PRIMARY KEY, "
            "    topic_id UUID NOT NULL REFERENCES bcf_topics(id) ON DELETE CASCADE, "
            "    guid VARCHAR(36) NOT NULL, "
            "    index_in_topic INTEGER NOT NULL DEFAULT 0, "
            "    camera_type VARCHAR(20) NOT NULL, "
            "    camera_view_point JSONB NOT NULL, "
            "    camera_direction JSONB NOT NULL, "
            "    camera_up_vector JSONB NOT NULL, "
            "    field_of_view DOUBLE PRECISION, "
            "    field_of_height DOUBLE PRECISION, "
            "    components JSONB, "
            "    clipping_planes JSONB, "
            "    snapshot_storage_key VARCHAR(512), "
            "    is_2d BOOLEAN NOT NULL DEFAULT FALSE, "
            "    view_state_2d JSONB, "
            "    linked_file_id UUID REFERENCES project_files(id) ON DELETE SET NULL, "
            "    created_at TIMESTAMPTZ NOT NULL DEFAULT now(), "
            "    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()"
            ")"
        )
    )

    bind.execute(text("CREATE INDEX IF NOT EXISTS ix_bcf_viewpoints_topic_id ON bcf_viewpoints (topic_id)"))
    bind.execute(text("CREATE INDEX IF NOT EXISTS ix_bcf_viewpoints_linked_file_id ON bcf_viewpoints (linked_file_id)"))

    # -- bcf_comments --------------------------------------------------------
    bind.execute(
        text(
            "CREATE TABLE IF NOT EXISTS bcf_comments ("
            "    id UUID PRIMARY KEY, "
            "    topic_id UUID NOT NULL REFERENCES bcf_topics(id) ON DELETE CASCADE, "
            "    guid VARCHAR(36) NOT NULL, "
            "    comment_text TEXT NOT NULL, "
            "    author VARCHAR(255) NOT NULL, "
            "    date TIMESTAMPTZ NOT NULL, "
            "    modified_author VARCHAR(255), "
            "    modified_date TIMESTAMPTZ, "
            "    viewpoint_guid VARCHAR(36), "
            "    created_by_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL, "
            "    created_at TIMESTAMPTZ NOT NULL DEFAULT now(), "
            "    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()"
            ")"
        )
    )

    bind.execute(text("CREATE INDEX IF NOT EXISTS ix_bcf_comments_topic_id ON bcf_comments (topic_id)"))
    bind.execute(text("CREATE INDEX IF NOT EXISTS ix_bcf_comments_created_by_user_id ON bcf_comments (created_by_user_id)"))


def downgrade() -> None:
    schema = _schema()
    bind = op.get_bind()

    bind.execute(text(f'SET LOCAL search_path = "{schema}", public'))
    bind.execute(text("DROP TABLE IF EXISTS bcf_comments"))
    bind.execute(text("DROP TABLE IF EXISTS bcf_viewpoints"))
    bind.execute(text("DROP TABLE IF EXISTS bcf_topics"))
