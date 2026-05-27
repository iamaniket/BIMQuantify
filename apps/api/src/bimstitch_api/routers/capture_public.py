"""Public (unauthenticated) capture link endpoints.

These endpoints are accessible without a JWT. The org_id in the URL path
provides the tenant context, and the token authenticates the request.
"""

from __future__ import annotations

from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from bimstitch_api import audit
from bimstitch_api.config import Settings, get_settings
from bimstitch_api.db import get_session_maker
from bimstitch_api.models.capture_link import CaptureLink
from bimstitch_api.models.attachment import (
    ATTACHMENT_ALLOWED_EXTENSIONS,
    Attachment,
    AttachmentStatus,
)
from bimstitch_api.models.organization import Organization, OrganizationStatus
from bimstitch_api.models.project import Project
from bimstitch_api.schemas.capture_link import (
    CaptureTokenValidation,
    CaptureUploadRequest,
    CaptureUploadResponse,
)
from bimstitch_api.storage import StorageBackend, get_attachments_bucket, get_storage
from bimstitch_api.storage.minio import ObjectNotFoundError
from bimstitch_api.tenancy import schema_name_for

router = APIRouter(prefix="/public/capture", tags=["capture-public"])


async def _open_tenant_session(org_id: UUID) -> AsyncSession:
    """Open a session scoped to the org's schema WITHOUT JWT auth.

    Uses the deploy user (not bim_app) because there's no user context for
    RLS GUCs. The capture link token itself is the authorization gate.
    """
    sm = get_session_maker()
    session = sm()
    await session.begin()

    org = (
        await session.execute(
            select(Organization).where(Organization.id == org_id)
        )
    ).scalar_one_or_none()
    if org is None or org.status != OrganizationStatus.active or org.deleted_at is not None:
        await session.close()
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="INVALID_CAPTURE_LINK")

    schema = schema_name_for(org_id)
    await session.execute(text(f'SET LOCAL search_path = "{schema}", public'))
    return session


async def _load_and_validate_link(session: AsyncSession, token: str) -> CaptureLink:
    link = (
        await session.execute(
            select(CaptureLink).where(CaptureLink.token == token)
        )
    ).scalar_one_or_none()
    if link is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="INVALID_CAPTURE_LINK")
    if not link.is_valid:
        detail = "CAPTURE_LINK_EXPIRED"
        if link.is_revoked:
            detail = "CAPTURE_LINK_REVOKED"
        elif link.is_exhausted:
            detail = "CAPTURE_LINK_EXHAUSTED"
        raise HTTPException(status_code=status.HTTP_410_GONE, detail=detail)
    return link


@router.get("/{org_id}/{token}/validate", response_model=CaptureTokenValidation)
async def validate_capture_token(
    org_id: UUID,
    token: str,
) -> CaptureTokenValidation:
    session = await _open_tenant_session(org_id)
    try:
        link = await _load_and_validate_link(session, token)
        project = (
            await session.execute(
                select(Project).where(Project.id == link.project_id)
            )
        ).scalar_one_or_none()
        if project is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="INVALID_CAPTURE_LINK")

        remaining = None
        if link.max_uses is not None:
            remaining = max(0, link.max_uses - link.use_count)

        return CaptureTokenValidation(
            project_id=project.id,
            project_name=project.name,
            label=link.label,
            expires_at=link.expires_at,
            remaining_uses=remaining,
        )
    finally:
        await session.close()


@router.post("/{org_id}/{token}/initiate", response_model=CaptureUploadResponse, status_code=status.HTTP_201_CREATED)
async def initiate_capture_upload(
    org_id: UUID,
    token: str,
    payload: CaptureUploadRequest,
    request: Request,
    storage: StorageBackend = Depends(get_storage),
    settings: Settings = Depends(get_settings),
) -> CaptureUploadResponse:
    session = await _open_tenant_session(org_id)
    try:
        link = await _load_and_validate_link(session, token)

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
                detail={"code": "FILE_TOO_LARGE", "max_bytes": settings.attachment_max_bytes},
            )

        storage_key = f"projects/{link.project_id}/attachments/{uuid4()}{ext}"
        bucket = get_attachments_bucket()

        att = Attachment(
            project_id=link.project_id,
            uploaded_by_user_id=None,
            capture_link_id=link.id,
            storage_key=storage_key,
            original_filename=payload.filename,
            size_bytes=payload.size_bytes,
            content_type=payload.content_type,
            content_sha256=payload.content_sha256,
            attachment_category=category,
            status=AttachmentStatus.pending,
        )
        session.add(att)

        link.use_count += 1
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
            after={
                "original_filename": att.original_filename,
                "capture_link_id": str(link.id),
                "attachment_category": att.attachment_category.value,
            },
            actor_user_id=None,
            organization_id=org_id,
            request=request,
        )

        await session.commit()

        return CaptureUploadResponse(
            attachment_id=att.id,
            upload_url=upload_url,
            storage_key=storage_key,
            expires_in=storage.presign_ttl,
        )
    except Exception:
        await session.rollback()
        raise
    finally:
        await session.close()


@router.post("/{org_id}/{token}/complete/{attachment_id}", response_model=None, status_code=status.HTTP_200_OK)
async def complete_capture_upload(
    org_id: UUID,
    token: str,
    attachment_id: UUID,
    request: Request,
    storage: StorageBackend = Depends(get_storage),
) -> dict:
    session = await _open_tenant_session(org_id)
    try:
        link = await _load_and_validate_link(session, token)

        att = (
            await session.execute(
                select(Attachment).where(
                    Attachment.id == attachment_id,
                    Attachment.capture_link_id == link.id,
                    Attachment.deleted_at.is_(None),
                )
            )
        ).scalar_one_or_none()
        if att is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="ATTACHMENT_NOT_FOUND")

        if att.status != AttachmentStatus.pending:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="ATTACHMENT_NOT_PENDING")

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
                actor_user_id=None,
                organization_id=org_id,
                request=request,
            )
            await session.commit()
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="SIZE_MISMATCH",
            )

        att.status = AttachmentStatus.ready
        await session.flush()

        await audit.record(
            session,
            action="attachment.completed",
            resource_type="attachments",
            resource_id=att.id,
            before={"status": "pending"},
            after={"status": "ready"},
            actor_user_id=None,
            organization_id=org_id,
            request=request,
        )

        await session.commit()
        return {"status": "ok", "attachment_id": str(att.id)}
    except Exception:
        await session.rollback()
        raise
    finally:
        await session.close()
