"""Org-level custom form templates for findings (Bevindingen).

A `FindingTemplate` is a reusable, admin-authored form definition stored at the
organisation level (tenant schema, no `project_id` — usable in every project,
mirroring `OrgCertificate`). It shapes the *create* form for a finding:

- `builtin_fields` toggles which OPTIONAL built-in finding fields show / are
  required (severity, bbl_article_ref, photos, references). The typed columns
  that drive the finding lifecycle (status, assignee, deadline, resolution
  evidence) are deliberately NOT templatable.
- `fields` is a list of CUSTOM field definitions (text/number/date/select/…)
  whose answers are stored on the finding as `custom_values` JSONB.

`template_type` is a forward-compat discriminator — every v1 row is `"findings"`.
A future template kind only needs a new enum value + builder/renderer; the column
is a plain validated `String` (no DB CHECK) so adding a value needs no migration.

JSONB is the right home for `fields` / `builtin_fields`: they are genuinely
dynamic, schema-less form definitions (same standing exception as `Job.payload`),
not relational data we query field-by-field.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any
from uuid import UUID, uuid4

from sqlalchemy import Boolean, ForeignKey, Index, String, Text, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from bimstitch_api.db import TenantBase
from bimstitch_api.models._mixins import SoftDeleteMixin, TimestampMixin

if TYPE_CHECKING:
    from bimstitch_api.models.user import User

# v1 default; new types are added in the app-layer enum (schemas), never the DB.
DEFAULT_TEMPLATE_TYPE = "findings"


class FindingTemplate(TimestampMixin, SoftDeleteMixin, TenantBase):
    __tablename__ = "finding_templates"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    # Forward-compat discriminator. Plain String (not Postgres enum / CHECK) so a
    # future kind is a code-only change — see module docstring.
    template_type: Mapped[str] = mapped_column(
        String(32),
        nullable=False,
        default=DEFAULT_TEMPLATE_TYPE,
        server_default=DEFAULT_TEMPLATE_TYPE,
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_default: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    # Optional built-in finding fields config, e.g.
    #   {"severity": {"visible": true, "required": true},
    #    "bbl_article_ref": {"visible": false, "required": false}, ...}
    # A missing key means library default (visible, not required).
    builtin_fields: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, default=dict, server_default=text("'{}'::jsonb")
    )
    # Custom field definitions (FieldDef shape — see schemas/finding_template.py).
    fields: Mapped[list[Any]] = mapped_column(
        JSONB, nullable=False, default=list, server_default=text("'[]'::jsonb")
    )
    created_by_user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.users.id", ondelete="RESTRICT"),
        nullable=False,
    )

    created_by: Mapped[User] = relationship(foreign_keys=[created_by_user_id], lazy="raise")

    __table_args__ = (
        # At most one default per template_type among active rows. The set-default
        # endpoint clears the old default then sets the new one in one transaction;
        # this partial-unique index is the DB-level backstop against a race.
        Index(
            "uq_finding_templates_one_default_per_type",
            "template_type",
            unique=True,
            postgresql_where="is_default AND deleted_at IS NULL",
        ),
        # Active-row listing, filtered by type.
        Index(
            "ix_finding_templates_active",
            "template_type",
            "created_at",
            postgresql_where="deleted_at IS NULL",
        ),
    )
