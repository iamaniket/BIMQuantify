from __future__ import annotations

from typing import TYPE_CHECKING
from uuid import UUID, uuid4

from sqlalchemy import ForeignKey, Index, Integer, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from bimdossier_api.db import TenantBase
from bimdossier_api.models._mixins import TimestampMixin

if TYPE_CHECKING:
    from bimdossier_api.models.bcf_topic import BcfTopic


class BcfTopicLabel(TimestampMixin, TenantBase):
    """One BCF label on a topic, normalizing the former ``labels`` JSONB array.

    Written by the BCF import (``bcf/parser.py``); ``position`` preserves the
    label order from the source BCF.
    """

    __tablename__ = "bcf_topic_labels"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    topic_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("bcf_topics.id", ondelete="CASCADE"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(64), nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    topic: Mapped[BcfTopic] = relationship(back_populates="label_rows")

    __table_args__ = (
        UniqueConstraint("topic_id", "name", name="uq_bcf_topic_label"),
        Index("ix_bcf_topic_labels_topic", "topic_id"),
        Index("ix_bcf_topic_labels_name", "name"),
    )
