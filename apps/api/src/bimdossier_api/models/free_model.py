"""Pooled free-tier model rows — `public.free_models`.

The free wedge keeps free users as POOLED rows in `public`, never their own
`org_<hex>` tenant schema (so the per-tenant migration fan-out stays
`O(paying orgs) + 1` no matter how many free users sign up). Isolation is by
RLS on `owner_user_id` (see `_rls_sql.enable_free_tier_rls_statements`), fed by
the `app.current_user_id` GUC that `get_free_session` sets — there is no
`app.current_org_id` for a free, org-less account.

Extraction state lives here (no tenant `Job` row): `extraction_status` plus the
artifact `*_key` columns the free callback stamps. `converted_to_file_id` is the
idempotency marker set when the model is imported into a paid project at
conversion — re-import is then a no-op.

Status/extraction enums are `String` + `CHECK` rather than Postgres enums (the
"likely-to-grow → String+CHECK" convention) so widening the value set never
needs a type migration.
"""

from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from bimdossier_api.db import MasterBase

# Allowed value sets — also imported by the router/schemas so the CHECK and the
# API validation stay in lockstep.
FREE_MODEL_STATUSES: tuple[str, ...] = ("pending", "ready", "rejected")
FREE_EXTRACTION_STATUSES: tuple[str, ...] = (
    "none",
    "queued",
    "running",
    "succeeded",
    "failed",
)


def _in_clause(column: str, values: tuple[str, ...]) -> str:
    rendered = ", ".join(f"'{v}'" for v in values)
    return f"{column} IN ({rendered})"


class FreeModel(MasterBase):
    __tablename__ = "free_models"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    # Denormalized owner — the RLS policy keys on this column directly (no join).
    owner_user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.users.id", ondelete="CASCADE"),
        nullable=False,
    )

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    original_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    # `free/<owner_user_id>/<model_id>/source.ifc`; artifacts live alongside.
    storage_key: Mapped[str] = mapped_column(Text, nullable=False)

    ifc_schema: Mapped[str | None] = mapped_column(String(16), nullable=True)
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    content_sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)

    status: Mapped[str] = mapped_column(
        String(16), nullable=False, default="pending", server_default="pending"
    )
    rejection_reason: Mapped[str | None] = mapped_column(String(255), nullable=True)

    extraction_status: Mapped[str] = mapped_column(
        String(16), nullable=False, default="none", server_default="none"
    )
    extraction_error: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Artifact keys, stamped by the free callback once extraction succeeds.
    fragments_key: Mapped[str | None] = mapped_column(Text, nullable=True)
    metadata_key: Mapped[str | None] = mapped_column(Text, nullable=True)
    outline_key: Mapped[str | None] = mapped_column(Text, nullable=True)
    properties_key: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Set at conversion to the new paid ProjectFile id (lives in a tenant
    # schema, so no cross-schema FK). Non-null = already converted → re-import
    # is a no-op.
    converted_to_file_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), nullable=True
    )
    # Stamped by the viewer-bundle GET; drives the idle reaper.
    last_viewed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    __table_args__ = (
        CheckConstraint(
            _in_clause("status", FREE_MODEL_STATUSES), name="ck_free_models_status"
        ),
        CheckConstraint(
            _in_clause("extraction_status", FREE_EXTRACTION_STATUSES),
            name="ck_free_models_extraction_status",
        ),
        Index("ix_free_models_owner", "owner_user_id"),
        Index("ix_free_models_owner_status", "owner_user_id", "status"),
        {"schema": "public"},
    )
