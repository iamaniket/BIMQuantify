"""Data structures for parsed BCF archives.

These are plain dataclasses — no DB or FastAPI dependency — so the parser
and generator modules stay testable in isolation.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from datetime import datetime


@dataclass
class Vec3:
    x: float = 0.0
    y: float = 0.0
    z: float = 0.0


@dataclass
class ClippingPlane:
    location: Vec3
    direction: Vec3


@dataclass
class BcfComponents:
    """BCF component visibility / selection / coloring block."""

    default_visibility: bool = True
    visibility_exceptions: list[str] = field(default_factory=list)
    selection: list[str] = field(default_factory=list)
    coloring: list[dict[str, object]] = field(default_factory=list)


@dataclass
class ViewState2D:
    center_x: float = 0.0
    center_y: float = 0.0
    zoom: float = 1.0
    visible_layers: list[str] = field(default_factory=list)
    file_type: str = "dxf"


@dataclass
class ParsedViewpoint:
    guid: str
    index: int = 0

    camera_type: str = "perspective"
    camera_view_point: Vec3 = field(default_factory=Vec3)
    camera_direction: Vec3 = field(default_factory=Vec3)
    camera_up_vector: Vec3 = field(default_factory=lambda: Vec3(0, 1, 0))
    field_of_view: float | None = None
    field_of_height: float | None = None

    components: BcfComponents | None = None
    clipping_planes: list[ClippingPlane] = field(default_factory=list)

    snapshot_data: bytes | None = None

    is_2d: bool = False
    view_state_2d: ViewState2D | None = None


@dataclass
class ParsedComment:
    guid: str
    text: str
    author: str
    date: datetime
    modified_author: str | None = None
    modified_date: datetime | None = None
    viewpoint_guid: str | None = None


@dataclass
class ParsedTopic:
    guid: str
    title: str
    description: str = ""
    topic_type: str = "Issue"
    topic_status: str = "Open"
    priority: str | None = None
    stage: str | None = None
    assigned_to: str | None = None
    labels: list[str] = field(default_factory=list)
    due_date: str | None = None
    creation_author: str = ""
    creation_date: datetime | None = None
    modified_author: str | None = None
    modified_date: datetime | None = None

    viewpoints: list[ParsedViewpoint] = field(default_factory=list)
    comments: list[ParsedComment] = field(default_factory=list)

    # Preserved for round-trip: references to IFC files by GUID.
    reference_links: list[str] = field(default_factory=list)


@dataclass
class ParsedBcf:
    version: str  # "2.1" or "3.0"
    topics: list[ParsedTopic] = field(default_factory=list)
