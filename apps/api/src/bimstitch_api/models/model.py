from enum import StrEnum
from typing import TYPE_CHECKING
from uuid import UUID, uuid4

from sqlalchemy import Enum as SAEnum
from sqlalchemy import ForeignKey, Index, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from bimstitch_api.db import TenantBase
from bimstitch_api.models._mixins import SoftDeleteMixin, TimestampMixin
from bimstitch_api.models.project_file import FileType

if TYPE_CHECKING:
    from bimstitch_api.models.project import Project
    from bimstitch_api.models.project_file import ProjectFile


class ModelDiscipline(StrEnum):
    architectural = "architectural"
    structural = "structural"
    mep = "mep"
    coordination = "coordination"
    other = "other"


class ModelStatus(StrEnum):
    draft = "draft"
    active = "active"
    archived = "archived"


class Model(TimestampMixin, SoftDeleteMixin, TenantBase):
    __tablename__ = "models"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    project_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    discipline: Mapped[ModelDiscipline] = mapped_column(
        SAEnum(
            ModelDiscipline,
            name="modeldiscipline",
            values_callable=lambda enum: [m.value for m in enum],
        ),
        nullable=False,
    )
    status: Mapped[ModelStatus] = mapped_column(
        SAEnum(
            ModelStatus,
            name="modelstatus",
            values_callable=lambda enum: [m.value for m in enum],
        ),
        nullable=False,
        default=ModelStatus.active,
        server_default=ModelStatus.active.value,
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
    # Current-revision pointer (F7 "restore version as head"). NULL = the head is
    # derived as the highest version_number (default behaviour); when set it pins
    # the head to a chosen older version. Kept as a plain column with NO ORM
    # relationship to avoid mutual-FK flush-ordering hazards (project_files
    # already points back at models via model_id). Resolution lives in
    # `routers/project_files._shared.resolve_head_file_id`. ON DELETE SET NULL so
    # deleting the pinned version cleanly reverts the head to newest.
    head_file_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        # `use_alter` breaks the models <-> project_files FK cycle
        # (project_files.model_id already points back here): the constraint is
        # emitted as a separate ALTER so create_all / drop_all can order the two
        # tables. Named so the ALTER is deterministic.
        ForeignKey(
            "project_files.id",
            ondelete="SET NULL",
            use_alter=True,
            name="fk_models_head_file_id",
        ),
        nullable=True,
    )

    project: Mapped["Project"] = relationship(back_populates="models")
    files: Mapped[list["ProjectFile"]] = relationship(
        back_populates="model",
        foreign_keys="ProjectFile.model_id",
        cascade="all, delete-orphan",
        order_by="ProjectFile.version_number.desc()",
    )

    __table_args__ = (
        UniqueConstraint("project_id", "name", name="uq_models_project_name"),
        Index("ix_models_project_id", "project_id"),
        Index("ix_models_status", "status"),
    )
