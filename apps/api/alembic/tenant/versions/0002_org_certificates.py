"""Add org_certificates table and certificates.org_certificate_id FK.

Org-level certificate library (P5): reusable product certificates that can be
linked (copied) into any project.

Revision ID: 0002_org_certificates
Revises: 0001_tenant
Create Date: 2026-06-04
"""

from __future__ import annotations

import os
from typing import Sequence, Union

from alembic import op
from sqlalchemy import text

revision: str = "0002_org_certificates"
down_revision: Union[str, None] = "0001_tenant"
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

    bind.execute(
        text(
            "CREATE TABLE IF NOT EXISTS org_certificates ("
            "    id UUID PRIMARY KEY, "
            "    uploaded_by_user_id UUID REFERENCES public.users(id) ON DELETE RESTRICT, "
            "    storage_key VARCHAR(512) NOT NULL UNIQUE, "
            "    original_filename VARCHAR(512) NOT NULL, "
            "    size_bytes BIGINT NOT NULL CHECK (size_bytes >= 0), "
            "    content_type VARCHAR(255) NOT NULL, "
            "    content_sha256 VARCHAR(64), "
            "    certificate_type certificatetype NOT NULL, "
            "    status certificatestatus NOT NULL DEFAULT 'pending', "
            "    rejection_reason TEXT, "
            "    description TEXT, "
            "    certificate_number VARCHAR(255), "
            "    issuer VARCHAR(255), "
            "    subject TEXT, "
            "    valid_from DATE, "
            "    valid_until DATE, "
            "    product_name VARCHAR(255), "
            "    supplier_name VARCHAR(255), "
            "    replaced_by_id UUID REFERENCES org_certificates(id) ON DELETE SET NULL, "
            "    tags JSONB, "
            "    created_at TIMESTAMPTZ NOT NULL DEFAULT now(), "
            "    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), "
            "    deleted_at TIMESTAMPTZ"
            ")"
        )
    )

    bind.execute(text("CREATE INDEX IF NOT EXISTS ix_org_certificates_uploaded_by ON org_certificates (uploaded_by_user_id)"))
    bind.execute(text("CREATE INDEX IF NOT EXISTS ix_org_certificates_type ON org_certificates (certificate_type)"))
    bind.execute(text("CREATE INDEX IF NOT EXISTS ix_org_certificates_valid_until ON org_certificates (valid_until) WHERE valid_until IS NOT NULL AND deleted_at IS NULL"))
    bind.execute(text("CREATE INDEX IF NOT EXISTS ix_org_certificates_active ON org_certificates (created_at) WHERE deleted_at IS NULL"))

    bind.execute(text("ALTER TABLE certificates ADD COLUMN IF NOT EXISTS org_certificate_id UUID REFERENCES org_certificates(id) ON DELETE SET NULL"))
    bind.execute(text("CREATE INDEX IF NOT EXISTS ix_certificates_org_certificate_id ON certificates (org_certificate_id) WHERE org_certificate_id IS NOT NULL"))


def downgrade() -> None:
    schema = _schema()
    bind = op.get_bind()

    bind.execute(text(f'SET LOCAL search_path = "{schema}", public'))
    bind.execute(text("DROP INDEX IF EXISTS ix_certificates_org_certificate_id"))
    bind.execute(text("ALTER TABLE certificates DROP COLUMN IF EXISTS org_certificate_id"))
    bind.execute(text("DROP TABLE IF EXISTS org_certificates"))
