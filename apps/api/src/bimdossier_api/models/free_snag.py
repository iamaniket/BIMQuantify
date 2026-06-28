"""Pooled free-tier snags — `public.free_snags`.

A minimal snag on a free model: title/note/severity/status plus an anchor
(world-space `anchor_x/y/z` for IFC, or `anchor_page` for a paged file) and the
IFC `linked_element_global_id`. `owner_user_id` is denormalized off the parent
model so the RLS policy keys on this row directly without a join to
`free_models` (see `_rls_sql.enable_free_tier_rls_statements`).

At conversion these map to real `findings`: severity/status translate to the
`FindingSeverity`/`FindingStatus` enums, and the world-space anchor + GlobalId
carry over directly (both are stable across re-extraction). See
`free_model.FreeModel` for the pooling rationale.
"""

from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from bimdossier_api.db import MasterBase

# Neutral severity/status codes — kept value-compatible with FindingSeverity so
# conversion is a direct map. Imported by the router/schemas to keep CHECK and
# API validation aligned.
FREE_SNAG_SEVERITIES: tuple[str, ...] = ("low", "medium", "high")
# Value-identical to FindingStatus (models.finding) so the board UI is reused
# unchanged and conversion maps 1:1.
FREE_SNAG_STATUSES: tuple[str, ...] = (
    "draft",
    "open",
    "in_progress",
    "resolved",
    "verified",
)
FREE_SNAG_NOTE_MAX = 4000


def _in_clause(column: str, values: tuple[str, ...]) -> str:
    rendered = ", ".join(f"'{v}'" for v in values)
    return f"{column} IN ({rendered})"


class FreeSnag(MasterBase):
    __tablename__ = "free_snags"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    free_model_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.free_models.id", ondelete="CASCADE"),
        nullable=False,
    )
    # Denormalized so the RLS policy needs no join to free_models.
    owner_user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.users.id", ondelete="CASCADE"),
        nullable=False,
    )

    title: Mapped[str] = mapped_column(String(255), nullable=False)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    severity: Mapped[str] = mapped_column(
        String(8), nullable=False, default="medium", server_default="medium"
    )
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, default="open", server_default="open"
    )

    linked_file_type: Mapped[str] = mapped_column(
        String(8), nullable=False, default="ifc", server_default="ifc"
    )
    anchor_x: Mapped[float | None] = mapped_column(Float, nullable=True)
    anchor_y: Mapped[float | None] = mapped_column(Float, nullable=True)
    anchor_z: Mapped[float | None] = mapped_column(Float, nullable=True)
    anchor_page: Mapped[int | None] = mapped_column(Integer, nullable=True)
    linked_element_global_id: Mapped[str | None] = mapped_column(String(255), nullable=True)

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
            _in_clause("severity", FREE_SNAG_SEVERITIES), name="ck_free_snags_severity"
        ),
        CheckConstraint(
            _in_clause("status", FREE_SNAG_STATUSES), name="ck_free_snags_status"
        ),
        CheckConstraint(
            f"note IS NULL OR char_length(note) <= {FREE_SNAG_NOTE_MAX}",
            name="ck_free_snags_note_len",
        ),
        Index("ix_free_snags_model", "free_model_id"),
        Index("ix_free_snags_owner", "owner_user_id"),
        {"schema": "public"},
    )
