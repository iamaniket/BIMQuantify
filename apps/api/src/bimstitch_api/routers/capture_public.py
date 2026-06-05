"""Public (unauthenticated) capture link endpoints.

These endpoints are accessible without a JWT. The org_id in the URL path
provides the tenant context, and the token authenticates the request.
"""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from bimstitch_api import audit
from bimstitch_api.config import Settings, get_settings
from bimstitch_api.db import get_session_maker
from bimstitch_api.models.capture_link import CaptureLink
from bimstitch_api.models.organization import Organization, OrganizationStatus
from bimstitch_api.models.project import Project
from bimstitch_api.models.project_file import (
    ATTACHMENT_ALLOWED_EXTENSIONS,
    ProjectFile,
    ProjectFileRole,
    ProjectFileStatus,
)
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

        existing = (
            await session.execute(
                select(ProjectFile).where(
                    ProjectFile.project_id == link.project_id,
                    ProjectFile.role == ProjectFileRole.attachment,
                    ProjectFile.content_sha256 == payload.content_sha256,
                    ProjectFile.status.in_([ProjectFileStatus.pending, ProjectFileStatus.ready]),
                    ProjectFile.deleted_at.is_(None),
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

        storage_key = f"projects/{link.project_id}/attachments/{uuid4()}{ext}"
        bucket = get_attachments_bucket()

        capture_meta = None
        if payload.capture_metadata is not None:
            capture_meta = payload.capture_metadata.model_dump(mode="json")
            capture_meta["server_received_at"] = datetime.now(UTC).isoformat()

        att = ProjectFile(
            project_id=link.project_id,
            role=ProjectFileRole.attachment,
            uploaded_by_user_id=None,
            capture_link_id=link.id,
            storage_key=storage_key,
            original_filename=payload.filename,
            size_bytes=payload.size_bytes,
            content_type=payload.content_type,
            content_sha256=payload.content_sha256,
            attachment_category=category,
            status=ProjectFileStatus.pending,
            capture_metadata=capture_meta,
        )
        session.add(att)

        link.use_count += 1
        try:
            await session.flush()
        except IntegrityError as exc:
            # Concurrent capture upload of the same bytes — surface 409 instead
            # of a 500. The outer handler rolls back before this propagates.
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={"code": "DUPLICATE_CONTENT"},
            ) from exc
        await session.refresh(att)

        upload_url = await storage.presigned_put_url(
            storage_key, payload.content_type, payload.size_bytes, bucket=bucket
        )

        await audit.record(
            session,
            action="attachment.initiated",
            resource_type="project_files",
            resource_id=att.id,
            after={
                "original_filename": att.original_filename,
                "capture_link_id": str(link.id),
                "attachment_category": (
                    att.attachment_category.value if att.attachment_category else None
                ),
            },
            actor_user_id=None,
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
) -> dict[str, str]:
    session = await _open_tenant_session(org_id)
    try:
        link = await _load_and_validate_link(session, token)

        att = (
            await session.execute(
                select(ProjectFile).where(
                    ProjectFile.id == attachment_id,
                    ProjectFile.capture_link_id == link.id,
                    ProjectFile.role == ProjectFileRole.attachment,
                    ProjectFile.deleted_at.is_(None),
                )
            )
        ).scalar_one_or_none()
        if att is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="ATTACHMENT_NOT_FOUND")

        if att.status != ProjectFileStatus.pending:
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
            att.status = ProjectFileStatus.rejected
            att.rejection_reason = "SIZE_MISMATCH"
            await session.flush()
            await audit.record(
                session,
                action="attachment.rejected",
                resource_type="project_files",
                resource_id=att.id,
                after={"status": "rejected", "rejection_reason": "SIZE_MISMATCH"},
                actor_user_id=None,
                request=request,
            )
            await session.commit()
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="SIZE_MISMATCH",
            )

        att.status = ProjectFileStatus.ready
        await session.flush()

        await audit.record(
            session,
            action="attachment.completed",
            resource_type="project_files",
            resource_id=att.id,
            before={"status": "pending"},
            after={"status": "ready"},
            actor_user_id=None,
            request=request,
        )

        await session.commit()
        return {"status": "ok", "attachment_id": str(att.id)}
    except Exception:
        await session.rollback()
        raise
    finally:
        await session.close()
