from __future__ import annotations

from enum import StrEnum
from typing import TYPE_CHECKING, Any
from uuid import UUID, uuid4

from sqlalchemy import BigInteger, CheckConstraint, Enum as SAEnum, ForeignKey, Index, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from bimstitch_api.db import TenantBase
from bimstitch_api.models._mixins import SoftDeleteMixin, TimestampMixin

if TYPE_CHECKING:
    from bimstitch_api.models.capture_link import CaptureLink
    from bimstitch_api.models.model import Model
    from bimstitch_api.models.project import Project
    from bimstitch_api.models.project_file import ProjectFile
    from bimstitch_api.models.user import User


class AttachmentCategory(StrEnum):
    image = "image"
    video = "video"
    audio = "audio"
    office = "office"
    other = "other"


class AttachmentStatus(StrEnum):
    pending = "pending"
    ready = "ready"
    rejected = "rejected"


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


class Attachment(TimestampMixin, SoftDeleteMixin, TenantBase):
    __tablename__ = "attachments"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    project_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
    )
    uploaded_by_user_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.users.id", ondelete="RESTRICT"),
        nullable=True,
    )
    capture_link_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("capture_links.id", ondelete="SET NULL"),
        nullable=True,
    )

    storage_key: Mapped[str] = mapped_column(String(512), unique=True, nullable=False)
    original_filename: Mapped[str] = mapped_column(String(512), nullable=False)
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    content_type: Mapped[str] = mapped_column(String(255), nullable=False)
    content_sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)

    attachment_category: Mapped[AttachmentCategory] = mapped_column(
        SAEnum(
            AttachmentCategory,
            name="attachmentcategory",
            values_callable=lambda enum: [m.value for m in enum],
        ),
        nullable=False,
    )
    status: Mapped[AttachmentStatus] = mapped_column(
        SAEnum(
            AttachmentStatus,
            name="attachmentstatus",
            values_callable=lambda enum: [m.value for m in enum],
        ),
        nullable=False,
        default=AttachmentStatus.pending,
    )
    rejection_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    linked_element_global_id: Mapped[str | None] = mapped_column(String(22), nullable=True)
    linked_model_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("models.id", ondelete="SET NULL"),
        nullable=True,
    )
    linked_point: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    linked_file_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("project_files.id", ondelete="SET NULL"),
        nullable=True,
    )

    capture_metadata: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    server_metadata: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)

    version_number: Mapped[int] = mapped_column(default=1, nullable=False)
    parent_attachment_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("attachments.id", ondelete="SET NULL"),
        nullable=True,
    )

    project: Mapped[Project] = relationship(foreign_keys=[project_id], lazy="raise")
    uploaded_by_user: Mapped[User | None] = relationship(
        foreign_keys=[uploaded_by_user_id], lazy="raise"
    )
    capture_link: Mapped[CaptureLink | None] = relationship(
        foreign_keys=[capture_link_id], lazy="raise"
    )
    linked_model: Mapped[Model | None] = relationship(
        foreign_keys=[linked_model_id], lazy="raise"
    )
    linked_file: Mapped[ProjectFile | None] = relationship(
        foreign_keys=[linked_file_id], lazy="raise"
    )
    parent_attachment: Mapped[Attachment | None] = relationship(
        foreign_keys=[parent_attachment_id], remote_side=[id], lazy="raise"
    )

    @property
    def uploaded_by_name(self) -> str | None:
        if self.uploaded_by_user is None:
            return None
        return self.uploaded_by_user.full_name

    __table_args__ = (
        CheckConstraint("size_bytes >= 0", name="ck_attachments_size_non_negative"),
        Index("ix_attachments_project_id", "project_id"),
        Index("ix_attachments_project_category", "project_id", "attachment_category"),
        Index("ix_attachments_capture_link_id", "capture_link_id"),
        Index("ix_attachments_uploaded_by", "uploaded_by_user_id"),
        Index(
            "ix_attachments_linked_element",
            "linked_model_id",
            "linked_element_global_id",
            postgresql_where="linked_model_id IS NOT NULL AND linked_element_global_id IS NOT NULL",
        ),
        Index(
            "ix_attachments_active",
            "project_id",
            "created_at",
            postgresql_where="deleted_at IS NULL",
        ),
    )
