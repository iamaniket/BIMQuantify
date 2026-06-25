"""Read schema for a building storey (level) of a 3D model."""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class StoreyRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    document_id: UUID
    # The shared project Level this storey reconciles onto (NULL until reconciled).
    level_id: UUID | None = None
    name: str | None = None
    elevation_m: float | None = None
    ifc_guid: str | None = None
    express_id: int | None = None
    ordering: int | None = None
    created_at: datetime
    updated_at: datetime
