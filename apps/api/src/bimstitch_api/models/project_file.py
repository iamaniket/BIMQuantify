from datetime import datetime
from enum import StrEnum
from typing import TYPE_CHECKING
from uuid import UUID, uuid4

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy import Enum as SAEnum
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from bimstitch_api.db import Base
from bimstitch_api.models._mixins import TimestampMixin

if TYPE_CHECKING:
    from bimstitch_api.models.model import Model


class FileType(StrEnum):
    ifc = "ifc"
    pdf = "pdf"


ALLOWED_EXTENSIONS: dict[str, "FileType"] = {
    ".ifc": FileType.ifc,
    ".pdf": FileType.pdf,
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


class ProjectFile(TimestampMixin, Base):
    __tablename__ = "project_files"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    model_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("models.id", ondelete="CASCADE"),
        nullable=False,
    )
    version_number: Mapped[int] = mapped_column(Integer, nullable=False)
    uploaded_by_user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
    )
    storage_key: Mapped[str] = mapped_column(String(512), nullable=False, unique=True)
    original_filename: Mapped[str] = mapped_column(String(512), nullable=False)
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    content_type: Mapped[str] = mapped_column(String(255), nullable=False)
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
    ifc_schema: Mapped[IfcSchema | None] = mapped_column(
        SAEnum(
            IfcSchema,
            name="ifcschema",
            values_callable=lambda enum: [m.value for m in enum],
        ),
        nullable=True,
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
    rejection_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

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

    model: Mapped["Model"] = relationship(back_populates="files")

    __table_args__ = (
        CheckConstraint("size_bytes >= 0", name="ck_project_files_size_nonneg"),
        UniqueConstraint("model_id", "version_number", name="uq_project_files_model_version"),
        Index("ix_project_files_model_id", "model_id"),
        Index("ix_project_files_status_created_at", "status", "created_at"),
        Index("ix_project_files_extraction_status", "extraction_status"),
        Index("ix_project_files_file_type", "file_type"),
    )
