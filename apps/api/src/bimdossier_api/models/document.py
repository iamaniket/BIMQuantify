from enum import StrEnum
from typing import TYPE_CHECKING
from uuid import UUID, uuid4

from sqlalchemy import Enum as SAEnum
from sqlalchemy import ForeignKey, Index, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from bimdossier_api.db import TenantBase
from bimdossier_api.models._mixins import SoftDeleteMixin, TimestampMixin
from bimdossier_api.models.project_file import FileType

if TYPE_CHECKING:
    from bimdossier_api.models.levels import Level
    from bimdossier_api.models.project import Project
    from bimdossier_api.models.project_file import ProjectFile
    from bimdossier_api.models.storeys import Storey


class DocumentDiscipline(StrEnum):
    architectural = "architectural"
    structural = "structural"
    mep = "mep"
    coordination = "coordination"
    other = "other"


class DocumentStatus(StrEnum):
    draft = "draft"
    active = "active"
    archived = "archived"


class Document(TimestampMixin, SoftDeleteMixin, TenantBase):
    __tablename__ = "documents"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    project_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    discipline: Mapped[DocumentDiscipline] = mapped_column(
        SAEnum(
            DocumentDiscipline,
            name="documentdiscipline",
            values_callable=lambda enum: [m.value for m in enum],
        ),
        nullable=False,
    )
    status: Mapped[DocumentStatus] = mapped_column(
        SAEnum(
            DocumentStatus,
            name="documentstatus",
            values_callable=lambda enum: [m.value for m in enum],
        ),
        nullable=False,
        default=DocumentStatus.active,
        server_default=DocumentStatus.active.value,
    )
    primary_file_type: Mapped[FileType | None] = mapped_column(
        SAEnum(
            FileType,
            name="filetype",
            values_callable=lambda enum: [m.value for m in enum],
            create_type=False,
        ),
        nullable=True,
    )
    # The project Level this document belongs to. Set for 2D drawing documents
    # (PDF/DXF) — "this drawing is the plan of this floor"; NULL = Unassigned.
    # ALWAYS NULL for IFC documents, which federate across every level rather
    # than belonging to one (enforced in routers/documents.update_document). ON
    # DELETE SET NULL so deleting a level reverts its drawings to Unassigned.
    level_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("levels.id", ondelete="SET NULL"),
        nullable=True,
    )
    # Current-revision pointer (F7 "restore version as head"). NULL = the head is
    # derived as the highest version_number (default behaviour); when set it pins
    # the head to a chosen older version. Kept as a plain column with NO ORM
    # relationship to avoid mutual-FK flush-ordering hazards (project_files
    # already points back at documents via document_id). Resolution lives in
    # `routers/project_files._shared.resolve_head_file_id`. ON DELETE SET NULL so
    # deleting the pinned version cleanly reverts the head to newest.
    head_file_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        # `use_alter` breaks the documents <-> project_files FK cycle
        # (project_files.document_id already points back here): the constraint is
        # emitted as a separate ALTER so create_all / drop_all can order the two
        # tables. Named so the ALTER is deterministic.
        ForeignKey(
            "project_files.id",
            ondelete="SET NULL",
            use_alter=True,
            name="fk_documents_head_file_id",
        ),
        nullable=True,
    )

    project: Mapped["Project"] = relationship(back_populates="documents")
    files: Mapped[list["ProjectFile"]] = relationship(
        back_populates="document",
        foreign_keys="ProjectFile.document_id",
        cascade="all, delete-orphan",
        order_by="ProjectFile.version_number.desc()",
    )
    # Storeys extracted from this document's IFC spatial tree (3D documents only;
    # PDF/DXF documents leave this empty). The anchor a 2D PDF sheet pins to.
    storeys: Mapped[list["Storey"]] = relationship(
        back_populates="document",
        cascade="all, delete-orphan",
        order_by="Storey.ordering",
    )
    # The project Level this 2D document sits on (NULL for IFC / Unassigned).
    level: Mapped["Level | None"] = relationship()

    __table_args__ = (
        UniqueConstraint("project_id", "name", name="uq_documents_project_name"),
        Index("ix_documents_project_id", "project_id"),
        Index("ix_documents_status", "status"),
        Index("ix_documents_level_id", "level_id"),
    )
