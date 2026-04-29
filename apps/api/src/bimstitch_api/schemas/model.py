from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from bimstitch_api.models.model import ModelDiscipline, ModelStatus
from bimstitch_api.schemas.project_file import ProjectFileRead


class ModelBase(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    name: str = Field(min_length=1, max_length=255)
    discipline: ModelDiscipline
    status: ModelStatus = ModelStatus.active


class ModelCreate(ModelBase):
    pass


class ModelUpdate(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    name: str | None = Field(default=None, min_length=1, max_length=255)
    discipline: ModelDiscipline | None = None
    status: ModelStatus | None = None


class ModelRead(ModelBase):
    id: UUID
    project_id: UUID
    created_at: datetime
    updated_at: datetime


class ModelWithVersions(ModelRead):
    versions: list[ProjectFileRead]
