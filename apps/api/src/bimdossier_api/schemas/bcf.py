from __future__ import annotations

from datetime import date, datetime
from typing import Annotated, Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

# ---------------------------------------------------------------------------
# Input-size caps (M-input). The global body limit (100 MB) is too coarse to
# bound these; an unbounded `selection`/`labels` list is a JSONB-bloat (and, for
# labels, a per-row-INSERT) amplification vector. Caps are generous for
# legitimate BCF use — large "isolate" viewpoints, polyline measures — but keep
# any single field well under the body cap.
# ---------------------------------------------------------------------------

_MAX_ELEMENT_IDS = 50_000  # GlobalId lists: selection / visibility / xray items
_MAX_MEASUREMENT_POINTS = 10_000
_MAX_MEASUREMENTS = 1_000
_MAX_CLIPPING_PLANES = 100
_MAX_2D_ANNOTATIONS = 5_000
_MAX_VISIBLE_LAYERS = 5_000
_MAX_LABELS = 50
_MAX_FINDING_IDS = 500

# IFC GlobalId is 22 chars; allow margin. `_LABEL_MAX_LEN` mirrors the
# BcfTopicLabel.name String(64) column (the routers already do `name[:64]`).
ElementId = Annotated[str, StringConstraints(max_length=64)]
LabelStr = Annotated[str, StringConstraints(max_length=64)]
LayerName = Annotated[str, StringConstraints(max_length=256)]

# ---------------------------------------------------------------------------
# Viewpoint
# ---------------------------------------------------------------------------


class Vec3Schema(BaseModel):
    x: float = 0.0
    y: float = 0.0
    z: float = 0.0


class BcfComponentsSchema(BaseModel):
    default_visibility: bool = True
    visibility_exceptions: list[ElementId] = Field(
        default_factory=list, max_length=_MAX_ELEMENT_IDS
    )
    selection: list[ElementId] = Field(default_factory=list, max_length=_MAX_ELEMENT_IDS)


class ClippingPlaneSchema(BaseModel):
    location: Vec3Schema
    direction: Vec3Schema


class XrayOpacityOverrideSchema(BaseModel):
    global_id: ElementId
    opacity: float


class XrayStateSchema(BaseModel):
    items: list[ElementId] = Field(default_factory=list, max_length=_MAX_ELEMENT_IDS)
    opacity_overrides: list[XrayOpacityOverrideSchema] = Field(
        default_factory=list, max_length=_MAX_ELEMENT_IDS
    )


class BcfMeasurementSchema(BaseModel):
    type: str = Field(max_length=30)
    points: list[Vec3Schema] = Field(default_factory=list, max_length=_MAX_MEASUREMENT_POINTS)
    height: float | None = None


class ViewState2DSchema(BaseModel):
    center_x: float = 0.0
    center_y: float = 0.0
    zoom: float = 1.0
    visible_layers: list[LayerName] = Field(default_factory=list, max_length=_MAX_VISIBLE_LAYERS)
    file_type: str = Field(default="dxf", max_length=20)
    # PDF markup extension. `page` is the 1-based page; `annotations` holds the
    # markup shapes (kept as free dicts — they are app-private and ignored by the
    # standard .bcf export). See the viewer's `Annotation2D` type.
    page: int | None = None
    annotations: list[dict[str, Any]] = Field(default_factory=list, max_length=_MAX_2D_ANNOTATIONS)


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
    clipping_planes: list[ClippingPlaneSchema] = Field(
        default_factory=list, max_length=_MAX_CLIPPING_PLANES
    )
    xray: XrayStateSchema | None = None
    measurements: list[BcfMeasurementSchema] = Field(
        default_factory=list, max_length=_MAX_MEASUREMENTS
    )
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
    xray: dict[str, Any] | None = None
    measurements: list[Any] | None = None
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
    labels: list[LabelStr] = Field(default_factory=list, max_length=_MAX_LABELS)
    due_date: date | None = None
    linked_finding_id: UUID | None = None
    linked_document_id: UUID | None = None
    # The specific document version (ProjectFile) the issue was raised against,
    # and whether this is a 2D (drawing) or 3D (IFC) issue. Both auto-derive from
    # the initial viewpoint when omitted (see routers/bcf.py::create_topic).
    linked_file_id: UUID | None = None
    is_2d: bool = False
    viewpoint: BcfViewpointCreate | None = None


class BcfTopicUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=4000)
    topic_type: str | None = Field(default=None, max_length=50)
    topic_status: str | None = Field(default=None, max_length=50)
    priority: str | None = Field(default=None, max_length=50)
    stage: str | None = Field(default=None, max_length=50)
    assigned_to: str | None = Field(default=None, max_length=255)
    labels: list[LabelStr] | None = Field(default=None, max_length=_MAX_LABELS)
    due_date: date | None = None
    linked_finding_id: UUID | None = None
    linked_document_id: UUID | None = None
    linked_file_id: UUID | None = None
    is_2d: bool | None = None


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
    linked_document_id: UUID | None
    linked_file_id: UUID | None
    is_2d: bool
    # Derived from the linked ProjectFile (version raised against) for display.
    model_version: int | None = None
    file_type: str | None = None
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
    linked_document_id: UUID | None = None
    linked_file_id: UUID | None = None
    is_2d: bool = False
    model_version: int | None = None
    file_type: str | None = None
    # Whether the topic has at least one viewpoint to jump to. Drives the
    # "go to viewpoint" button — independent of whether a snapshot image exists.
    has_viewpoint: bool = False
    snapshot_url: str | None = None
    created_at: datetime


class BcfMarkup2DItem(BaseModel):
    """A 2D markup topic projected for rendering on a PDF page.

    Returned by ``GET /bcf-topics/markup-2d?file_id=`` — one entry per topic
    whose viewpoint is 2D and linked to the given file. ``annotations`` is the
    raw markup-shape list stored in the viewpoint's ``view_state_2d``.
    """

    topic_id: UUID
    title: str
    topic_status: str
    page: int | None
    annotations: list[dict[str, Any]] = Field(default_factory=list)


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
    finding_ids: list[UUID] = Field(min_length=1, max_length=_MAX_FINDING_IDS)
