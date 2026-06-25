from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from bimdossier_api.models.project import (
    BuildingType,
    ProjectLifecycleState,
    ProjectPhase,
)
from bimdossier_api.models.project_member import ProjectRole


class ProjectBase(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    name: str = Field(min_length=1, max_length=255)
    description: str | None = None
    thumbnail_url: str | None = Field(default=None, max_length=2048)

    reference_code: str | None = Field(default=None, max_length=50)
    phase: ProjectPhase = ProjectPhase.design
    # ISO 3166-1 alpha-2. NL is the only registered jurisdiction today.
    # The server validates this against the jurisdictions registry; an
    # unregistered country is rejected with 422.
    country: str = Field(default="NL", min_length=2, max_length=2)
    delivery_date: date | None = None
    planned_start_date: date | None = None

    # Building classification. Codes are jurisdiction-neutral; the portal
    # renders localized labels via the /jurisdictions endpoint.
    building_type: BuildingType | None = None

    street: str | None = Field(default=None, max_length=255)
    house_number: str | None = Field(default=None, max_length=20)
    postal_code: str | None = Field(default=None, max_length=7)
    city: str | None = Field(default=None, max_length=255)
    municipality: str | None = Field(default=None, max_length=255)
    bag_id: str | None = Field(default=None, max_length=50)
    permit_number: str | None = Field(default=None, max_length=100)

    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)


class ProjectCreate(ProjectBase):
    pass


class ProjectUpdate(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = None
    thumbnail_url: str | None = Field(default=None, max_length=2048)

    reference_code: str | None = Field(default=None, max_length=50)
    phase: ProjectPhase | None = None
    country: str | None = Field(default=None, min_length=2, max_length=2)
    delivery_date: date | None = None
    planned_start_date: date | None = None

    building_type: BuildingType | None = None

    street: str | None = Field(default=None, max_length=255)
    house_number: str | None = Field(default=None, max_length=20)
    postal_code: str | None = Field(default=None, max_length=7)
    city: str | None = Field(default=None, max_length=255)
    municipality: str | None = Field(default=None, max_length=255)
    bag_id: str | None = Field(default=None, max_length=50)
    permit_number: str | None = Field(default=None, max_length=100)

    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)


class ProjectRead(ProjectBase):
    id: UUID
    owner_id: UUID
    lifecycle_state: ProjectLifecycleState
    created_at: datetime
    updated_at: datetime
    # The requesting caller's own role on this project, so the portal can gate
    # its UI against the permission matrix without a second members fetch.
    # None when the caller reaches the project via an admin/superuser bypass
    # rather than a project_members row (the portal then falls back to its
    # org-admin flag).
    my_role: ProjectRole | None = None


class ProjectMemberRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    project_id: UUID
    user_id: UUID
    role: ProjectRole
    created_at: datetime
    # Denormalized from public.users so the portal can render the row without
    # a second lookup. Email is always present (NOT NULL in DB); full_name is
    # nullable because users can sign up without providing one.
    email: str
    full_name: str | None = None


class ProjectMemberCreate(BaseModel):
    user_id: UUID
    role: ProjectRole = ProjectRole.viewer


class ProjectMemberUpdate(BaseModel):
    role: ProjectRole


class ProjectInvitationCreate(BaseModel):
    email: EmailStr
    role: ProjectRole = ProjectRole.viewer
    full_name: str | None = Field(default=None, max_length=255)


class ProjectInvitationResponse(BaseModel):
    email: str
    role: ProjectRole
    project_id: UUID
    scenario: str
    user_id: UUID
