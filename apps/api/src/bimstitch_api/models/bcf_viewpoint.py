from __future__ import annotations

from typing import TYPE_CHECKING, Any
from uuid import UUID, uuid4

from sqlalchemy import Boolean, Float, ForeignKey, Index, Integer, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from bimstitch_api.db import TenantBase
from bimstitch_api.models._mixins import TimestampMixin

if TYPE_CHECKING:
    from bimstitch_api.models.bcf_topic import BcfTopic
    from bimstitch_api.models.project_file import ProjectFile


class BcfViewpoint(TimestampMixin, TenantBase):
    __tablename__ = "bcf_viewpoints"
    __table_args__ = (
        Index("ix_bcf_viewpoints_topic_id", "topic_id"),
        Index("ix_bcf_viewpoints_linked_file_id", "linked_file_id"),
    )

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    topic_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("bcf_topics.id", ondelete="CASCADE"),
        nullable=False,
    )
    guid: Mapped[str] = mapped_column(String(36), nullable=False)
    index_in_topic: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    camera_type: Mapped[str] = mapped_column(String(20), nullable=False)
    camera_vp_x: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    camera_vp_y: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    camera_vp_z: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    camera_dir_x: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    camera_dir_y: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    camera_dir_z: Mapped[float] = mapped_column(Float, nullable=False, default=-1.0)
    camera_up_x: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    camera_up_y: Mapped[float] = mapped_column(Float, nullable=False, default=1.0)
    camera_up_z: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    field_of_view: Mapped[float | None] = mapped_column(Float, nullable=True)
    field_of_height: Mapped[float | None] = mapped_column(Float, nullable=True)

    components: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    clipping_planes: Mapped[list[Any] | None] = mapped_column(JSONB, nullable=True)

    # Non-standard BCF extensions (ignored by standard BCF ZIP export):
    # x-ray state (xrayed element GlobalIds + opacity overrides) and
    # measurements (world-space points).
    xray: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    measurements: Mapped[list[Any] | None] = mapped_column(JSONB, nullable=True)

    snapshot_storage_key: Mapped[str | None] = mapped_column(String(512), nullable=True)

    is_2d: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    view_state_2d: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)

    linked_file_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("project_files.id", ondelete="SET NULL"),
        nullable=True,
    )

    # Relationships
    topic: Mapped[BcfTopic] = relationship("BcfTopic", back_populates="viewpoints", lazy="raise")
    linked_file: Mapped[ProjectFile | None] = relationship("ProjectFile", lazy="raise")
