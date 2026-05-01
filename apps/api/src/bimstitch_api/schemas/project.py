from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from bimstitch_api.models.project import (
    ProjectLifecycleState,
    ProjectPhase,
    ProjectStatus,
)
from bimstitch_api.models.project_member import ProjectRole


class ProjectBase(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    name: str = Field(min_length=1, max_length=255)
    description: str | None = None
    thumbnail_url: str | None = Field(default=None, max_length=2048)

    reference_code: str | None = Field(default=None, max_length=50)
    status: ProjectStatus = ProjectStatus.planning
    phase: ProjectPhase = ProjectPhase.ontwerp
    delivery_date: date | None = None

    street: str | None = Field(default=None, max_length=255)
    house_number: str | None = Field(default=None, max_length=20)
    postal_code: str | None = Field(default=None, max_length=7)
    city: str | None = Field(default=None, max_length=255)
    municipality: str | None = Field(default=None, max_length=255)
    bag_id: str | None = Field(default=None, max_length=50)
    permit_number: str | None = Field(default=None, max_length=100)

    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)

    contractor_id: UUID | None = None


class ProjectCreate(ProjectBase):
    pass


class ProjectUpdate(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = None
    thumbnail_url: str | None = Field(default=None, max_length=2048)

    reference_code: str | None = Field(default=None, max_length=50)
    status: ProjectStatus | None = None
    phase: ProjectPhase | None = None
    delivery_date: date | None = None

    street: str | None = Field(default=None, max_length=255)
    house_number: str | None = Field(default=None, max_length=20)
    postal_code: str | None = Field(default=None, max_length=7)
    city: str | None = Field(default=None, max_length=255)
    municipality: str | None = Field(default=None, max_length=255)
    bag_id: str | None = Field(default=None, max_length=50)
    permit_number: str | None = Field(default=None, max_length=100)

    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)

    contractor_id: UUID | None = None


class ProjectRead(ProjectBase):
    id: UUID
    organization_id: UUID
    owner_id: UUID
    lifecycle_state: ProjectLifecycleState
    created_at: datetime
    updated_at: datetime
    contractor_name: str | None = None


class ProjectMemberRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    project_id: UUID
    user_id: UUID
    role: ProjectRole
    created_at: datetime


class ProjectMemberCreate(BaseModel):
    user_id: UUID
    role: ProjectRole = ProjectRole.viewer


class ProjectMemberUpdate(BaseModel):
    role: ProjectRole
