"""Response schemas for the element-inspections endpoint (backlog #49).

Maps an IFC element (by ``global_id`` + ``file_id``) to the checklist items
linked to that element, together with their inspection results (if any).
"""

from uuid import UUID

from pydantic import BaseModel, ConfigDict

from bimstitch_api.models.borgingsmoment import BorgingsmomentPhase, BorgingsmomentStatus
from bimstitch_api.schemas.borgingsplan import ChecklistItemRead
from bimstitch_api.schemas.inspection import ChecklistItemResultRead


class ElementInspectionItem(BaseModel):
    """One checklist item linked to the queried IFC element, together with
    its parent moment context and optional inspection result."""

    model_config = ConfigDict(from_attributes=True)

    checklist_item: ChecklistItemRead
    result: ChecklistItemResultRead | None
    moment_name: str
    moment_phase: BorgingsmomentPhase
    moment_status: BorgingsmomentStatus


class ElementInspectionsResponse(BaseModel):
    """Aggregate response grouping all checklist items linked to a single IFC
    element in a specific file."""

    items: list[ElementInspectionItem]
    element_global_id: str
    file_id: UUID
