"""Org-level templates (finding forms + report layouts), unified.

A single org-scoped template table (tenant schema, no `project_id` — usable in
every project, mirroring `OrgCertificate`) that hosts multiple template *kinds*,
discriminated by `template_type`:

- ``findings`` — a custom finding-form definition. `config` holds
  ``{"builtin_fields": {...}, "fields": [FieldDef, ...]}``.
- report kinds (``compliance_report``, ``assurance_plan``,
  ``completion_declaration``, ``dossier``) — a branded, configurable report
  layout. `config` holds ``{"branding": {...}, "sections": [...], "options": {...}}``.

`template_type` is a plain validated `String` (the app-layer `TemplateType` enum
in ``schemas/org_template.py`` is the source of truth — no DB enum/CHECK), so a
new kind is a code-only change, no migration.

At most one default per `template_type`, enforced by a partial-unique index plus
clear-then-set in one transaction (see the router's `_clear_default`).

`config` is a self-contained, schema-less spec consumed wholesale by its
builder/renderer — the same standing JSONB exception as `Job.payload` /
`Report.params`, not relational data we query field-by-field. The read-only
`builtin_fields` / `fields` properties expose the findings sub-keys so the
finding-form consumers (`routers/finding.py`, `finding_custom_values`) read them
unchanged after the column→config move.
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

# v1 default kind; new kinds are added in the app-layer enum (schemas), never the DB.
DEFAULT_TEMPLATE_TYPE = "findings"


class OrgTemplate(TimestampMixin, SoftDeleteMixin, TenantBase):
    __tablename__ = "org_templates"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    # Kind discriminator. Plain String (not Postgres enum / CHECK) so a future
    # kind is a code-only change — see module docstring.
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
    # Self-contained, kind-specific spec consumed wholesale by the builder/renderer.
    #   findings: {"builtin_fields": {...}, "fields": [FieldDef, ...]}
    #   reports:  {"branding": {...}, "sections": [...], "options": {...}}
    config: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, default=dict, server_default=text("'{}'::jsonb")
    )
    created_by_user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.users.id", ondelete="RESTRICT"),
        nullable=False,
    )

    created_by: Mapped[User] = relationship(foreign_keys=[created_by_user_id], lazy="raise")

    # Back-compat read accessors for findings-kind consumers (routers/finding.py
    # `_enforce_builtin_required`, finding_custom_values `build_custom_values`).
    # Report kinds don't use these. Read-only: the only writer is the template
    # router, which sets `config` directly.
    @property
    def builtin_fields(self) -> dict[str, Any]:
        return self.config.get("builtin_fields", {}) if self.config else {}

    @property
    def fields(self) -> list[Any]:
        return self.config.get("fields", []) if self.config else []

    __table_args__ = (
        # At most one default per template_type among active rows. The set-default
        # endpoint clears the old default then sets the new one in one transaction;
        # this partial-unique index is the DB-level backstop against a race.
        Index(
            "uq_org_templates_one_default_per_type",
            "template_type",
            unique=True,
            postgresql_where="is_default AND deleted_at IS NULL",
        ),
        # Active-row listing, filtered by type.
        Index(
            "ix_org_templates_active",
            "template_type",
            "created_at",
            postgresql_where="deleted_at IS NULL",
        ),
    )
