"""Request/response schemas for aligned PDF sheets.

The calibration request carries the control points in their final 2D spaces:
``pdf_points`` are the picks on the drawing and ``plan_points`` are the matching
model picks already projected into the viewer's plan space (the viewer owns that
projection + the single Y-up negation). The server only solves the pure 2D
similarity and persists it — see ``bimdossier_api.alignment.similarity``.
"""

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

# Two-element control-point lists; pydantic enforces exactly 2 via min/max length.
Point2 = tuple[float, float]


class AlignedSheetCreate(BaseModel):
    model_config = ConfigDict(from_attributes=True, protected_namespaces=())

    # The 3D document (supplies world coords) and the project Level it pins to.
    document_id: UUID
    level_id: UUID
    # The PDF document (primary_file_type='pdf') whose page is aligned.
    pdf_document_id: UUID
    page_index: int = Field(default=0, ge=0)


class AlignedSheetUpdate(BaseModel):
    model_config = ConfigDict(from_attributes=True, protected_namespaces=())

    level_id: UUID | None = None
    page_index: int | None = Field(default=None, ge=0)


class CalibrateRequest(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    # Exactly two control points on each side, in matching order.
    pdf_points: list[Point2] = Field(min_length=2, max_length=2)
    plan_points: list[Point2] = Field(min_length=2, max_length=2)
    # The exact PDF ProjectFile version the points were picked on (drift
    # detection). Optional — the client passes the version it rendered.
    pdf_file_id: UUID | None = None


class AlignedSheetRead(BaseModel):
    model_config = ConfigDict(from_attributes=True, protected_namespaces=())

    id: UUID
    project_id: UUID
    document_id: UUID
    level_id: UUID
    pdf_document_id: UUID
    calibrated_pdf_file_id: UUID | None = None
    # Logical page reference + its 1-indexed number; `page_index` (0-based) is
    # kept for back-compat and derived from the page (page_number - 1).
    page_id: UUID
    page_number: int
    page_index: int
    transform_type: str
    scale: float | None = None
    rotation_rad: float | None = None
    offset_x: float | None = None
    offset_y: float | None = None
    control_points: dict[str, Any] | None = None
    is_calibrated: bool
    # True when the calibration was solved on a PDF version that is no longer the
    # document head (drift). Computed at read time in the router; defaults False so
    # `model_validate(orm_row)` doesn't require the attribute on the ORM object.
    is_stale: bool = False
    created_at: datetime
    updated_at: datetime
