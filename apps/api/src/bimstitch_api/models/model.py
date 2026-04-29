from enum import StrEnum
from typing import TYPE_CHECKING
from uuid import UUID, uuid4

from sqlalchemy import Enum as SAEnum
from sqlalchemy import ForeignKey, Index, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from bimstitch_api.db import Base
from bimstitch_api.models._mixins import TimestampMixin

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


class Model(TimestampMixin, Base):
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

    project: Mapped["Project"] = relationship(back_populates="models")
    files: Mapped[list["ProjectFile"]] = relationship(
        back_populates="model",
        cascade="all, delete-orphan",
        order_by="ProjectFile.version_number.desc()",
    )

    __table_args__ = (
        UniqueConstraint("project_id", "name", name="uq_models_project_name"),
        Index("ix_models_project_id", "project_id"),
        Index("ix_models_status", "status"),
    )
