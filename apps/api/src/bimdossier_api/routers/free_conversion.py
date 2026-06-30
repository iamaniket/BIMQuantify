"""Free → paid conversion (pool → silo).

The explicit upgrade action (D7): inside a real project a user imports a free
container they built. We copy the HEAD version's raw IFC into the project's
storage namespace, create a `Document` + `ProjectFile`, run the NORMAL tenant
extraction (the free fragments are NOT reused — re-extraction at the paid
threshold of 1 guarantees first-class storeys/geometry), map the free snags to
real `findings`, and stamp the head `pooled_project_files.converted_to_file_id` so
a re-import is a no-op. Only the head version is copied — re-extraction makes
copying older versions pointless.

Idempotency + concurrency: the head free file row is `SELECT ... FOR UPDATE`
locked for the whole import transaction, so two concurrent imports serialize and
the second sees `converted_to_file_id` already set and no-ops. The free rows live
in `public` and are reachable from the tenant session (search_path includes
public), and the owner-keyed free RLS — fed by the `app.current_user_id` GUC the
tenant session also sets — scopes them to the caller.

Not gated on FREE_TIER_ENABLED: turning the wedge off must not trap a free
user's data — converting it to a paid project is exactly the funnel we want to
keep open.
"""

import os
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy import select, update

from bimdossier_api.access import (
    load_project_or_404,
    require_membership,
    require_project_writable,
)
from bimdossier_api.auth.fastapi_users import current_verified_user
from bimdossier_api.auth.permissions import Action, Resource, require_permission
from bimdossier_api.config import Settings, get_settings
from bimdossier_api.jobs import DispatchJobError, dispatch_job
from bimdossier_api.models.document import Document, DocumentDiscipline, DocumentStatus
from bimdossier_api.models.finding import Finding, FindingSeverity, FindingStatus
from bimdossier_api.models.free_document import PooledDocument
from bimdossier_api.models.free_finding import PooledFinding
from bimdossier_api.models.free_project_file import PooledProjectFile
from bimdossier_api.models.job import Job, JobStatus, JobType
from bimdossier_api.models.project_file import (
    ExtractionStatus,
    FileType,
    IfcSchema,
    ProjectFile,
    ProjectFileRole,
    ProjectFileStatus,
)
from bimdossier_api.models.user import User
from bimdossier_api.storage import StorageBackend, get_storage
from bimdossier_api.storage.scoping import assert_free_key_scoped
from bimdossier_api.tenancy import open_tenant_session, require_active_organization

router = APIRouter(tags=["free-conversion"])



class ImportFreeModelRequest(BaseModel):
    # The free container (PooledDocument) to import; its HEAD version is copied.
    pooled_document_id: UUID


class ImportFreeModelResponse(BaseModel):
    document_id: UUID
    file_id: UUID
    findings_created: int


def _map_free_finding_to_finding(
    snag: PooledFinding,
    *,
    project_id: UUID,
    document_id: UUID,
    file_id: UUID,
    user_id: UUID,
) -> Finding:
    """Translate a free snag into a tenant finding.

    Severity codes are value-identical (low/medium/high → FindingSeverity). The
    world-space anchor (`anchor_x/y/z`, meters) and the IFC `GlobalId` carry over
    directly — both are stable across re-extraction (the higher free geometry
    threshold changes which elements are meshed, never world coordinates), so the
    finding re-resolves onto the re-extracted model via (document, GlobalId)."""
    try:
        severity = FindingSeverity(snag.severity)
    except ValueError:
        severity = FindingSeverity.medium
    # Free snag status is value-identical to FindingStatus (the free board reuses
    # the paid lifecycle), so this is a 1:1 map with a safe fallback.
    try:
        finding_status = FindingStatus(snag.status)
    except ValueError:
        finding_status = FindingStatus.open
    return Finding(
        project_id=project_id,
        title=snag.title,
        # Finding.description is non-empty (FindingRead requires min_length=1);
        # free notes are optional, so fall back to the title.
        description=snag.note or snag.title,
        severity=severity,
        status=finding_status,
        created_by_user_id=user_id,
        # Carry assignment as-is: assigned_to_user_id references public.users
        # (global), so the FK is valid in the tenant schema. The assignee may not
        # yet be a member of the destination paid org/project — that's acceptable
        # (lossless; the importer can re-assign), and dropping it would lose data.
        assignee_user_id=snag.assigned_to_user_id,
        deadline_date=snag.deadline_date,
        linked_document_id=document_id,
        linked_file_id=file_id,
        linked_element_global_id=snag.linked_element_global_id,
        linked_file_type="ifc",
        anchor_x=snag.anchor_x,
        anchor_y=snag.anchor_y,
        anchor_z=snag.anchor_z,
        anchor_page=snag.anchor_page,
    )


@router.post(
    "/projects/{project_id}/import-free-model",
    response_model=ImportFreeModelResponse,
)
async def import_free_model(
    project_id: UUID,
    payload: ImportFreeModelRequest,
    request: Request,
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
    storage: StorageBackend = Depends(get_storage),
    settings: Settings = Depends(get_settings),
) -> ImportFreeModelResponse:
    schema: str = request.state.active_schema
    # Pre-mint the IDs so the destination key is known before any DB write; the
    # S3 copy is the last I/O before commit so a copy failure rolls the rows back
    # rather than orphaning them.
    document_id = uuid4()
    file_id = uuid4()

    async with open_tenant_session(schema, active_org_id, user.id) as session:
        project = await load_project_or_404(session, project_id)
        membership = await require_membership(session, project.id, user.id)
        require_permission(membership.role, Resource.document, Action.create)
        require_project_writable(project)

        # Load the free container (owner-scoped) and resolve its HEAD version: the
        # head_file_id pointer when set + still importable, else the newest
        # ready + extraction-succeeded version.
        document = (
            await session.execute(
                select(PooledDocument).where(
                    PooledDocument.id == payload.pooled_document_id,
                    PooledDocument.owner_user_id == user.id,
                    PooledDocument.deleted_at.is_(None),
                )
            )
        ).scalar_one_or_none()
        if document is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="FREE_DOCUMENT_NOT_FOUND"
            )
        candidates = list(
            (
                await session.execute(
                    select(PooledProjectFile)
                    .where(
                        PooledProjectFile.pooled_document_id == document.id,
                        PooledProjectFile.status == "ready",
                        PooledProjectFile.extraction_status == "succeeded",
                        PooledProjectFile.deleted_at.is_(None),
                    )
                    .order_by(PooledProjectFile.version_number.desc())
                )
            )
            .scalars()
            .all()
        )
        head_id = document.head_file_id
        if head_id is None or not any(c.id == head_id for c in candidates):
            head_id = candidates[0].id if candidates else None
        if head_id is None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail="NO_IMPORTABLE_VERSION"
            )

        # Lock the head file for the whole txn — serializes concurrent imports and
        # makes the converted_to_file_id idempotency check race-free.
        free = await session.get(PooledProjectFile, head_id, with_for_update=True)
        if free is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="FREE_DOCUMENT_NOT_FOUND"
            )
        if free.converted_to_file_id is not None:
            # Already imported — idempotent no-op.
            return ImportFreeModelResponse(
                document_id=document_id,
                file_id=free.converted_to_file_id,
                findings_created=0,
            )

        ext = os.path.splitext(free.storage_key)[1].lower() or ".ifc"
        new_key = f"projects/{project.id}/documents/{document_id}/{uuid4()}{ext}"

        ifc_schema: IfcSchema | None = None
        if free.ifc_schema:
            try:
                ifc_schema = IfcSchema(free.ifc_schema)
            except ValueError:
                ifc_schema = None

        session.add(
            Document(
                id=document_id,
                project_id=project.id,
                name=document.name,
                discipline=DocumentDiscipline.architectural,
                status=DocumentStatus.active,
                primary_file_type=FileType.ifc,
            )
        )
        session.add(
            ProjectFile(
                id=file_id,
                project_id=project.id,
                role=ProjectFileRole.model_source,
                document_id=document_id,
                version_number=1,
                uploaded_by_user_id=user.id,
                storage_key=new_key,
                original_filename=free.original_filename,
                size_bytes=free.size_bytes,
                content_type="application/octet-stream",
                content_sha256=free.content_sha256,
                file_type=FileType.ifc,
                status=ProjectFileStatus.ready,
                extraction_status=ExtractionStatus.queued,
                ifc_schema=ifc_schema,
            )
        )
        # Flush so the Document + ProjectFile rows exist before the Job FK
        # (file_id) and the findings' linked_file_id/document_id reference them.
        await session.flush()

        job = Job(
            project_id=project.id,
            file_id=file_id,
            job_type=JobType.ifc_extraction,
            status=JobStatus.pending,
            payload={
                "file_id": str(file_id),
                "project_id": str(project.id),
                "storage_key": new_key,
                "compressed": ext == ".ifczip",
                "discipline": DocumentDiscipline.architectural.value,
            },
            created_by_user_id=user.id,
        )
        session.add(job)

        # Map snags → findings (v1). RLS scopes the snag read to the owner.
        snags = (
            await session.execute(
                select(PooledFinding).where(PooledFinding.pooled_document_id == document.id)
            )
        ).scalars().all()
        for snag in snags:
            session.add(
                _map_free_finding_to_finding(
                    snag,
                    project_id=project.id,
                    document_id=document_id,
                    file_id=file_id,
                    user_id=user.id,
                )
            )

        free.converted_to_file_id = file_id
        await session.flush()

        # Last I/O before commit: server-side copy of the raw IFC into the
        # project namespace. Free + tenant IFC share one bucket (s3_bucket_ifc),
        # so copy_object's single-bucket signature is sufficient. A failure here
        # rolls back every row above (nothing was committed yet).
        #
        # Re-assert the source key is scoped to the caller's free namespace before
        # it crosses into the tenant bucket prefix — this is the one place a pooled
        # free key is copied into a silo, so it goes through the storage/scoping.py
        # choke-point (defense-in-depth over the owner-scoped RLS read of `free`).
        assert_free_key_scoped(free.storage_key, user.id)
        await storage.copy_object(free.storage_key, new_key)
        findings_created = len(snags)

    # Post-commit dispatch (the rows are durable; a dispatch failure just marks
    # the file's extraction failed and leaves the free copy intact for retry).
    try:
        await dispatch_job(job, settings, active_org_id)
    except DispatchJobError as exc:
        async with open_tenant_session(schema, active_org_id, user.id) as session:
            await session.execute(
                update(ProjectFile)
                .where(ProjectFile.id == file_id)
                .values(extraction_status=ExtractionStatus.failed)
            )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY, detail="PROCESSOR_UNREACHABLE"
        ) from exc

    return ImportFreeModelResponse(
        document_id=document_id,
        file_id=file_id,
        findings_created=findings_created,
    )
