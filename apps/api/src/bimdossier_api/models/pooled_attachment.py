"""Pooled free-tier attachments — `public.pooled_attachments`.

Photo (and other file) evidence for free snags, the pooled analog of the paid
`ProjectFile` *attachment* facet (`models.project_file.ProjectFile` with
`role='attachment'`). A free attachment is a project-scoped row (NOT
finding-scoped): the mobile offline outbox uploads a photo BEFORE the snag that
references it exists, so the upload can't carry a finding id. The finding→photo
link lives in `free_finding_attachment.PooledFindingAttachment`.

Pooled-in-`public`, isolation by owner-keyed RLS on `owner_user_id` plus
owner-OR-member visibility resolved through `pooled_project_id` (see
`_rls_sql.enable_pooled_attachment_rls_statements`). `owner_user_id` is the project
OWNER (the RLS / quota key) even when an invited member uploads the photo;
`uploaded_by_user_id` records the real uploader.

Two-phase presigned upload mirrors the paid attachments flow (initiate → PUT →
complete). Objects live under the owner's free key prefix
(`free/<owner_user_id>/attachments/<id>/source<ext>`), validated by
`assert_pooled_key_scoped`.
"""

from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    String,
    Text,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from bimdossier_api.db import MasterBase
from bimdossier_api.models._pooled import PooledOwnedMixin, TimestampMixin, check_in
from bimdossier_api.models.project_file import AttachmentCategory, ProjectFileStatus

# Value sets derived from the paid enums so the free CHECK constraints stay in
# lockstep and the values are identity with paid (so the paid AttachmentRead /
# Zod schemas validate free rows unchanged).
POOLED_ATTACHMENT_CATEGORIES: tuple[str, ...] = tuple(c.value for c in AttachmentCategory)
POOLED_ATTACHMENT_STATUSES: tuple[str, ...] = tuple(s.value for s in ProjectFileStatus)


class PooledAttachment(PooledOwnedMixin, TimestampMixin, MasterBase):
    __tablename__ = "pooled_attachments"

    # `owner_user_id` (from PooledOwnedMixin) stays = the project owner even when an
    # invited member uploads the photo; the RLS policy + the (future) superuser
    # image-metadata callback key on it directly.
    # The project the evidence belongs to (RLS member resolution). NOT NULL —
    # every free attachment is uploaded within a project context.
    pooled_project_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.pooled_projects.id", ondelete="CASCADE"),
        nullable=False,
    )
    # Who actually uploaded it (owner or an invited editor). NULL only defensively.
    uploaded_by_user_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.users.id", ondelete="SET NULL"),
        nullable=True,
    )

    # `free/<owner_user_id>/attachments/<id>/source<ext>` (default bucket, same as
    # free models — no separate attachments bucket, so it inherits the free CORS).
    storage_key: Mapped[str] = mapped_column(Text, nullable=False)
    original_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    content_type: Mapped[str | None] = mapped_column(String(255), nullable=True)
    content_sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    attachment_category: Mapped[str] = mapped_column(
        String(16), nullable=False, default="other", server_default="other"
    )

    status: Mapped[str] = mapped_column(
        String(16), nullable=False, default="pending", server_default="pending"
    )
    rejection_reason: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Capture context (geolocation / exif / device fingerprint) for snag photos.
    capture_metadata: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    # Offline mobile outbox replay key (per-owner unique while live).
    idempotency_key: Mapped[str | None] = mapped_column(String(200), nullable=True)

    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, default=None
    )

    __table_args__ = (
        CheckConstraint("size_bytes >= 0", name="ck_pooled_attachments_size_nonneg"),
        CheckConstraint(
            check_in("status", POOLED_ATTACHMENT_STATUSES),
            name="ck_pooled_attachments_status",
        ),
        CheckConstraint(
            check_in("attachment_category", POOLED_ATTACHMENT_CATEGORIES),
            name="ck_pooled_attachments_category",
        ),
        # Offline-replay idempotency: one row per (owner, key) among live rows.
        Index(
            "uq_pooled_attachments_owner_idempotency_key",
            "owner_user_id",
            "idempotency_key",
            unique=True,
            postgresql_where=text("idempotency_key IS NOT NULL AND deleted_at IS NULL"),
        ),
        Index("ix_pooled_attachments_owner", "owner_user_id"),
        Index("ix_pooled_attachments_project", "pooled_project_id"),
        {"schema": "public"},
    )
