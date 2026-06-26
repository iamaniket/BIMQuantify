from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from bimdossier_api.models.document import DocumentDiscipline
from bimdossier_api.models.project_file import (
    ExtractionStatus,
    FileType,
    IfcSchema,
    ProjectFileRole,
    ProjectFileStatus,
)

_HEX_SHA256 = r"^[a-f0-9]{64}$"
_IFC_GUID = r"^[0-9A-Za-z_$]{22}$"


class InitiateUploadRequest(BaseModel):
    filename: str = Field(min_length=1, max_length=512)
    size_bytes: int = Field(ge=1)
    content_type: str = Field(min_length=1, max_length=255)
    content_sha256: str = Field(
        pattern=_HEX_SHA256,
        description="Lowercase hex SHA-256 of the raw file bytes.",
    )


class InitiateUploadResponse(BaseModel):
    file_id: UUID
    upload_url: str
    storage_key: str
    expires_in: int


class ProjectFileRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    role: ProjectFileRole
    document_id: UUID
    project_id: UUID
    version_number: int
    uploaded_by_user_id: UUID
    original_filename: str
    size_bytes: int
    content_type: str
    content_sha256: str | None
    ifc_project_guid: str | None
    file_type: FileType
    ifc_schema: IfcSchema | None
    status: ProjectFileStatus
    rejection_reason: str | None
    extraction_status: ExtractionStatus
    extraction_error: str | None
    extraction_started_at: datetime | None
    extraction_finished_at: datetime | None
    extractor_version: str | None
    detected_kind: str | None = None
    page_count: int | None = None
    created_at: datetime
    updated_at: datetime


class ProjectFileDownloadResponse(BaseModel):
    download_url: str
    expires_in: int


class ViewerBundleResponse(BaseModel):
    file_type: FileType
    fragments_url: str | None = None
    fragments_key: str | None = None
    metadata_url: str | None = None
    properties_url: str | None = None
    geometry_url: str | None = None
    outline_url: str | None = None
    floor_plans_url: str | None = None
    file_url: str | None = None
    expires_in: int


class ProjectViewerDocumentEntry(BaseModel):
    """One IFC document in a project's federated viewer manifest: the latest
    ready, extraction-succeeded IFC file for a document, with its presigned
    artifact URLs and discipline metadata. `detected_kind` is the content-based
    classification the portal uses to pick the architectural document as the 2D
    (floor-plan) source; `discipline` is the user-entered label, informational."""

    file_id: UUID
    document_id: UUID
    document_name: str
    discipline: DocumentDiscipline
    detected_kind: str | None = None
    fragments_url: str | None = None
    fragments_key: str | None = None
    metadata_url: str | None = None
    properties_url: str | None = None
    outline_url: str | None = None
    floor_plans_url: str | None = None


class ProjectViewerManifestResponse(BaseModel):
    """All viewable IFC documents in a project, for the federated multi-discipline
    viewer. Documents with no ready IFC file are omitted."""

    expires_in: int
    models: list[ProjectViewerDocumentEntry]


# ---------------------------------------------------------------------------
# Internal extractor callback
# ---------------------------------------------------------------------------


class StoreyCallbackItem(BaseModel):
    """One IfcBuildingStorey the extractor pulled from the spatial tree.

    The worker sends camelCase keys (``expressID``/``globalId``); aliases map
    them onto snake_case fields. ``global_id`` is the idempotency key for the
    per-document storey upsert in the callback handler.
    """

    model_config = ConfigDict(populate_by_name=True)

    express_id: int = Field(alias="expressID")
    global_id: str | None = Field(default=None, alias="globalId")
    name: str | None = None
    elevation: float | None = None


class ExtractionCallbackRequest(BaseModel):
    file_id: UUID
    # `organization_id` is the schema-per-tenant routing key — the worker
    # echoes it from the dispatch envelope so the API knows which tenant
    # schema to write to.
    organization_id: UUID
    # Allow `running` so the extractor can announce it has started, plus the
    # two terminal states. `queued` and `not_started` are not valid here — the
    # API owns those transitions.
    status: ExtractionStatus = Field(description="One of running, succeeded, failed.")
    job_id: UUID | None = None
    fragments_key: str | None = None
    metadata_key: str | None = None
    properties_key: str | None = None
    geometry_key: str | None = None
    outline_key: str | None = None
    floor_plans_key: str | None = None
    # Content-based discipline classification of the document, computed by the
    # extractor (architectural / structural / mep / mixed / none).
    detected_kind: str | None = None
    page_count: int | None = None
    error: str | None = None
    extractor_version: str | None = None
    started_at: datetime | None = None
    finished_at: datetime | None = None
    content_sha256: str | None = Field(default=None, pattern=_HEX_SHA256)
    ifc_project_guid: str | None = Field(default=None, pattern=_IFC_GUID)
    # 0-100 progress, sent on `running` callbacks at pipeline stage boundaries.
    progress: int | None = Field(default=None, ge=0, le=100)
    # On `failed`: whether retrying could plausibly succeed, plus a classifier tag.
    retriable: bool = False
    error_kind: str | None = None
    # IfcBuildingStorey list (IFC extraction only). Absent for PDF/DXF jobs and
    # pre-storey extractor versions; the handler upserts these onto the document.
    storeys: list[StoreyCallbackItem] | None = None
