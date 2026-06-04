from __future__ import annotations

from typing import TYPE_CHECKING

from pydantic import BaseModel, ConfigDict, Field

if TYPE_CHECKING:
    from datetime import date, datetime
    from uuid import UUID

# ---------------------------------------------------------------------------
# Viewpoint
# ---------------------------------------------------------------------------


class Vec3Schema(BaseModel):
    x: float = 0.0
    y: float = 0.0
    z: float = 0.0


class BcfComponentsSchema(BaseModel):
    default_visibility: bool = True
    visibility_exceptions: list[str] = Field(default_factory=list)
    selection: list[str] = Field(default_factory=list)


class ClippingPlaneSchema(BaseModel):
    location: Vec3Schema
    direction: Vec3Schema


class ViewState2DSchema(BaseModel):
    center_x: float = 0.0
    center_y: float = 0.0
    zoom: float = 1.0
    visible_layers: list[str] = Field(default_factory=list)
    file_type: str = "dxf"


class BcfViewpointCreate(BaseModel):
    guid: str = Field(max_length=36)
    index_in_topic: int = 0
    camera_type: str = Field(max_length=20)
    camera_view_point: Vec3Schema
    camera_direction: Vec3Schema
    camera_up_vector: Vec3Schema
    field_of_view: float | None = None
    field_of_height: float | None = None
    components: BcfComponentsSchema | None = None
    clipping_planes: list[ClippingPlaneSchema] = Field(default_factory=list)
    is_2d: bool = False
    view_state_2d: ViewState2DSchema | None = None
    linked_file_id: UUID | None = None


class BcfViewpointRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    guid: str
    index_in_topic: int
    camera_type: str
    camera_view_point: dict[str, float]
    camera_direction: dict[str, float]
    camera_up_vector: dict[str, float]
    field_of_view: float | None
    field_of_height: float | None
    components: dict | None
    clipping_planes: list | None
    snapshot_url: str | None = None
    is_2d: bool
    view_state_2d: dict | None
    linked_file_id: UUID | None
    created_at: datetime


# ---------------------------------------------------------------------------
# Comment
# ---------------------------------------------------------------------------


class BcfCommentCreate(BaseModel):
    text: str = Field(min_length=1, max_length=4000)
    viewpoint_guid: str | None = Field(default=None, max_length=36)


class BcfCommentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    guid: str
    comment_text: str
    author: str
    date: datetime
    modified_author: str | None
    modified_date: datetime | None
    viewpoint_guid: str | None
    created_by_user_id: UUID | None
    created_at: datetime


# ---------------------------------------------------------------------------
# Topic
# ---------------------------------------------------------------------------


class BcfTopicCreate(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=4000)
    topic_type: str = Field(default="Issue", max_length=50)
    topic_status: str = Field(default="Open", max_length=50)
    priority: str | None = Field(default=None, max_length=50)
    stage: str | None = Field(default=None, max_length=50)
    assigned_to: str | None = Field(default=None, max_length=255)
    labels: list[str] = Field(default_factory=list)
    due_date: date | None = None
    linked_finding_id: UUID | None = None
    linked_model_id: UUID | None = None
    viewpoint: BcfViewpointCreate | None = None


class BcfTopicUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=4000)
    topic_type: str | None = Field(default=None, max_length=50)
    topic_status: str | None = Field(default=None, max_length=50)
    priority: str | None = Field(default=None, max_length=50)
    stage: str | None = Field(default=None, max_length=50)
    assigned_to: str | None = Field(default=None, max_length=255)
    labels: list[str] | None = None
    due_date: date | None = None
    linked_finding_id: UUID | None = None
    linked_model_id: UUID | None = None


class BcfTopicRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    project_id: UUID
    guid: str
    title: str
    description: str | None
    topic_type: str
    topic_status: str
    priority: str | None
    stage: str | None
    assigned_to: str | None
    labels: list[str] | None
    due_date: date | None
    creation_author: str
    creation_date: datetime
    modified_author: str | None
    modified_date: datetime | None
    linked_finding_id: UUID | None
    linked_model_id: UUID | None
    created_by_user_id: UUID
    bcf_version: str
    import_source: str | None
    created_at: datetime
    updated_at: datetime

    viewpoints: list[BcfViewpointRead] = Field(default_factory=list)
    comments: list[BcfCommentRead] = Field(default_factory=list)


class BcfTopicSummary(BaseModel):
    """Lightweight read model for topic list (no nested viewpoints/comments)."""
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    guid: str
    title: str
    topic_type: str
    topic_status: str
    priority: str | None
    assigned_to: str | None
    creation_author: str
    creation_date: datetime
    linked_finding_id: UUID | None
    snapshot_url: str | None = None
    created_at: datetime


# ---------------------------------------------------------------------------
# Import / Export
# ---------------------------------------------------------------------------


class BcfImportResponse(BaseModel):
    imported_count: int
    topics: list[BcfTopicRead]
    warnings: list[str] = Field(default_factory=list)


class BcfExportResponse(BaseModel):
    download_url: str
    filename: str


class BcfLinkFindingRequest(BaseModel):
    finding_id: UUID


class BcfFromFindingsRequest(BaseModel):
    finding_ids: list[UUID] = Field(min_length=1)
