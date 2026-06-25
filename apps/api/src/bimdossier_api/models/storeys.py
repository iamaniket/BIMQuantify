"""A building storey/level of a 3D Document.

Populated at extraction time from the IFC spatial tree (one row per
``IfcBuildingStorey``), via an idempotent upsert keyed by ``(document_id,
ifc_guid)`` so re-extraction keeps stable row ids. This is the authoritative
anchor a 2D PDF sheet pins to (see ``aligned_sheets``) and the level key that
findings can adopt later.

Single-language by design: ``name`` is whatever the IFC author wrote — not a
bilingual label (cf. the borgingsmoment/checklist seeded rows).
"""

from __future__ import annotations

from typing import TYPE_CHECKING
from uuid import UUID, uuid4

from sqlalchemy import Float, ForeignKey, Index, Integer, String, text
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from bimdossier_api.db import TenantBase
from bimdossier_api.models._mixins import SoftDeleteMixin, TimestampMixin

if TYPE_CHECKING:
    from bimdossier_api.models.document import Document
    from bimdossier_api.models.levels import Level


class Storey(TimestampMixin, SoftDeleteMixin, TenantBase):
    __tablename__ = "storeys"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    document_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("documents.id", ondelete="CASCADE"),
        nullable=False,
    )
    # IfcBuildingStorey.Name — author content, may be absent.
    name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # Floor elevation in model units (meters). Prefer the geometry-computed level
    # over the often-missing IfcBuildingStorey.Elevation attribute.
    elevation_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    # IFC GlobalId (base64, 22 chars) — the idempotency key for re-extraction upsert.
    ifc_guid: Mapped[str | None] = mapped_column(String(22), nullable=True)
    # IFC express id / localId, for reconciliation with the viewer fragments.
    express_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Display sort key, assigned ascending by elevation at ingest time.
    ordering: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # The shared project Level this storey reconciles onto (set at extraction by
    # _upsert_storeys, matching on elevation/name across disciplines). NULL until
    # reconciled. ON DELETE SET NULL so deleting a level just unlinks the storey;
    # re-extraction re-reconciles it.
    level_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("levels.id", ondelete="SET NULL"),
        nullable=True,
    )

    document: Mapped[Document] = relationship(back_populates="storeys")
    level: Mapped["Level | None"] = relationship()

    __table_args__ = (
        Index("ix_storeys_document_id", "document_id"),
        Index("ix_storeys_level_id", "level_id"),
        # Idempotency key for re-extraction upsert: one active storey per
        # (document, IFC GlobalId). Partial so rows without a GUID and
        # soft-deleted rows are exempt.
        Index(
            "uq_storeys_document_guid",
            "document_id",
            "ifc_guid",
            unique=True,
            postgresql_where=text("ifc_guid IS NOT NULL AND deleted_at IS NULL"),
        ),
    )
