"""Schemas for a project Level (the shared 2D/3D spine)."""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class LevelBase(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    name: str = Field(min_length=1, max_length=255)
    elevation_m: float | None = None
    ordering: int | None = None


class LevelCreate(LevelBase):
    pass


class LevelUpdate(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    name: str | None = Field(default=None, min_length=1, max_length=255)
    elevation_m: float | None = None
    ordering: int | None = None


class LevelRead(LevelBase):
    id: UUID
    project_id: UUID
    # 'manual' (user-created) | 'ifc' (extraction-reconciled).
    source: str
    created_at: datetime
    updated_at: datetime
