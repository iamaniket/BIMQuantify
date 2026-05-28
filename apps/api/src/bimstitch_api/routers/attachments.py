"""Project-level attachment storage.

Two-phase presigned upload (same pattern as project_files): initiate -> browser
PUT -> complete. Attachments are project-scoped (not model-scoped) and support all
file types (images, video, audio, office docs). Every mutation writes an audit
entry in the same transaction.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated, Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from sqlalchemy import Integer, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

import logging

from bimstitch_api import audit
from bimstitch_api.auth.fastapi_users import current_verified_user
from bimstitch_api.auth.permissions import Action, Resource, require_permission
from bimstitch_api.config import Settings, get_settings
from bimstitch_api.jobs import DispatchJobError, dispatch_job
from bimstitch_api.models.attachment import (
    ATTACHMENT_ALLOWED_EXTENSIONS,
    Attachment,
    AttachmentCategory,
    AttachmentStatus,
)
from bimstitch_api.models.job import Job, JobStatus, JobType
from bimstitch_api.models.user import User

logger = logging.getLogger(__name__)
from bimstitch_api.routers.projects import (
    _load_project_or_404,
    _require_membership,
    _require_project_read_access,
    _require_project_writable,
)
from bimstitch_api.schemas.attachment import (
    AttachmentDownloadResponse,
    AttachmentInitiateRequest,
    AttachmentInitiateResponse,
    AttachmentRead,
    AttachmentUpdateRequest,
)
from bimstitch_api.storage import StorageBackend, get_attachments_bucket, get_storage
from bimstitch_api.storage.minio import ObjectNotFoundError
from bimstitch_api.tenancy import get_tenant_session, require_active_organization

router = APIRouter(prefix="/projects/{project_id}/attachments", tags=["attachments"])


def _attachment_snapshot(att: Attachment) -> dict:
    return {
        "original_filename": att.original_filename,
        "size_bytes": att.size_bytes,
        "content_type": att.content_type,
        "attachment_category": att.attachment_category.value,
        "status": att.status.value,
        "description": att.description,
        "linked_element_global_id": att.linked_element_global_id,
        "linked_model_id": str(att.linked_model_id) if att.linked_model_id else None,
        "linked_file_id": str(att.linked_file_id) if att.linked_file_id else None,
        "linked_point": att.linked_point,
        "capture_link_id": str(att.capture_link_id) if att.capture_link_id else None,
        "has_capture_metadata": att.capture_metadata is not None,
    }


async def _load_attachment_or_404(
    session: AsyncSession, project_id: UUID, attachment_id: UUID
) -> Attachment:
    att = (
        await session.execute(
            select(Attachment)
            .options(selectinload(Attachment.uploaded_by_user))
            .where(
                Attachment.id == attachment_id,
                Attachment.project_id == project_id,
                Attachment.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if att is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="ATTACHMENT_NOT_FOUND")
    return att


@router.post("/initiate", response_model=AttachmentInitiateResponse, status_code=status.HTTP_201_CREATED)
async def initiate_attachment_upload(
    project_id: UUID,
    payload: AttachmentInitiateRequest,
    request: Request,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
    storage: StorageBackend = Depends(get_storage),
    settings: Settings = Depends(get_settings),
) -> AttachmentInitiateResponse:
    project = await _load_project_or_404(session, project_id)
    membership = await _require_membership(session, project.id, user.id)
    try:
        require_permission(membership.role, Resource.attachment, Action.create)
    except HTTPException:
        await audit.log_permission_denied(
            role=membership.role.value,
            resource=Resource.attachment.value,
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
    category = ATTACHMENT_ALLOWED_EXTENSIONS.get(ext)
    if category is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "code": "INVALID_FILE_EXTENSION",
                "allowed": sorted(ATTACHMENT_ALLOWED_EXTENSIONS.keys()),
            },
        )

    if payload.size_bytes > settings.attachment_max_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail={
                "code": "FILE_TOO_LARGE",
                "max_bytes": settings.attachment_max_bytes,
            },
        )

    existing = (
        await session.execute(
            select(Attachment).where(
                Attachment.project_id == project.id,
                Attachment.content_sha256 == payload.content_sha256,
                Attachment.status.in_([AttachmentStatus.pending, AttachmentStatus.ready]),
                Attachment.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "DUPLICATE_CONTENT",
                "existing_attachment_id": str(existing.id),
                "existing_filename": existing.original_filename,
            },
        )

    storage_key = f"projects/{project.id}/attachments/{uuid4()}{ext}"
    bucket = get_attachments_bucket()

    capture_meta = None
    if payload.capture_metadata is not None:
        capture_meta = payload.capture_metadata.model_dump(mode="json")
        capture_meta["server_received_at"] = datetime.now(UTC).isoformat()

    att = Attachment(
        project_id=project.id,
        uploaded_by_user_id=user.id,
        storage_key=storage_key,
        original_filename=payload.filename,
        size_bytes=payload.size_bytes,
        content_type=payload.content_type,
        content_sha256=payload.content_sha256,
        attachment_category=category,
        status=AttachmentStatus.pending,
        description=payload.description,
        linked_element_global_id=payload.linked_element_global_id,
        linked_model_id=payload.linked_model_id,
        linked_point=payload.linked_point,
        linked_file_id=payload.linked_file_id,
        capture_metadata=capture_meta,
    )
    session.add(att)
    await session.flush()
    await session.refresh(att)

    upload_url = await storage.presigned_put_url(
        storage_key, payload.content_type, payload.size_bytes, bucket=bucket
    )

    await audit.record(
        session,
        action="attachment.initiated",
        resource_type="attachments",
        resource_id=att.id,
        after=_attachment_snapshot(att),
        actor_user_id=user.id,
        organization_id=active_org_id,
        project_id=project.id,
        request=request,
    )

    return AttachmentInitiateResponse(
        attachment_id=att.id,
        upload_url=upload_url,
        storage_key=storage_key,
        expires_in=storage.presign_ttl,
    )


@router.post("/{attachment_id}/complete", response_model=AttachmentRead)
async def complete_attachment_upload(
    project_id: UUID,
    attachment_id: UUID,
    request: Request,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
    storage: StorageBackend = Depends(get_storage),
    settings: Settings = Depends(get_settings),
) -> Attachment:
    project = await _load_project_or_404(session, project_id)
    membership = await _require_membership(session, project.id, user.id)
    try:
        require_permission(membership.role, Resource.attachment, Action.create)
    except HTTPException:
        await audit.log_permission_denied(
            role=membership.role.value,
            resource=Resource.attachment.value,
            action=Action.create.value,
            actor_user_id=user.id,
            organization_id=active_org_id,
            request=request,
        )
        raise

    att = await _load_attachment_or_404(session, project.id, attachment_id)
    if att.status != AttachmentStatus.pending:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="ATTACHMENT_NOT_PENDING",
        )

    bucket = get_attachments_bucket()
    try:
        head = await storage.head_object(att.storage_key, bucket=bucket)
    except ObjectNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="OBJECT_NOT_UPLOADED",
        )

    actual_size = head.get("ContentLength", 0)
    if actual_size != att.size_bytes:
        att.status = AttachmentStatus.rejected
        att.rejection_reason = "SIZE_MISMATCH"
        await session.flush()
        await audit.record(
            session,
            action="attachment.rejected",
            resource_type="attachments",
            resource_id=att.id,
            after={"status": "rejected", "rejection_reason": "SIZE_MISMATCH"},
            actor_user_id=user.id,
            organization_id=active_org_id,
            project_id=project.id,
            request=request,
        )
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="SIZE_MISMATCH",
        )

    before = {"status": att.status.value}
    att.status = AttachmentStatus.ready
    await session.flush()
    await session.refresh(att)

    await audit.record(
        session,
        action="attachment.completed",
        resource_type="attachments",
        resource_id=att.id,
        before=before,
        after=_attachment_snapshot(att),
        actor_user_id=user.id,
        organization_id=active_org_id,
        project_id=project.id,
        request=request,
    )

    if att.attachment_category == AttachmentCategory.image:
        job = Job(
            project_id=project.id,
            job_type=JobType.image_metadata_extraction,
            status=JobStatus.pending,
            payload={
                "attachment_id": str(att.id),
                "project_id": str(project.id),
                "storage_key": att.storage_key,
                "bucket": bucket,
            },
            created_by_user_id=user.id,
        )
        session.add(job)
        await session.flush()
        try:
            await dispatch_job(job, settings, active_org_id)
        except Exception as exc:
            job.status = JobStatus.failed
            job.error = f"DISPATCH_FAILED: {exc}"[:500]
            logger.warning("Image metadata dispatch failed for %s: %s", att.storage_key, exc)

    return att


@router.get("", response_model=list[AttachmentRead])
async def list_attachments(
    project_id: UUID,
    category: Annotated[AttachmentCategory | None, Query()] = None,
    linked_element_global_id: Annotated[str | None, Query(max_length=22)] = None,
    linked_file_id: Annotated[UUID | None, Query()] = None,
    unlinked: Annotated[bool, Query()] = False,
    linked_point_type: Annotated[str | None, Query(max_length=10)] = None,
    linked_point_page: Annotated[int | None, Query(ge=1)] = None,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> list[Attachment]:
    project = await _load_project_or_404(session, project_id)
    await _require_project_read_access(session, project.id, user, active_org_id)

    stmt = (
        select(Attachment)
        .options(selectinload(Attachment.uploaded_by_user))
        .where(
            Attachment.project_id == project.id,
            Attachment.status == AttachmentStatus.ready,
            Attachment.deleted_at.is_(None),
        )
        .order_by(Attachment.created_at.desc())
    )
    if category is not None:
        stmt = stmt.where(Attachment.attachment_category == category)
    if linked_element_global_id is not None:
        stmt = stmt.where(Attachment.linked_element_global_id == linked_element_global_id)
    if linked_file_id is not None:
        stmt = stmt.where(Attachment.linked_file_id == linked_file_id)
    if unlinked:
        stmt = stmt.where(Attachment.linked_element_global_id.is_(None))
    if linked_point_type is not None:
        stmt = stmt.where(Attachment.linked_point["type"].astext == linked_point_type)
    if linked_point_page is not None:
        stmt = stmt.where(
            Attachment.linked_point["page"].astext.cast(Integer) == linked_point_page
        )

    result = await session.execute(stmt)
    return list(result.scalars().all())


@router.get("/{attachment_id}", response_model=AttachmentRead)
async def get_attachment(
    project_id: UUID,
    attachment_id: UUID,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> Attachment:
    project = await _load_project_or_404(session, project_id)
    await _require_project_read_access(session, project.id, user, active_org_id)
    return await _load_attachment_or_404(session, project.id, attachment_id)


@router.get("/{attachment_id}/download", response_model=AttachmentDownloadResponse)
async def download_attachment(
    project_id: UUID,
    attachment_id: UUID,
    disposition: Annotated[Literal["attachment", "inline"], Query()] = "attachment",
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
    storage: StorageBackend = Depends(get_storage),
) -> AttachmentDownloadResponse:
    project = await _load_project_or_404(session, project_id)
    await _require_project_read_access(session, project.id, user, active_org_id)
    att = await _load_attachment_or_404(session, project.id, attachment_id)

    if att.status != AttachmentStatus.ready:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="ATTACHMENT_NOT_READY",
        )

    bucket = get_attachments_bucket()
    url = await storage.presigned_get_url(
        att.storage_key, att.original_filename, disposition=disposition, bucket=bucket
    )
    return AttachmentDownloadResponse(download_url=url, expires_in=storage.presign_ttl)


@router.patch("/{attachment_id}", response_model=AttachmentRead)
async def update_attachment(
    project_id: UUID,
    attachment_id: UUID,
    payload: AttachmentUpdateRequest,
    request: Request,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> Attachment:
    project = await _load_project_or_404(session, project_id)
    membership = await _require_membership(session, project.id, user.id)
    try:
        require_permission(membership.role, Resource.attachment, Action.update)
    except HTTPException:
        await audit.log_permission_denied(
            role=membership.role.value,
            resource=Resource.attachment.value,
            action=Action.update.value,
            actor_user_id=user.id,
            organization_id=active_org_id,
            resource_id=attachment_id,
            request=request,
        )
        raise

    att = await _load_attachment_or_404(session, project.id, attachment_id)
    before = _attachment_snapshot(att)

    updates = payload.model_dump(exclude_unset=True)
    for field, value in updates.items():
        setattr(att, field, value)
    await session.flush()
    await session.refresh(att)

    await audit.record(
        session,
        action="attachment.updated",
        resource_type="attachments",
        resource_id=att.id,
        before=before,
        after=_attachment_snapshot(att),
        actor_user_id=user.id,
        organization_id=active_org_id,
        project_id=project.id,
        request=request,
    )
    return att


@router.delete("/{attachment_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_attachment(
    project_id: UUID,
    attachment_id: UUID,
    request: Request,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> Response:
    project = await _load_project_or_404(session, project_id)
    membership = await _require_membership(session, project.id, user.id)
    try:
        require_permission(membership.role, Resource.attachment, Action.delete)
    except HTTPException:
        await audit.log_permission_denied(
            role=membership.role.value,
            resource=Resource.attachment.value,
            action=Action.delete.value,
            actor_user_id=user.id,
            organization_id=active_org_id,
            resource_id=attachment_id,
            request=request,
        )
        raise

    att = await _load_attachment_or_404(session, project.id, attachment_id)
    before = _attachment_snapshot(att)
    att.soft_delete()
    await session.flush()

    await audit.record(
        session,
        action="attachment.deleted",
        resource_type="attachments",
        resource_id=attachment_id,
        before=before,
        actor_user_id=user.id,
        organization_id=active_org_id,
        project_id=project.id,
        request=request,
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
