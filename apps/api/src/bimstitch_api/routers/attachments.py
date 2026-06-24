"""Project-level attachment storage.

Two-phase presigned upload (same pattern as model files): initiate -> browser
PUT -> complete. Attachments are project-scoped (not model-scoped) rows in the
unified ``project_files`` table, distinguished by ``role = 'attachment'``. They
support all file types (images, video, audio, office docs). Every mutation
writes an audit entry in the same transaction.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased, selectinload

from bimstitch_api import audit
from bimstitch_api.auth.fastapi_users import current_verified_user
from bimstitch_api.auth.permissions import Action, Resource, require_permission
from bimstitch_api.config import Settings, get_settings
from bimstitch_api.idempotency import idempotency_key_header, is_idempotency_conflict
from bimstitch_api.jobs import dispatch_job
from bimstitch_api.models.job import Job, JobStatus, JobType
from bimstitch_api.models.project_file import (
    ATTACHMENT_ALLOWED_EXTENSIONS,
    AttachmentCategory,
    DossierSlot,
    ProjectFile,
    ProjectFileRole,
    ProjectFileStatus,
)
from bimstitch_api.models.user import User

logger = logging.getLogger(__name__)
from bimstitch_api.access import (
    load_project_or_404,
    require_membership,
    require_project_read_access,
    require_project_writable,
)
from bimstitch_api.schemas.attachment import (
    AttachmentDownloadResponse,
    AttachmentInitiateRequest,
    AttachmentInitiateResponse,
    AttachmentRead,
    AttachmentUpdateRequest,
)
from bimstitch_api.storage import (
    StorageBackend,
    get_attachments_bucket,
    get_storage,
    upload_service,
)
from bimstitch_api.tenancy import get_tenant_session, require_active_organization

router = APIRouter(prefix="/projects/{project_id}/attachments", tags=["attachments"])


async def _next_version_in_group(
    session: AsyncSession, project_id: UUID, supersedes_id: UUID
) -> tuple[int, UUID]:
    """Resolve the version group of `supersedes_id` and return
    (next_version_number, root_id).

    The root is the group anchor: `supersedes_id` may point at any version, so we
    take its `parent_file_id` (the root) or, if it is itself the root, its own
    id. The next number is `max(version_number) + 1` over the whole group
    INCLUDING soft-deleted/abandoned rows, so version numbers are never reused.
    404 if `supersedes_id` is not a live attachment in this project.
    """
    superseded = await _load_attachment_or_404(session, project_id, supersedes_id)
    root_id = superseded.parent_file_id or superseded.id
    max_version = (
        await session.scalar(
            select(func.max(ProjectFile.version_number)).where(
                ProjectFile.project_id == project_id,
                ProjectFile.role == ProjectFileRole.attachment,
                or_(ProjectFile.id == root_id, ProjectFile.parent_file_id == root_id),
            )
        )
    ) or 0
    return max_version + 1, root_id


def _attachment_snapshot(att: ProjectFile) -> dict[str, object]:
    return {
        "original_filename": att.original_filename,
        "size_bytes": att.size_bytes,
        "content_type": att.content_type,
        "attachment_category": (
            att.attachment_category.value if att.attachment_category else None
        ),
        "status": att.status.value,
        "description": att.description,
        "dossier_slot": att.dossier_slot.value if att.dossier_slot else None,
        "capture_link_id": str(att.capture_link_id) if att.capture_link_id else None,
        "has_capture_metadata": att.capture_metadata is not None,
        "has_annotation_state": att.annotation_state is not None,
        "version_number": att.version_number,
        "parent_file_id": (str(att.parent_file_id) if att.parent_file_id else None),
    }


async def _load_attachment_or_404(
    session: AsyncSession, project_id: UUID, attachment_id: UUID
) -> ProjectFile:
    att = (
        await session.execute(
            select(ProjectFile)
            .options(selectinload(ProjectFile.uploaded_by_user))
            .where(
                ProjectFile.id == attachment_id,
                ProjectFile.project_id == project_id,
                ProjectFile.role == ProjectFileRole.attachment,
                ProjectFile.deleted_at.is_(None),
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
    idempotency_key: str | None = Depends(idempotency_key_header),
) -> AttachmentInitiateResponse:
    project = await load_project_or_404(session, project_id)
    membership = await require_membership(session, project.id, user.id)
    try:
        require_permission(membership.role, Resource.attachment, Action.create)
    except HTTPException:
        await audit.log_permission_denied(
            role=membership.role.value,
            resource=Resource.attachment.value,
            action=Action.create.value,
            actor_user_id=user.id,
            request=request,
        )
        raise
    require_project_writable(project)

    ext = upload_service.parse_extension(payload.filename)
    upload_service.ensure_allowed_extension(ext, ATTACHMENT_ALLOWED_EXTENSIONS)
    category = ATTACHMENT_ALLOWED_EXTENSIONS[ext]
    upload_service.ensure_within_size_limit(payload.size_bytes, settings.attachment_max_bytes)

    # Idempotent replay (offline mobile outbox): if this uploader already used
    # this key, return the original row with a FRESH presigned URL — the
    # original may have expired during the offline window. This runs before the
    # content-sha256 dedup so a keyed replay returns the row instead of 409ing.
    if idempotency_key is not None:
        prior = (
            await session.execute(
                select(ProjectFile).where(
                    ProjectFile.project_id == project.id,
                    ProjectFile.role == ProjectFileRole.attachment,
                    ProjectFile.uploaded_by_user_id == user.id,
                    ProjectFile.idempotency_key == idempotency_key,
                    ProjectFile.deleted_at.is_(None),
                )
            )
        ).scalar_one_or_none()
        if prior is not None:
            fresh_url = await storage.presigned_put_url(
                prior.storage_key,
                prior.content_type,
                prior.size_bytes,
                bucket=get_attachments_bucket(),
            )
            return AttachmentInitiateResponse(
                attachment_id=prior.id,
                upload_url=fresh_url,
                storage_key=prior.storage_key,
                expires_in=storage.presign_ttl,
            )

    existing = (
        await session.execute(
            select(ProjectFile).where(
                ProjectFile.project_id == project.id,
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

    # A new version of an existing document (supersedes_id set) joins that
    # document's version group; otherwise this is a fresh root at version 1.
    version_number = 1
    parent_id: UUID | None = None
    if payload.supersedes_id is not None:
        version_number, parent_id = await _next_version_in_group(
            session, project.id, payload.supersedes_id
        )

    storage_key = upload_service.build_storage_key(project.id, "attachments", ext)
    bucket = get_attachments_bucket()

    capture_meta = None
    if payload.capture_metadata is not None:
        capture_meta = payload.capture_metadata.model_dump(mode="json")
        capture_meta["server_received_at"] = datetime.now(UTC).isoformat()

    att = ProjectFile(
        project_id=project.id,
        role=ProjectFileRole.attachment,
        uploaded_by_user_id=user.id,
        storage_key=storage_key,
        original_filename=payload.filename,
        size_bytes=payload.size_bytes,
        content_type=payload.content_type,
        content_sha256=payload.content_sha256,
        attachment_category=category,
        status=ProjectFileStatus.pending,
        description=payload.description,
        dossier_slot=payload.dossier_slot,
        capture_metadata=capture_meta,
        version_number=version_number,
        parent_file_id=parent_id,
        idempotency_key=idempotency_key,
    )
    session.add(att)
    try:
        await session.flush()
    except IntegrityError as exc:
        # Concurrent replay lost the race to insert the same idempotency key —
        # the partial-unique index is the backstop. 409 is retryable; the
        # client's next attempt hits the pre-check above and gets the row.
        if idempotency_key is not None and is_idempotency_conflict(exc):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="IDEMPOTENCY_KEY_CONFLICT",
            ) from exc
        # The pre-check above catches the common duplicate; this guards the
        # concurrent race (two uploads of the same bytes, or a racing version
        # number in the group) so it surfaces as 409 rather than an unhandled
        # 500 — mirroring the model-files path in routers/project_files.py.
        constraint = getattr(exc.orig, "constraint_name", None) or ""
        if "content_sha256" in constraint or "content_sha256" in str(exc.orig):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={"code": "DUPLICATE_CONTENT"},
            ) from exc
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="VERSION_NUMBER_CONFLICT"
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
        after=_attachment_snapshot(att),
        actor_user_id=user.id,
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
) -> ProjectFile:
    project = await load_project_or_404(session, project_id)
    membership = await require_membership(session, project.id, user.id)
    try:
        require_permission(membership.role, Resource.attachment, Action.create)
    except HTTPException:
        await audit.log_permission_denied(
            role=membership.role.value,
            resource=Resource.attachment.value,
            action=Action.create.value,
            actor_user_id=user.id,
            request=request,
        )
        raise

    att = await _load_attachment_or_404(session, project.id, attachment_id)
    if att.status != ProjectFileStatus.pending:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="ATTACHMENT_NOT_PENDING",
        )

    bucket = get_attachments_bucket()
    actual_size = await upload_service.head_verify_size(storage, att.storage_key, bucket=bucket)
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
            actor_user_id=user.id,
            project_id=project.id,
            request=request,
        )
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="SIZE_MISMATCH",
        )

    before = {"status": att.status.value}
    att.status = ProjectFileStatus.ready
    await session.flush()
    await session.refresh(att)

    completed_action = (
        "attachment.version_added"
        if att.parent_file_id is not None
        else "attachment.completed"
    )
    await audit.record(
        session,
        action=completed_action,
        resource_type="project_files",
        resource_id=att.id,
        before=before,
        after=_attachment_snapshot(att),
        actor_user_id=user.id,
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
    response: Response,
    category: Annotated[AttachmentCategory | None, Query()] = None,
    dossier_slot: Annotated[DossierSlot | None, Query()] = None,
    unslotted: Annotated[bool, Query()] = False,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> list[ProjectFile]:
    project = await load_project_or_404(session, project_id)
    await require_project_read_access(session, project.id, user, active_org_id)

    base = select(ProjectFile).where(
        ProjectFile.project_id == project.id,
        ProjectFile.role == ProjectFileRole.attachment,
        ProjectFile.status == ProjectFileStatus.ready,
        ProjectFile.deleted_at.is_(None),
    )
    # Head-of-group only: hide superseded versions. A row is the head when no
    # other ready, non-deleted row in its version group has a higher
    # version_number. Re-uploads (supersedes_id) drop the prior version here but
    # keep it reachable via the /versions endpoint.
    a2 = aliased(ProjectFile)
    has_newer = (
        select(a2.id)
        .where(
            a2.project_id == project.id,
            a2.role == ProjectFileRole.attachment,
            a2.status == ProjectFileStatus.ready,
            a2.deleted_at.is_(None),
            func.coalesce(a2.parent_file_id, a2.id)
            == func.coalesce(ProjectFile.parent_file_id, ProjectFile.id),
            a2.version_number > ProjectFile.version_number,
        )
        .exists()
    )
    base = base.where(~has_newer)
    if category is not None:
        base = base.where(ProjectFile.attachment_category == category)
    if dossier_slot is not None:
        base = base.where(ProjectFile.dossier_slot == dossier_slot)
    # "Link existing" picker: office docs not yet tagged to any dossier slot.
    if unslotted:
        base = base.where(ProjectFile.dossier_slot.is_(None))

    total = (await session.scalar(select(func.count()).select_from(base.subquery()))) or 0
    response.headers["X-Total-Count"] = str(total)

    stmt = (
        base.options(selectinload(ProjectFile.uploaded_by_user))
        .order_by(ProjectFile.created_at.desc())
        .limit(limit)
        .offset(offset)
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
) -> ProjectFile:
    project = await load_project_or_404(session, project_id)
    await require_project_read_access(session, project.id, user, active_org_id)
    return await _load_attachment_or_404(session, project.id, attachment_id)


@router.get("/{attachment_id}/versions", response_model=list[AttachmentRead])
async def list_attachment_versions(
    project_id: UUID,
    attachment_id: UUID,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> list[ProjectFile]:
    """Full version history of one logical attachment, newest version first.

    `attachment_id` may be any version in the group — the root is resolved and
    every non-deleted sibling returned. The first element is the current head.
    """
    project = await load_project_or_404(session, project_id)
    await require_project_read_access(session, project.id, user, active_org_id)
    anchor = await _load_attachment_or_404(session, project.id, attachment_id)
    root_id = anchor.parent_file_id or anchor.id

    stmt = (
        select(ProjectFile)
        .options(selectinload(ProjectFile.uploaded_by_user))
        .where(
            ProjectFile.project_id == project.id,
            ProjectFile.role == ProjectFileRole.attachment,
            or_(ProjectFile.id == root_id, ProjectFile.parent_file_id == root_id),
            ProjectFile.deleted_at.is_(None),
        )
        .order_by(ProjectFile.version_number.desc())
    )
    result = await session.execute(stmt)
    return list(result.scalars().all())


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
    project = await load_project_or_404(session, project_id)
    await require_project_read_access(session, project.id, user, active_org_id)
    att = await _load_attachment_or_404(session, project.id, attachment_id)

    if att.status != ProjectFileStatus.ready:
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
) -> ProjectFile:
    project = await load_project_or_404(session, project_id)
    membership = await require_membership(session, project.id, user.id)
    try:
        require_permission(membership.role, Resource.attachment, Action.update)
    except HTTPException:
        await audit.log_permission_denied(
            role=membership.role.value,
            resource=Resource.attachment.value,
            action=Action.update.value,
            actor_user_id=user.id,
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
        resource_type="project_files",
        resource_id=att.id,
        before=before,
        after=_attachment_snapshot(att),
        actor_user_id=user.id,
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
    project = await load_project_or_404(session, project_id)
    membership = await require_membership(session, project.id, user.id)
    try:
        require_permission(membership.role, Resource.attachment, Action.delete)
    except HTTPException:
        await audit.log_permission_denied(
            role=membership.role.value,
            resource=Resource.attachment.value,
            action=Action.delete.value,
            actor_user_id=user.id,
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
        resource_type="project_files",
        resource_id=attachment_id,
        before=before,
        actor_user_id=user.id,
        project_id=project.id,
        request=request,
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
