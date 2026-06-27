from __future__ import annotations

from datetime import date, datetime  # noqa: TC003 — SQLAlchemy Mapped[] needs these at runtime
from typing import TYPE_CHECKING
from uuid import UUID, uuid4

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Index, String, Text
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from bimdossier_api.db import TenantBase
from bimdossier_api.models._mixins import SoftDeleteMixin, TimestampMixin

if TYPE_CHECKING:
    from bimdossier_api.models.bcf_comment import BcfComment
    from bimdossier_api.models.bcf_topic_label import BcfTopicLabel
    from bimdossier_api.models.bcf_viewpoint import BcfViewpoint
    from bimdossier_api.models.document import Document
    from bimdossier_api.models.finding import Finding
    from bimdossier_api.models.project import Project
    from bimdossier_api.models.project_file import ProjectFile
    from bimdossier_api.models.user import User


class BcfTopic(TimestampMixin, SoftDeleteMixin, TenantBase):
    __tablename__ = "bcf_topics"
    __table_args__ = (
        Index("ix_bcf_topics_project_id", "project_id"),
        Index("ix_bcf_topics_project_status", "project_id", "topic_status"),
        Index("ix_bcf_topics_linked_finding_id", "linked_finding_id"),
        Index("ix_bcf_topics_linked_document_id", "linked_document_id"),
        Index("ix_bcf_topics_linked_file_id", "linked_file_id"),
        Index("ix_bcf_topics_created_by_user_id", "created_by_user_id"),
    )

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    project_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
    )
    guid: Mapped[str] = mapped_column(String(36), unique=True, nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    topic_type: Mapped[str] = mapped_column(String(50), nullable=False, default="Issue")
    topic_status: Mapped[str] = mapped_column(String(50), nullable=False, default="Open")
    priority: Mapped[str | None] = mapped_column(String(50), nullable=True)
    stage: Mapped[str | None] = mapped_column(String(50), nullable=True)
    assigned_to: Mapped[str | None] = mapped_column(String(255), nullable=True)
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    creation_author: Mapped[str] = mapped_column(String(255), nullable=False)
    creation_date: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    modified_author: Mapped[str | None] = mapped_column(String(255), nullable=True)
    modified_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    linked_finding_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("findings.id", ondelete="SET NULL"),
        nullable=True,
    )
    linked_document_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("documents.id", ondelete="SET NULL"),
        nullable=True,
    )
    # The specific document *version* (ProjectFile) the issue was raised against.
    # Mirrors BcfViewpoint.linked_file_id but at topic level so the list can
    # filter/display the version without joining viewpoints. ProjectFile carries
    # version_number / file_type / ifc_project_guid (used for BCF Header/File).
    linked_file_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("project_files.id", ondelete="SET NULL"),
        nullable=True,
    )
    # Topic-level dimension discriminator. 3D (IFC) and 2D (drawing) issues are
    # fundamentally different (per the BCF model): 2D issues live in a drawing's
    # coordinate space and carry no element GlobalIds. Denormalized from the
    # viewpoint's is_2d so the list endpoint can hard-filter by viewer type.
    is_2d: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    created_by_user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.users.id", ondelete="RESTRICT"),
        nullable=False,
    )

    bcf_version: Mapped[str] = mapped_column(String(10), nullable=False)
    import_source: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Relationships
    project: Mapped[Project] = relationship("Project", lazy="raise")
    linked_finding: Mapped[Finding | None] = relationship("Finding", lazy="raise")
    linked_document: Mapped[Document | None] = relationship("Document", lazy="raise")
    linked_file: Mapped[ProjectFile | None] = relationship("ProjectFile", lazy="raise")
    created_by: Mapped[User] = relationship("User", lazy="raise")
    viewpoints: Mapped[list[BcfViewpoint]] = relationship(
        "BcfViewpoint",
        back_populates="topic",
        cascade="all, delete-orphan",
        order_by="BcfViewpoint.index_in_topic",
        lazy="raise",
    )
    comments: Mapped[list[BcfComment]] = relationship(
        "BcfComment",
        back_populates="topic",
        cascade="all, delete-orphan",
        order_by="BcfComment.date",
        lazy="raise",
    )
    # Labels — normalize the former `labels` JSONB array into rows. Eager-loaded
    # so the read-only `labels` property is always populated.
    label_rows: Mapped[list[BcfTopicLabel]] = relationship(
        "BcfTopicLabel",
        back_populates="topic",
        cascade="all, delete-orphan",
        order_by="BcfTopicLabel.position",
        lazy="selectin",
    )

    @property
    def labels(self) -> list[str]:
        return [row.name for row in self.label_rows]
