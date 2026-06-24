from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import TYPE_CHECKING, Any
from uuid import UUID, uuid4

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    String,
    Text,
    text,
)
from sqlalchemy import Enum as SAEnum
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from bimstitch_api.db import TenantBase
from bimstitch_api.models._mixins import (
    FileBackedMixin,
    SoftDeleteMixin,
    StoredFileMixin,
    TimestampMixin,
)

if TYPE_CHECKING:
    from bimstitch_api.models.capture_link import CaptureLink
    from bimstitch_api.models.model import Model
    from bimstitch_api.models.project import Project
    from bimstitch_api.models.user import User


class ProjectFileRole(StrEnum):
    """What job a ``project_files`` row does.

    A single physical file table now backs two roles. ``model_source`` rows are
    the actual content of a ``Model`` — they run the extraction pipeline and are
    what the 3D viewer renders. ``attachment`` rows are supporting files added
    at the project level. The CHECK constraints on the table tie ``model_id`` to
    this discriminator (a model source must belong to a Model; an attachment
    never claims one).
    """

    model_source = "model_source"
    attachment = "attachment"


class FileType(StrEnum):
    ifc = "ifc"
    pdf = "pdf"
    dxf = "dxf"
    dwg = "dwg"


ALLOWED_EXTENSIONS: dict[str, FileType] = {
    ".ifc": FileType.ifc,
    # Compressed IFC (a zip wrapping a single .ifc). Same FileType — compression
    # is a property of the upload, not a distinct kind; the schema is sniffed by
    # the processor after decompression, not at the API.
    ".ifczip": FileType.ifc,
    ".pdf": FileType.pdf,
    # CAD drawings. DXF is parsed directly; DWG is converted to DXF in the
    # processor (dwg2dxf) before the same extraction runs. Two FileTypes so the
    # UI pill reflects what the user uploaded.
    ".dxf": FileType.dxf,
    ".dwg": FileType.dwg,
}


class IfcSchema(StrEnum):
    ifc2x3 = "IFC2X3"
    ifc4 = "IFC4"
    ifc4x1 = "IFC4X1"  # retained for back-compat; parser no longer accepts it.
    ifc4x3 = "IFC4X3"
    unknown = "unknown"


class ProjectFileStatus(StrEnum):
    pending = "pending"
    ready = "ready"
    rejected = "rejected"


class ExtractionStatus(StrEnum):
    not_started = "not_started"
    queued = "queued"
    running = "running"
    succeeded = "succeeded"
    failed = "failed"


class AttachmentCategory(StrEnum):
    image = "image"
    video = "video"
    audio = "audio"
    office = "office"
    other = "other"


class DossierSlot(StrEnum):
    """Which dossier-bevoegd-gezag requirement a document satisfies.

    Neutral codes; Dutch/English labels live in the jurisdiction registry
    (``Jurisdiction.dossier_category_labels`` / requirement templates), same
    rule as ``AttachmentCategory`` and ``CertificateType``. Assigned from the
    dossier checklist UI (upload-into-slot or link-existing), never derived
    from the file itself.
    """

    drawings = "drawings"
    structural_calculations = "structural_calculations"
    fire_safety = "fire_safety"
    energy_performance = "energy_performance"
    installations = "installations"
    assurance = "assurance"
    inspection_evidence = "inspection_evidence"
    other = "other"


ATTACHMENT_ALLOWED_EXTENSIONS: dict[str, AttachmentCategory] = {
    ".jpg": AttachmentCategory.image,
    ".jpeg": AttachmentCategory.image,
    ".png": AttachmentCategory.image,
    ".webp": AttachmentCategory.image,
    ".heic": AttachmentCategory.image,
    ".mp4": AttachmentCategory.video,
    ".mov": AttachmentCategory.video,
    ".webm": AttachmentCategory.video,
    ".mp3": AttachmentCategory.audio,
    ".m4a": AttachmentCategory.audio,
    ".wav": AttachmentCategory.audio,
    ".ogg": AttachmentCategory.audio,
    ".pdf": AttachmentCategory.office,
    ".docx": AttachmentCategory.office,
    ".xlsx": AttachmentCategory.office,
    ".pptx": AttachmentCategory.office,
    ".txt": AttachmentCategory.office,
}


class ProjectFile(
    TimestampMixin, SoftDeleteMixin, FileBackedMixin, StoredFileMixin, TenantBase
):
    """A project-scoped stored file, playing one of two roles (see ``role``).

    ``model_source`` rows are versions of a ``Model`` (anchored by
    ``(model_id, version_number)``); ``attachment`` rows are supporting files
    versioned by their own self-FK lineage (``coalesce(parent_file_id, id)``).
    The two facets below are mutually exclusive by role — enforced by CHECKs.
    """

    __tablename__ = "project_files"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    project_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
    )
    role: Mapped[ProjectFileRole] = mapped_column(
        SAEnum(
            ProjectFileRole,
            name="projectfilerole",
            values_callable=lambda enum: [m.value for m in enum],
        ),
        nullable=False,
    )
    # A capture-link upload has no authenticated user, so this is nullable.
    uploaded_by_user_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.users.id", ondelete="RESTRICT"),
        nullable=True,
    )

    # storage_key / original_filename / size_bytes / content_type /
    # content_sha256 come from FileBackedMixin.
    # version_number / rejection_reason / description come from StoredFileMixin.

    file_type: Mapped[FileType] = mapped_column(
        SAEnum(
            FileType,
            name="filetype",
            values_callable=lambda enum: [m.value for m in enum],
        ),
        nullable=False,
        default=FileType.ifc,
        server_default=FileType.ifc.value,
    )
    status: Mapped[ProjectFileStatus] = mapped_column(
        SAEnum(
            ProjectFileStatus,
            name="projectfilestatus",
            values_callable=lambda enum: [m.value for m in enum],
        ),
        nullable=False,
        default=ProjectFileStatus.pending,
        server_default=ProjectFileStatus.pending.value,
    )

    # --- model_source facet (NULL for attachments) ---------------------------
    model_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("models.id", ondelete="CASCADE"),
        nullable=True,
    )
    ifc_project_guid: Mapped[str | None] = mapped_column(String(22), nullable=True)
    ifc_schema: Mapped[IfcSchema | None] = mapped_column(
        SAEnum(
            IfcSchema,
            name="ifcschema",
            values_callable=lambda enum: [m.value for m in enum],
        ),
        nullable=True,
    )
    extraction_status: Mapped[ExtractionStatus] = mapped_column(
        SAEnum(
            ExtractionStatus,
            name="extractionstatus",
            values_callable=lambda enum: [m.value for m in enum],
        ),
        nullable=False,
        default=ExtractionStatus.not_started,
        server_default=ExtractionStatus.not_started.value,
    )
    extraction_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    extraction_started_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    extraction_finished_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    extractor_version: Mapped[str | None] = mapped_column(String(64), nullable=True)
    fragments_storage_key: Mapped[str | None] = mapped_column(String(512), nullable=True)
    metadata_storage_key: Mapped[str | None] = mapped_column(String(512), nullable=True)
    properties_storage_key: Mapped[str | None] = mapped_column(String(512), nullable=True)
    geometry_storage_key: Mapped[str | None] = mapped_column(String(512), nullable=True)
    outline_storage_key: Mapped[str | None] = mapped_column(String(512), nullable=True)
    floor_plans_storage_key: Mapped[str | None] = mapped_column(String(512), nullable=True)
    # Content-based discipline classification computed at extraction time from
    # the element histogram (architectural / structural / mep / mixed / none).
    # NULL for non-IFC files and files extracted before this field existed.
    # String + app-level values (not a PG enum) per the enum-evolution rule —
    # this set may grow and must not incur a tenant-fan-out migration.
    detected_kind: Mapped[str | None] = mapped_column(String(32), nullable=True)

    # --- attachment facet (NULL for model sources) ---------------------------
    attachment_category: Mapped[AttachmentCategory | None] = mapped_column(
        SAEnum(
            AttachmentCategory,
            name="attachmentcategory",
            values_callable=lambda enum: [m.value for m in enum],
        ),
        nullable=True,
    )
    dossier_slot: Mapped[DossierSlot | None] = mapped_column(
        SAEnum(
            DossierSlot,
            name="dossierslot",
            values_callable=lambda enum: [m.value for m in enum],
        ),
        nullable=True,
    )
    capture_link_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("capture_links.id", ondelete="SET NULL"),
        nullable=True,
    )
    capture_metadata: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    server_metadata: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    # Offline-replay dedup for attachment initiate (mobile outbox). NULL for
    # online uploads, model-source rows, and every pre-existing row. A replayed
    # initiate re-sends the same client-minted key so the route returns the
    # original row (with a freshly re-presigned URL). See idempotency.py.
    idempotency_key: Mapped[str | None] = mapped_column(String(200), nullable=True)
    # Editable vector annotation document for image attachments — the
    # `Annotation2D[]` drawn over the photo plus the source-version pointer. The
    # *displayed* bytes are the flattened (burned-in) raster uploaded as a new
    # version; this keeps the markup re-editable. Free-form JSON (no PG enum), so
    # the shape can evolve without a tenant-fan-out migration. NULL for
    # un-annotated files and all non-image roles.
    annotation_state: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)

    # Version-group anchor for attachment rows (self-FK; root has NULL parent).
    # model_source rows leave this NULL and version by (model_id, version_number).
    parent_file_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("project_files.id", ondelete="SET NULL"),
        nullable=True,
    )

    # --- relationships -------------------------------------------------------
    model: Mapped[Model | None] = relationship(
        back_populates="files", foreign_keys=[model_id]
    )
    project: Mapped[Project] = relationship(foreign_keys=[project_id], lazy="raise")
    uploaded_by_user: Mapped[User | None] = relationship(
        foreign_keys=[uploaded_by_user_id], lazy="raise"
    )
    capture_link: Mapped[CaptureLink | None] = relationship(
        foreign_keys=[capture_link_id], lazy="raise"
    )
    parent_file: Mapped[ProjectFile | None] = relationship(
        foreign_keys=[parent_file_id], remote_side=[id], lazy="raise"
    )

    @property
    def uploaded_by_name(self) -> str | None:
        if self.uploaded_by_user is None:
            return None
        return self.uploaded_by_user.full_name

    __table_args__ = (
        CheckConstraint("size_bytes >= 0", name="ck_project_files_size_nonneg"),
        # A model source IS the content of a Model → must belong to one. An
        # attachment is never a model version → it never claims model_id.
        CheckConstraint(
            "role <> 'model_source' OR model_id IS NOT NULL",
            name="ck_project_files_model_source_has_model",
        ),
        CheckConstraint(
            "role <> 'attachment' OR model_id IS NULL",
            name="ck_project_files_attachment_no_model",
        ),
        # shared
        Index("ix_project_files_project_id", "project_id"),
        Index("ix_project_files_uploaded_by", "uploaded_by_user_id"),
        Index("ix_project_files_status_created_at", "status", "created_at"),
        # Dedup is per-role: a model source and an attachment in the same
        # project may legitimately carry identical bytes (different roles), so
        # `role` is part of the key — matching the pre-merge two-table behaviour.
        # `deleted_at IS NULL` is REQUIRED: soft_delete() only stamps deleted_at
        # and leaves status='ready', so without this clause a soft-deleted row
        # would linger in the index and a re-upload of the same bytes (which the
        # router pre-check excludes as deleted) would hit the index on flush →
        # 500. This mirrors the original attachments-table dedup index.
        Index(
            "uq_project_files_project_content_sha256",
            "project_id",
            "role",
            "content_sha256",
            unique=True,
            postgresql_where=text(
                "content_sha256 IS NOT NULL AND status IN ('pending', 'ready') "
                "AND deleted_at IS NULL"
            ),
        ),
        # model_source facet
        Index("ix_project_files_model_id", "model_id"),
        Index("ix_project_files_extraction_status", "extraction_status"),
        Index("ix_project_files_file_type", "file_type"),
        Index("ix_project_files_ifc_project_guid", "ifc_project_guid"),
        # Model versions: unique per model. Partial so attachment rows (model_id
        # NULL) are exempt.
        Index(
            "ux_project_files_model_version",
            "model_id",
            "version_number",
            unique=True,
            postgresql_where=text("role = 'model_source'"),
        ),
        # attachment facet
        Index(
            "ix_project_files_project_category",
            "project_id",
            "attachment_category",
            postgresql_where=text("attachment_category IS NOT NULL"),
        ),
        Index("ix_project_files_capture_link_id", "capture_link_id"),
        Index(
            "ix_project_files_active",
            "project_id",
            "created_at",
            postgresql_where=text("deleted_at IS NULL"),
        ),
        Index(
            "ix_project_files_dossier_slot",
            "project_id",
            "dossier_slot",
            postgresql_where=text("dossier_slot IS NOT NULL AND deleted_at IS NULL"),
        ),
        # Attachment versions: unique per lineage group = coalesce(parent, id).
        # Partial so model_source rows are exempt (they version by model above).
        Index(
            "ux_project_files_version_group",
            text("coalesce(parent_file_id, id), version_number"),
            unique=True,
            postgresql_where=text("role = 'attachment'"),
        ),
        Index(
            "ix_project_files_parent",
            "parent_file_id",
            postgresql_where=text("parent_file_id IS NOT NULL"),
        ),
        # Offline-replay dedup for attachment initiate: at most one row per
        # (uploader, idempotency key). Scoped to the uploader so a leaked key
        # can't replay another member's upload; partial so online (key-less) and
        # model-source rows are exempt.
        Index(
            "uq_project_files_uploader_idempotency_key",
            "uploaded_by_user_id",
            "idempotency_key",
            unique=True,
            postgresql_where=text("idempotency_key IS NOT NULL"),
        ),
    )
