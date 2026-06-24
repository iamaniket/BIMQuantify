"""Read schema for a building storey (level) of a 3D model."""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class StoreyRead(BaseModel):
    # `protected_namespaces=()` silences the pydantic warning about the
    # `model_id` field colliding with the `model_` protected namespace.
    model_config = ConfigDict(from_attributes=True, protected_namespaces=())

    id: UUID
    model_id: UUID
    name: str | None = None
    elevation_m: float | None = None
    ifc_guid: str | None = None
    express_id: int | None = None
    ordering: int | None = None
    created_at: datetime
    updated_at: datetime
