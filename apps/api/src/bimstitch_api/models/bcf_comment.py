from __future__ import annotations

from datetime import datetime  # noqa: TC003 — SQLAlchemy Mapped[] needs this at runtime
from typing import TYPE_CHECKING
from uuid import UUID, uuid4

from sqlalchemy import DateTime, ForeignKey, Index, String, Text
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from bimstitch_api.db import TenantBase
from bimstitch_api.models._mixins import TimestampMixin

if TYPE_CHECKING:
    from bimstitch_api.models.bcf_topic import BcfTopic
    from bimstitch_api.models.user import User


class BcfComment(TimestampMixin, TenantBase):
    __tablename__ = "bcf_comments"
    __table_args__ = (
        Index("ix_bcf_comments_topic_id", "topic_id"),
        Index("ix_bcf_comments_created_by_user_id", "created_by_user_id"),
    )

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    topic_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("bcf_topics.id", ondelete="CASCADE"),
        nullable=False,
    )
    guid: Mapped[str] = mapped_column(String(36), nullable=False)
    comment_text: Mapped[str] = mapped_column(Text, nullable=False)
    author: Mapped[str] = mapped_column(String(255), nullable=False)
    date: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    modified_author: Mapped[str | None] = mapped_column(String(255), nullable=True)
    modified_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    viewpoint_guid: Mapped[str | None] = mapped_column(String(36), nullable=True)

    created_by_user_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.users.id", ondelete="SET NULL"),
        nullable=True,
    )

    # Relationships
    topic: Mapped[BcfTopic] = relationship("BcfTopic", back_populates="comments", lazy="raise")
    created_by: Mapped[User | None] = relationship("User", lazy="raise")
