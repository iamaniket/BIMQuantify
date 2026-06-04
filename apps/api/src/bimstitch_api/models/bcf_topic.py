from __future__ import annotations

from datetime import date, datetime  # noqa: TC003 — SQLAlchemy Mapped[] needs these at runtime
from typing import TYPE_CHECKING, Any
from uuid import UUID, uuid4

from sqlalchemy import Date, DateTime, ForeignKey, Index, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from bimstitch_api.db import TenantBase
from bimstitch_api.models._mixins import SoftDeleteMixin, TimestampMixin

if TYPE_CHECKING:
    from bimstitch_api.models.bcf_comment import BcfComment
    from bimstitch_api.models.bcf_viewpoint import BcfViewpoint
    from bimstitch_api.models.finding import Finding
    from bimstitch_api.models.model import Model
    from bimstitch_api.models.project import Project
    from bimstitch_api.models.user import User


class BcfTopic(TimestampMixin, SoftDeleteMixin, TenantBase):
    __tablename__ = "bcf_topics"
    __table_args__ = (
        Index("ix_bcf_topics_project_id", "project_id"),
        Index("ix_bcf_topics_project_status", "project_id", "topic_status"),
        Index("ix_bcf_topics_linked_finding_id", "linked_finding_id"),
        Index("ix_bcf_topics_linked_model_id", "linked_model_id"),
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
    labels: Mapped[list[Any] | None] = mapped_column(JSONB, nullable=True, default=list)
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
    linked_model_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("models.id", ondelete="SET NULL"),
        nullable=True,
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
    linked_model: Mapped[Model | None] = relationship("Model", lazy="raise")
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
