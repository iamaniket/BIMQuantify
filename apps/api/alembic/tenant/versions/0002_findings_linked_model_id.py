"""findings.linked_model_id — version-independent element identity (#N9).

A finding linked to an IFC element was pinned to the single ``ProjectFile`` it
was raised against (``linked_file_id``), so it vanished when a new version of the
model was uploaded. This adds ``linked_model_id`` (mirroring Attachment /
Certificate) so an element-linked finding follows the element by (model,
GlobalId) across versions; ``linked_file_id`` stays as "raised on this version"
provenance.

Existing rows are backfilled from their pinned file's model. Then the composite
lookup index used by the version-independent element query is created on
``findings`` and — since it already carries the column but had no index — on
``certificates`` too.

Runs once per tenant schema (BIMSTITCH_TENANT_SCHEMA); the tenant env sets the
search_path inside Alembic's transaction.

Revision ID: 0002_findings_linked_model_id
Revises: 0001_tenant
Create Date: 2026-05-31
"""

from __future__ import annotations

import os
from typing import TYPE_CHECKING

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

if TYPE_CHECKING:
    from collections.abc import Sequence

# Revision identifiers, used by Alembic.
revision: str = "0002_findings_linked_model_id"
down_revision: str | None = "0001_tenant"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_LINKED_ELEMENT_WHERE = "linked_model_id IS NOT NULL AND linked_element_global_id IS NOT NULL"


def _schema() -> str:
    schema = os.environ.get("BIMSTITCH_TENANT_SCHEMA")
    if not schema:
        raise RuntimeError("BIMSTITCH_TENANT_SCHEMA is required for tenant migrations")
    return schema


def upgrade() -> None:
    schema = _schema()

    op.add_column(
        "findings",
        sa.Column("linked_model_id", postgresql.UUID(as_uuid=True), nullable=True),
        schema=schema,
    )
    op.create_foreign_key(
        "fk_findings_linked_model_id_models",
        "findings",
        "models",
        ["linked_model_id"],
        ["id"],
        source_schema=schema,
        referent_schema=schema,
        ondelete="SET NULL",
    )

    # Backfill: a finding's model is the model of the file it was raised on.
    op.execute(
        sa.text(
            f'UPDATE "{schema}".findings AS f '
            f"SET linked_model_id = pf.model_id "
            f'FROM "{schema}".project_files AS pf '
            f"WHERE f.linked_file_id = pf.id AND f.linked_file_id IS NOT NULL"
        )
    )

    # Drives the version-independent element lookup
    # (?linked_model_id=&linked_element_global_id=). Mirrors ix_attachments_linked_element.
    op.create_index(
        "ix_findings_linked_element",
        "findings",
        ["linked_model_id", "linked_element_global_id"],
        schema=schema,
        postgresql_where=sa.text(_LINKED_ELEMENT_WHERE),
    )
    # Certificates already carry linked_model_id but lacked the composite index.
    op.create_index(
        "ix_certificates_linked_element",
        "certificates",
        ["linked_model_id", "linked_element_global_id"],
        schema=schema,
        postgresql_where=sa.text(_LINKED_ELEMENT_WHERE),
    )


def downgrade() -> None:
    schema = _schema()
    op.drop_index("ix_certificates_linked_element", table_name="certificates", schema=schema)
    op.drop_index("ix_findings_linked_element", table_name="findings", schema=schema)
    op.drop_constraint(
        "fk_findings_linked_model_id_models", "findings", schema=schema, type_="foreignkey"
    )
    op.drop_column("findings", "linked_model_id", schema=schema)
