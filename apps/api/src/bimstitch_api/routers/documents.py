"""Project-level document storage.

Two-phase presigned upload (same pattern as project_files): initiate → browser
PUT → complete. Documents are project-scoped (not model-scoped) and support all
file types (images, video, audio, office docs). Every mutation writes an audit
entry in the same transaction.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from bimstitch_api import audit
from bimstitch_api.auth.fastapi_users import current_verified_user
from bimstitch_api.auth.permissions import Action, Resource, require_permission
from bimstitch_api.config import Settings, get_settings
from bimstitch_api.models.document import (
    DOCUMENT_ALLOWED_EXTENSIONS,
    Document,
    DocumentCategory,
    DocumentStatus,
)
from bimstitch_api.models.user import User
from bimstitch_api.routers.projects import (
    _load_project_or_404,
    _require_membership,
    _require_project_read_access,
    _require_project_writable,
)
from bimstitch_api.schemas.document import (
    DocumentDownloadResponse,
    DocumentInitiateRequest,
    DocumentInitiateResponse,
    DocumentRead,
    DocumentUpdateRequest,
)
from bimstitch_api.storage import StorageBackend, get_documents_bucket, get_storage
from bimstitch_api.storage.minio import ObjectNotFoundError
from bimstitch_api.tenancy import get_tenant_session, require_active_organization

router = APIRouter(prefix="/projects/{project_id}/documents", tags=["documents"])


def _document_snapshot(doc: Document) -> dict:
    return {
        "original_filename": doc.original_filename,
        "size_bytes": doc.size_bytes,
        "content_type": doc.content_type,
        "document_category": doc.document_category.value,
        "status": doc.status.value,
        "description": doc.description,
        "linked_element_global_id": doc.linked_element_global_id,
        "linked_model_id": str(doc.linked_model_id) if doc.linked_model_id else None,
        "linked_file_id": str(doc.linked_file_id) if doc.linked_file_id else None,
        "linked_point": doc.linked_point,
        "capture_link_id": str(doc.capture_link_id) if doc.capture_link_id else None,
    }


async def _load_document_or_404(
    session: AsyncSession, project_id: UUID, document_id: UUID
) -> Document:
    doc = (
        await session.execute(
            select(Document).where(
                Document.id == document_id,
                Document.project_id == project_id,
                Document.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if doc is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="DOCUMENT_NOT_FOUND")
    return doc


@router.post("/initiate", response_model=DocumentInitiateResponse, status_code=status.HTTP_201_CREATED)
async def initiate_document_upload(
    project_id: UUID,
    payload: DocumentInitiateRequest,
    request: Request,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
    storage: StorageBackend = Depends(get_storage),
    settings: Settings = Depends(get_settings),
) -> DocumentInitiateResponse:
    project = await _load_project_or_404(session, project_id)
    membership = await _require_membership(session, project.id, user.id)
    try:
        require_permission(membership.role, Resource.document, Action.create)
    except HTTPException:
        await audit.log_permission_denied(
            role=membership.role.value,
            resource=Resource.document.value,
            action=Action.create.value,
            actor_user_id=user.id,
            organization_id=active_org_id,
            request=request,
        )
        raise
    _require_project_writable(project)

    fname_lower = payload.filename.lower()
    dot_pos = fname_lower.rfind(".")
    ext = fname_lower[dot_pos:] if dot_pos >= 0 else ""
    category = DOCUMENT_ALLOWED_EXTENSIONS.get(ext)
    if category is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "code": "INVALID_FILE_EXTENSION",
                "allowed": sorted(DOCUMENT_ALLOWED_EXTENSIONS.keys()),
            },
        )

    if payload.size_bytes > settings.document_max_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail={
                "code": "FILE_TOO_LARGE",
                "max_bytes": settings.document_max_bytes,
            },
        )

    existing = (
        await session.execute(
            select(Document).where(
                Document.project_id == project.id,
                Document.content_sha256 == payload.content_sha256,
                Document.status.in_([DocumentStatus.pending, DocumentStatus.ready]),
                Document.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "DUPLICATE_CONTENT",
                "existing_document_id": str(existing.id),
                "existing_filename": existing.original_filename,
            },
        )

    storage_key = f"projects/{project.id}/documents/{uuid4()}{ext}"
    bucket = get_documents_bucket()

    doc = Document(
        project_id=project.id,
        uploaded_by_user_id=user.id,
        storage_key=storage_key,
        original_filename=payload.filename,
        size_bytes=payload.size_bytes,
        content_type=payload.content_type,
        content_sha256=payload.content_sha256,
        document_category=category,
        status=DocumentStatus.pending,
        description=payload.description,
        linked_element_global_id=payload.linked_element_global_id,
        linked_model_id=payload.linked_model_id,
        linked_point=payload.linked_point,
        linked_file_id=payload.linked_file_id,
    )
    session.add(doc)
    await session.flush()
    await session.refresh(doc)

    upload_url = await storage.presigned_put_url(
        storage_key, payload.content_type, payload.size_bytes, bucket=bucket
    )

    await audit.record(
        session,
        action="document.initiated",
        resource_type="documents",
        resource_id=doc.id,
        after=_document_snapshot(doc),
        actor_user_id=user.id,
        organization_id=active_org_id,
        request=request,
    )

    return DocumentInitiateResponse(
        document_id=doc.id,
        upload_url=upload_url,
        storage_key=storage_key,
        expires_in=storage.presign_ttl,
    )


@router.post("/{document_id}/complete", response_model=DocumentRead)
async def complete_document_upload(
    project_id: UUID,
    document_id: UUID,
    request: Request,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
    storage: StorageBackend = Depends(get_storage),
) -> Document:
    project = await _load_project_or_404(session, project_id)
    membership = await _require_membership(session, project.id, user.id)
    try:
        require_permission(membership.role, Resource.document, Action.create)
    except HTTPException:
        await audit.log_permission_denied(
            role=membership.role.value,
            resource=Resource.document.value,
            action=Action.create.value,
            actor_user_id=user.id,
            organization_id=active_org_id,
            request=request,
        )
        raise

    doc = await _load_document_or_404(session, project.id, document_id)
    if doc.status != DocumentStatus.pending:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="DOCUMENT_NOT_PENDING",
        )

    bucket = get_documents_bucket()
    try:
        head = await storage.head_object(doc.storage_key, bucket=bucket)
    except ObjectNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="OBJECT_NOT_UPLOADED",
        )

    actual_size = head.get("ContentLength", 0)
    if actual_size != doc.size_bytes:
        doc.status = DocumentStatus.rejected
        doc.rejection_reason = "SIZE_MISMATCH"
        await session.flush()
        await audit.record(
            session,
            action="document.rejected",
            resource_type="documents",
            resource_id=doc.id,
            after={"status": "rejected", "rejection_reason": "SIZE_MISMATCH"},
            actor_user_id=user.id,
            organization_id=active_org_id,
            request=request,
        )
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="SIZE_MISMATCH",
        )

    before = {"status": doc.status.value}
    doc.status = DocumentStatus.ready
    await session.flush()
    await session.refresh(doc)

    await audit.record(
        session,
        action="document.completed",
        resource_type="documents",
        resource_id=doc.id,
        before=before,
        after=_document_snapshot(doc),
        actor_user_id=user.id,
        organization_id=active_org_id,
        request=request,
    )
    return doc


@router.get("", response_model=list[DocumentRead])
async def list_documents(
    project_id: UUID,
    category: Annotated[DocumentCategory | None, Query()] = None,
    linked_element_global_id: Annotated[str | None, Query(max_length=22)] = None,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> list[Document]:
    project = await _load_project_or_404(session, project_id)
    await _require_project_read_access(session, project.id, user, active_org_id)

    stmt = (
        select(Document)
        .where(
            Document.project_id == project.id,
            Document.status == DocumentStatus.ready,
            Document.deleted_at.is_(None),
        )
        .order_by(Document.created_at.desc())
    )
    if category is not None:
        stmt = stmt.where(Document.document_category == category)
    if linked_element_global_id is not None:
        stmt = stmt.where(Document.linked_element_global_id == linked_element_global_id)

    result = await session.execute(stmt)
    return list(result.scalars().all())


@router.get("/{document_id}", response_model=DocumentRead)
async def get_document(
    project_id: UUID,
    document_id: UUID,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> Document:
    project = await _load_project_or_404(session, project_id)
    await _require_project_read_access(session, project.id, user, active_org_id)
    return await _load_document_or_404(session, project.id, document_id)


@router.get("/{document_id}/download", response_model=DocumentDownloadResponse)
async def download_document(
    project_id: UUID,
    document_id: UUID,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
    storage: StorageBackend = Depends(get_storage),
) -> DocumentDownloadResponse:
    project = await _load_project_or_404(session, project_id)
    await _require_project_read_access(session, project.id, user, active_org_id)
    doc = await _load_document_or_404(session, project.id, document_id)

    if doc.status != DocumentStatus.ready:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="DOCUMENT_NOT_READY",
        )

    bucket = get_documents_bucket()
    url = await storage.presigned_get_url(doc.storage_key, doc.original_filename, bucket=bucket)
    return DocumentDownloadResponse(download_url=url, expires_in=storage.presign_ttl)


@router.patch("/{document_id}", response_model=DocumentRead)
async def update_document(
    project_id: UUID,
    document_id: UUID,
    payload: DocumentUpdateRequest,
    request: Request,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> Document:
    project = await _load_project_or_404(session, project_id)
    membership = await _require_membership(session, project.id, user.id)
    try:
        require_permission(membership.role, Resource.document, Action.update)
    except HTTPException:
        await audit.log_permission_denied(
            role=membership.role.value,
            resource=Resource.document.value,
            action=Action.update.value,
            actor_user_id=user.id,
            organization_id=active_org_id,
            resource_id=document_id,
            request=request,
        )
        raise

    doc = await _load_document_or_404(session, project.id, document_id)
    before = _document_snapshot(doc)

    updates = payload.model_dump(exclude_unset=True)
    for field, value in updates.items():
        setattr(doc, field, value)
    await session.flush()
    await session.refresh(doc)

    await audit.record(
        session,
        action="document.updated",
        resource_type="documents",
        resource_id=doc.id,
        before=before,
        after=_document_snapshot(doc),
        actor_user_id=user.id,
        organization_id=active_org_id,
        request=request,
    )
    return doc


@router.delete("/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_document(
    project_id: UUID,
    document_id: UUID,
    request: Request,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> Response:
    project = await _load_project_or_404(session, project_id)
    membership = await _require_membership(session, project.id, user.id)
    try:
        require_permission(membership.role, Resource.document, Action.delete)
    except HTTPException:
        await audit.log_permission_denied(
            role=membership.role.value,
            resource=Resource.document.value,
            action=Action.delete.value,
            actor_user_id=user.id,
            organization_id=active_org_id,
            resource_id=document_id,
            request=request,
        )
        raise

    doc = await _load_document_or_404(session, project.id, document_id)
    before = _document_snapshot(doc)
    doc.soft_delete()
    await session.flush()

    await audit.record(
        session,
        action="document.deleted",
        resource_type="documents",
        resource_id=document_id,
        before=before,
        actor_user_id=user.id,
        organization_id=active_org_id,
        request=request,
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
