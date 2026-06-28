"""Public (unauthenticated) capture link endpoints.

These endpoints are accessible without a JWT. The org_id in the URL path
provides the tenant context, and the token authenticates the request.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from bimdossier_api import audit
from bimdossier_api.auth.ratelimit import CAPTURE_INITIATE_LIMITER
from bimdossier_api.config import Settings, get_settings
from bimdossier_api.db import get_session_maker
from bimdossier_api.models.capture_link import CaptureLink
from bimdossier_api.models.organization import Organization, OrganizationStatus
from bimdossier_api.models.project import Project
from bimdossier_api.models.project_file import (
    ATTACHMENT_ALLOWED_EXTENSIONS,
    ProjectFile,
    ProjectFileRole,
    ProjectFileStatus,
)
from bimdossier_api.schemas.capture_link import (
    CaptureTokenValidation,
    CaptureUploadRequest,
    CaptureUploadResponse,
)
from bimdossier_api.storage import StorageBackend, get_attachments_bucket, get_storage
from bimdossier_api.storage.minio import ObjectNotFoundError
from bimdossier_api.tenancy import schema_name_for

router = APIRouter(prefix="/public/capture", tags=["capture-public"])


@asynccontextmanager
async def _open_tenant_session(org_id: UUID) -> AsyncIterator[AsyncSession]:
    """Open a session scoped to the org's schema WITHOUT JWT auth.

    Defence in depth: like ``get_tenant_session`` this drops to the
    non-superuser ``bim_app`` role and pins ``search_path`` +
    ``app.current_org_id`` for the transaction, so the surviving master-table
    RLS policies enforce even though there is no user context (the capture-link
    token is the authorization gate). There is no ``app.current_user_id`` — an
    unauthenticated capture upload carries no user identity.

    Same hard rule as the tenant dependency: do NOT call ``session.commit()``
    inside the ``async with`` block — the wrapping ``session.begin()`` commits on
    clean exit and rolls back on exception. An explicit commit would drop the
    role + search_path + GUC and break isolation for subsequent queries. A
    handler that must persist a write *and then* return an error (the
    SIZE_MISMATCH rejection in ``complete_capture_upload``) sets a flag inside
    the block and raises only after the block has committed.
    """
    sm = get_session_maker()
    async with sm() as session, session.begin():
        # Resolve + gate the org before dropping privileges. Runs under the
        # deploy role; bim_app also has SELECT on the master organizations table
        # so the order is not load-bearing — doing it first keeps the existence
        # check independent of the tenant isolation set up below.
        org = (
            await session.execute(
                select(Organization).where(Organization.id == org_id)
            )
        ).scalar_one_or_none()
        if org is None or org.status != OrganizationStatus.active or org.deleted_at is not None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="INVALID_CAPTURE_LINK"
            )

        schema = schema_name_for(org_id)
        await session.execute(text("SET LOCAL ROLE bim_app"))
        await session.execute(text(f'SET LOCAL search_path = "{schema}", public'))
        await session.execute(
            text("SELECT set_config('app.current_org_id', :org, true)"),
            {"org": str(org_id)},
        )
        yield session


async def _load_and_validate_link(
    session: AsyncSession, token: str, *, for_update: bool = False
) -> CaptureLink:
    """Load a capture link by token and assert it's currently usable.

    `for_update=True` takes a `SELECT ... FOR UPDATE` row lock so the
    is_exhausted check and the subsequent `use_count` increment in the write
    path (`initiate`) serialize across concurrent uploads. Without it, N
    simultaneous uploads against a `max_uses=1` link all read `use_count=0`,
    all pass `is_exhausted`, and all increment — consuming a single-use link N
    times on an unauthenticated endpoint. The lock is held until the
    surrounding transaction commits. Read-only callers (`validate`) leave it
    unlocked.
    """
    stmt = select(CaptureLink).where(CaptureLink.token == token)
    if for_update:
        stmt = stmt.with_for_update()
    link = (await session.execute(stmt)).scalar_one_or_none()
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
    async with _open_tenant_session(org_id) as session:
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


@router.post(
    "/{org_id}/{token}/initiate",
    response_model=CaptureUploadResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(CAPTURE_INITIATE_LIMITER)],
)
async def initiate_capture_upload(
    org_id: UUID,
    token: str,
    payload: CaptureUploadRequest,
    request: Request,
    storage: StorageBackend = Depends(get_storage),
    settings: Settings = Depends(get_settings),
) -> CaptureUploadResponse:
    async with _open_tenant_session(org_id) as session:
        # FOR UPDATE: serialize concurrent uploads so the use_count cap holds.
        link = await _load_and_validate_link(session, token, for_update=True)

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

        # No explicit commit — the _open_tenant_session block commits on exit.
        return CaptureUploadResponse(
            attachment_id=att.id,
            upload_url=upload_url,
            storage_key=storage_key,
            expires_in=storage.presign_ttl,
        )


@router.post("/{org_id}/{token}/complete/{attachment_id}", response_model=None, status_code=status.HTTP_200_OK)
async def complete_capture_upload(
    org_id: UUID,
    token: str,
    attachment_id: UUID,
    request: Request,
    storage: StorageBackend = Depends(get_storage),
) -> dict[str, str]:
    # A SIZE_MISMATCH must PERSIST the `rejected` write and THEN return 422.
    # Inside the _open_tenant_session block a raise rolls the write back, so we
    # record the rejection, let the block commit on clean exit, and raise after.
    size_mismatch = False
    att_id: UUID
    async with _open_tenant_session(org_id) as session:
        link = await _load_and_validate_link(session, token)

        # FOR UPDATE: two concurrent completes must not both read `pending` and
        # both flip the status / double-write audit rows. The lock serializes
        # them; the loser sees `ready` and gets ATTACHMENT_NOT_PENDING below.
        att = (
            await session.execute(
                select(ProjectFile)
                .where(
                    ProjectFile.id == attachment_id,
                    ProjectFile.capture_link_id == link.id,
                    ProjectFile.role == ProjectFileRole.attachment,
                    ProjectFile.deleted_at.is_(None),
                )
                .with_for_update()
            )
        ).scalar_one_or_none()
        if att is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="ATTACHMENT_NOT_FOUND")

        if att.status != ProjectFileStatus.pending:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="ATTACHMENT_NOT_PENDING")

        att_id = att.id
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
            size_mismatch = True
        else:
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

    # Block committed: the rejection (or the ready flip) is now durable.
    if size_mismatch:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="SIZE_MISMATCH",
        )
    return {"status": "ok", "attachment_id": str(att_id)}
