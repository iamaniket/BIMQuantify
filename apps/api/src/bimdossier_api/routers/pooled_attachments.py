"""Free-tier attachments (photo evidence on free snags).

The pooled analog of `routers.attachments` — a two-phase presigned upload
(initiate → browser/app PUT → complete) over `public.pooled_attachments`. Used by
the mobile snagging app so a free inspector can attach photos to a finding, and by
the offline outbox (idempotency-key replay).

Isolation: `get_free_session` (ROLE bim_app, only `app.current_user_id`) +
owner-OR-member RLS on `pooled_attachments`. Objects live under the project owner's
free key prefix (`free/<owner>/attachments/...`) in the default bucket (same as
free models), so they inherit the free CORS config. Members (owner or editor) may
upload evidence for a snag they file; viewers are read-only — gated by
`require_free_write_role` (the editor/viewer split RLS doesn't express).

The finding→photo link is created by `routers.pooled_documents` (the snag create /
update accepts `photo_ids` / `resolution_evidence_ids`), not here — the offline
flow uploads the photo before the snag exists.
"""

from typing import Annotated, Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy import text as sql_text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from bimdossier_api.auth.fastapi_users import current_verified_user
from bimdossier_api.auth.ratelimit import FREE_UPLOAD_INITIATE_LIMITER
from bimdossier_api.background.locks import lock_id_for
from bimdossier_api.config import Settings, get_settings
from bimdossier_api.db import get_session_maker
from bimdossier_api.free_limits import resolve_free_limits
from bimdossier_api.idempotency import idempotency_key_header, is_idempotency_conflict
from bimdossier_api.models.pooled_attachment import PooledAttachment
from bimdossier_api.models.pooled_project import PooledProject
from bimdossier_api.models.project_file import ATTACHMENT_ALLOWED_EXTENSIONS
from bimdossier_api.models.user import User
from bimdossier_api.routers.free_access import (
    assert_free_account_not_expired,
    free_owner_used_bytes,
    require_free_tier_enabled,
    require_free_write_role,
    resolve_free_role,
)
from bimdossier_api.schemas.free_attachment import (
    PooledAttachmentDownloadResponse,
    PooledAttachmentInitiateRequest,
    PooledAttachmentInitiateResponse,
    PooledAttachmentRead,
)
from bimdossier_api.storage import StorageBackend, get_storage, upload_service
from bimdossier_api.storage.scoping import free_key_prefix
from bimdossier_api.tenancy import get_free_session, open_free_session

router = APIRouter(
    prefix="/free/projects/{project_id}/attachments",
    tags=["free-viewer"],
    dependencies=[Depends(require_free_tier_enabled)],
)


async def _project_owner_for_write(session: AsyncSession, project_id: UUID, user: User) -> UUID:
    """Return the project's owner id after asserting the caller MAY WRITE.

    404 FREE_PROJECT_NOT_FOUND when the project isn't visible to the caller (RLS),
    403 FREE_FORBIDDEN when they're a read-only viewer, 403 FREE_ACCOUNT_EXPIRED
    when the acting free account's trial has elapsed (read-only). The returned
    owner id is the attachment's `owner_user_id` (the RLS / quota key), even when
    an invited editor is the one uploading.
    """
    owner_id = await session.scalar(
        select(PooledProject.owner_user_id).where(PooledProject.id == project_id)
    )
    if owner_id is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="FREE_PROJECT_NOT_FOUND")
    role = "owner" if owner_id == user.id else await resolve_free_role(session, project_id, user.id)
    require_free_write_role(role)
    await assert_free_account_not_expired(user)
    return owner_id


async def _load_attachment_or_404(
    session: AsyncSession, project_id: UUID, attachment_id: UUID
) -> PooledAttachment:
    """Participant-readable attachment load (RLS scopes visibility)."""
    att = (
        await session.execute(
            select(PooledAttachment).where(
                PooledAttachment.id == attachment_id,
                PooledAttachment.pooled_project_id == project_id,
                PooledAttachment.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if att is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="FREE_ATTACHMENT_NOT_FOUND"
        )
    return att


@router.post(
    "/initiate",
    response_model=PooledAttachmentInitiateResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(FREE_UPLOAD_INITIATE_LIMITER)],
)
async def initiate_free_attachment_upload(
    project_id: UUID,
    payload: PooledAttachmentInitiateRequest,
    user: User = Depends(current_verified_user),
    session: AsyncSession = Depends(get_free_session),
    storage: StorageBackend = Depends(get_storage),
    settings: Settings = Depends(get_settings),
    idempotency_key: str | None = Depends(idempotency_key_header),
) -> PooledAttachmentInitiateResponse:
    owner_id = await _project_owner_for_write(session, project_id, user)

    ext = upload_service.parse_extension(payload.filename)
    upload_service.ensure_allowed_extension(ext, ATTACHMENT_ALLOWED_EXTENSIONS)
    category = ATTACHMENT_ALLOWED_EXTENSIONS[ext]
    upload_service.ensure_within_size_limit(payload.size_bytes, settings.attachment_max_bytes)

    # Offline-replay idempotency: a keyed replay returns the original row with a
    # FRESH presigned URL (the first one may have expired during the offline
    # window). Keyed on the OWNER so the per-owner unique index is the backstop.
    if idempotency_key is not None:
        prior = (
            await session.execute(
                select(PooledAttachment).where(
                    PooledAttachment.owner_user_id == owner_id,
                    PooledAttachment.idempotency_key == idempotency_key,
                    PooledAttachment.deleted_at.is_(None),
                )
            )
        ).scalar_one_or_none()
        if prior is not None:
            fresh_url = await storage.presigned_put_url(
                prior.storage_key,
                prior.content_type or "application/octet-stream",
                prior.size_bytes,
            )
            return PooledAttachmentInitiateResponse(
                attachment_id=prior.id,
                upload_url=fresh_url,
                storage_key=prior.storage_key,
                expires_in=storage.presign_ttl,
            )

    # FSL-1: photos count toward the same aggregate 1 GB ceiling as model files, so
    # a free user can't bypass the cap with unbounded evidence. Serialize this
    # owner's concurrent initiates (transaction-scoped advisory lock, shared key
    # with the model-upload path), then read the owner's effective cap + total
    # bytes on a SUPERUSER probe — the override table has no bim_app grant, and a
    # MEMBER uploader's RLS session can't see the owner's bytes in projects they
    # don't share.
    await session.execute(
        sql_text("SELECT pg_advisory_xact_lock(:k)"),
        {"k": lock_id_for(f"free_upload:{owner_id}")},
    )
    async with get_session_maker()() as probe, probe.begin():
        owner = await probe.get(User, owner_id)
        cap = (
            (await resolve_free_limits(owner, probe)).storage_max_bytes
            if owner is not None
            else settings.free_storage_max_bytes
        )
        used_bytes = await free_owner_used_bytes(probe, owner_id)
    if used_bytes + payload.size_bytes > cap:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="FREE_STORAGE_CAP_REACHED",
        )

    attachment_id = uuid4()
    storage_key = f"{free_key_prefix(owner_id)}attachments/{attachment_id}/source{ext}"
    capture_meta = (
        payload.capture_metadata.model_dump(mode="json")
        if payload.capture_metadata is not None
        else None
    )
    att = PooledAttachment(
        id=attachment_id,
        owner_user_id=owner_id,
        pooled_project_id=project_id,
        uploaded_by_user_id=user.id,
        storage_key=storage_key,
        original_filename=payload.filename,
        size_bytes=payload.size_bytes,
        content_type=payload.content_type,
        content_sha256=payload.content_sha256,
        attachment_category=category.value,
        status="pending",
        capture_metadata=capture_meta,
        idempotency_key=idempotency_key,
    )
    session.add(att)
    try:
        await session.flush()
    except IntegrityError as exc:
        # Concurrent replay lost the race to insert the same idempotency key.
        if idempotency_key is not None and is_idempotency_conflict(exc):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="IDEMPOTENCY_KEY_CONFLICT",
            ) from exc
        raise
    upload_url = await storage.presigned_put_url(
        storage_key, payload.content_type, payload.size_bytes
    )
    return PooledAttachmentInitiateResponse(
        attachment_id=att.id,
        upload_url=upload_url,
        storage_key=storage_key,
        expires_in=storage.presign_ttl,
    )


@router.post("/{attachment_id}/complete", response_model=PooledAttachmentRead)
async def complete_free_attachment_upload(
    project_id: UUID,
    attachment_id: UUID,
    user: User = Depends(current_verified_user),
    storage: StorageBackend = Depends(get_storage),
) -> PooledAttachmentRead:
    """Finalize a two-phase free attachment upload: HEAD-verify then flip ready.

    The S3 HEAD runs with NO DB connection held (phase B), the same multi-phase
    discipline as the free model `complete`."""
    # Phase A — load + write-gate + snapshot (short free session).
    async with open_free_session(user.id) as session:
        await _project_owner_for_write(session, project_id, user)
        att = await _load_attachment_or_404(session, project_id, attachment_id)
        if att.status != "pending":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail="FREE_ATTACHMENT_NOT_PENDING"
            )
        storage_key = att.storage_key
        declared = att.size_bytes

    # Phase B — HEAD the uploaded object (no DB connection held).
    actual = await upload_service.head_verify_size(storage, storage_key)

    # Phase C — flip ready (or reject on size mismatch), then re-read.
    async with open_free_session(user.id) as session:
        att = await _load_attachment_or_404(session, project_id, attachment_id)
        if actual != declared:
            att.status = "rejected"
            att.rejection_reason = "SIZE_MISMATCH"
            await session.flush()
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="SIZE_MISMATCH"
            )
        att.status = "ready"
        await session.flush()
        # Refresh so the onupdate-expired `updated_at` is re-fetched in the async
        # context (avoids a lazy-load MissingGreenlet during model_validate).
        await session.refresh(att)
        return PooledAttachmentRead.model_validate(att)


@router.get("/{attachment_id}/download", response_model=PooledAttachmentDownloadResponse)
async def download_free_attachment(
    project_id: UUID,
    attachment_id: UUID,
    disposition: Annotated[Literal["attachment", "inline"], Query()] = "inline",
    user: User = Depends(current_verified_user),
    session: AsyncSession = Depends(get_free_session),
    storage: StorageBackend = Depends(get_storage),
) -> PooledAttachmentDownloadResponse:
    att = await _load_attachment_or_404(session, project_id, attachment_id)
    if att.status != "ready":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="FREE_ATTACHMENT_NOT_READY"
        )
    url = await storage.presigned_get_url(
        att.storage_key, att.original_filename, disposition=disposition
    )
    return PooledAttachmentDownloadResponse(download_url=url, expires_in=storage.presign_ttl)
