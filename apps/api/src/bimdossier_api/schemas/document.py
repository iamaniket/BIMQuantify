from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from bimdossier_api.models.document import DocumentDiscipline, DocumentStatus
from bimdossier_api.models.project_file import FileType
from bimdossier_api.schemas.project_file import ProjectFileRead


class DocumentBase(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    name: str = Field(min_length=1, max_length=255)
    discipline: DocumentDiscipline
    status: DocumentStatus = DocumentStatus.active


class DocumentCreate(DocumentBase):
    # Discipline is optional at creation — it defaults to "other" ("not specified
    # yet") and the user sets the real value later from the document row. See
    # routers/documents.update_document.
    discipline: DocumentDiscipline = DocumentDiscipline.other


class DocumentUpdate(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    name: str | None = Field(default=None, min_length=1, max_length=255)
    discipline: DocumentDiscipline | None = None
    status: DocumentStatus | None = None
    # Assign / move a 2D drawing document to a project Level (or detach with
    # null). Rejected for IFC documents — see routers/documents.update_document.
    level_id: UUID | None = None


class DocumentRead(DocumentBase):
    id: UUID
    project_id: UUID
    primary_file_type: FileType | None = None
    # The project Level a 2D drawing belongs to (NULL = Unassigned / IFC).
    level_id: UUID | None = None
    # Current-revision pointer. NULL means the head is the newest version; when
    # set, the portal targets this file as the document's head (view / compliance
    # / version-history "current" badge). See F7 restore-version-as-head.
    head_file_id: UUID | None = None
    created_at: datetime
    updated_at: datetime


class DocumentWithVersions(DocumentRead):
    versions: list[ProjectFileRead]
