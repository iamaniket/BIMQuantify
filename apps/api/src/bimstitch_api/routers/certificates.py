"""Project-level certificate storage (proof-of-conformity).

Two-phase presigned upload (same pattern as attachments/project_files):
initiate -> browser PUT -> complete. Unlike attachments, a certificate carries
structured conformity metadata (type, number, issuer, subject, validity window)
so the dossier can filter by type and warn on expiry. Certificates need no
post-upload processing — `complete` just HEAD-verifies the object and flips the
row to `ready`. Every mutation writes an audit entry in the same transaction.
"""

from __future__ import annotations

import logging
from datetime import UTC, date, datetime
from typing import Annotated, Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from bimstitch_api import audit
from bimstitch_api.auth.fastapi_users import current_verified_user
from bimstitch_api.auth.permissions import Action, Resource, require_permission
from bimstitch_api.config import Settings, get_settings
from bimstitch_api.models.certificate import (
    CERTIFICATE_ALLOWED_EXTENSIONS,
    Certificate,
    CertificateStatus,
    CertificateType,
)
from bimstitch_api.models.user import User
from bimstitch_api.routers.projects import (
    _load_project_or_404,
    _require_membership,
    _require_project_read_access,
    _require_project_writable,
)
from bimstitch_api.schemas.certificate import (
    CertificateDownloadResponse,
    CertificateInitiateRequest,
    CertificateInitiateResponse,
    CertificateRead,
    CertificateUpdateRequest,
)
from bimstitch_api.storage import StorageBackend, get_attachments_bucket, get_storage
from bimstitch_api.storage.minio import ObjectNotFoundError
from bimstitch_api.tenancy import get_tenant_session, require_active_organization

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/projects/{project_id}/certificates", tags=["certificates"])


def _certificate_snapshot(cert: Certificate) -> dict[str, object]:
    return {
        "original_filename": cert.original_filename,
        "size_bytes": cert.size_bytes,
        "content_type": cert.content_type,
        "certificate_type": cert.certificate_type.value,
        "status": cert.status.value,
        "description": cert.description,
        "certificate_number": cert.certificate_number,
        "issuer": cert.issuer,
        "subject": cert.subject,
        "valid_from": cert.valid_from.isoformat() if cert.valid_from else None,
        "valid_until": cert.valid_until.isoformat() if cert.valid_until else None,
        "linked_element_global_id": cert.linked_element_global_id,
        "linked_model_id": str(cert.linked_model_id) if cert.linked_model_id else None,
        "linked_file_id": str(cert.linked_file_id) if cert.linked_file_id else None,
    }


async def _load_certificate_or_404(
    session: AsyncSession, project_id: UUID, certificate_id: UUID
) -> Certificate:
    cert = (
        await session.execute(
            select(Certificate)
            .options(selectinload(Certificate.uploaded_by_user))
            .where(
                Certificate.id == certificate_id,
                Certificate.project_id == project_id,
                Certificate.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if cert is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="CERTIFICATE_NOT_FOUND")
    return cert


@router.post(
    "/initiate",
    response_model=CertificateInitiateResponse,
    status_code=status.HTTP_201_CREATED,
)
async def initiate_certificate_upload(
    project_id: UUID,
    payload: CertificateInitiateRequest,
    request: Request,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
    storage: StorageBackend = Depends(get_storage),
    settings: Settings = Depends(get_settings),
) -> CertificateInitiateResponse:
    project = await _load_project_or_404(session, project_id)
    membership = await _require_membership(session, project.id, user.id)
    try:
        require_permission(membership.role, Resource.certificate, Action.create)
    except HTTPException:
        await audit.log_permission_denied(
            role=membership.role.value,
            resource=Resource.certificate.value,
            action=Action.create.value,
            actor_user_id=user.id,
            request=request,
        )
        raise
    _require_project_writable(project)

    fname_lower = payload.filename.lower()
    dot_pos = fname_lower.rfind(".")
    ext = fname_lower[dot_pos:] if dot_pos >= 0 else ""
    if ext not in CERTIFICATE_ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "code": "INVALID_FILE_EXTENSION",
                "allowed": sorted(CERTIFICATE_ALLOWED_EXTENSIONS),
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

    storage_key = f"projects/{project.id}/certificates/{uuid4()}{ext}"
    bucket = get_attachments_bucket()

    cert = Certificate(
        project_id=project.id,
        uploaded_by_user_id=user.id,
        storage_key=storage_key,
        original_filename=payload.filename,
        size_bytes=payload.size_bytes,
        content_type=payload.content_type,
        content_sha256=payload.content_sha256,
        certificate_type=payload.certificate_type,
        status=CertificateStatus.pending,
        description=payload.description,
        certificate_number=payload.certificate_number,
        issuer=payload.issuer,
        subject=payload.subject,
        valid_from=payload.valid_from,
        valid_until=payload.valid_until,
        linked_element_global_id=payload.linked_element_global_id,
        linked_model_id=payload.linked_model_id,
        linked_file_id=payload.linked_file_id,
    )
    session.add(cert)
    await session.flush()
    await session.refresh(cert)

    upload_url = await storage.presigned_put_url(
        storage_key, payload.content_type, payload.size_bytes, bucket=bucket
    )

    await audit.record(
        session,
        action="certificate.initiated",
        resource_type="certificates",
        resource_id=cert.id,
        after=_certificate_snapshot(cert),
        actor_user_id=user.id,
        project_id=project.id,
        request=request,
    )

    return CertificateInitiateResponse(
        certificate_id=cert.id,
        upload_url=upload_url,
        storage_key=storage_key,
        expires_in=storage.presign_ttl,
    )


@router.post("/{certificate_id}/complete", response_model=CertificateRead)
async def complete_certificate_upload(
    project_id: UUID,
    certificate_id: UUID,
    request: Request,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
    storage: StorageBackend = Depends(get_storage),
) -> Certificate:
    project = await _load_project_or_404(session, project_id)
    membership = await _require_membership(session, project.id, user.id)
    try:
        require_permission(membership.role, Resource.certificate, Action.create)
    except HTTPException:
        await audit.log_permission_denied(
            role=membership.role.value,
            resource=Resource.certificate.value,
            action=Action.create.value,
            actor_user_id=user.id,
            request=request,
        )
        raise

    cert = await _load_certificate_or_404(session, project.id, certificate_id)
    if cert.status != CertificateStatus.pending:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="CERTIFICATE_NOT_PENDING",
        )

    bucket = get_attachments_bucket()
    try:
        head = await storage.head_object(cert.storage_key, bucket=bucket)
    except ObjectNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="OBJECT_NOT_UPLOADED",
        )

    actual_size = head.get("ContentLength", 0)
    if actual_size != cert.size_bytes:
        cert.status = CertificateStatus.rejected
        cert.rejection_reason = "SIZE_MISMATCH"
        await session.flush()
        await audit.record(
            session,
            action="certificate.rejected",
            resource_type="certificates",
            resource_id=cert.id,
            after={"status": "rejected", "rejection_reason": "SIZE_MISMATCH"},
            actor_user_id=user.id,
            project_id=project.id,
            request=request,
        )
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="SIZE_MISMATCH",
        )

    before = {"status": cert.status.value}
    cert.status = CertificateStatus.ready
    await session.flush()
    await session.refresh(cert)

    await audit.record(
        session,
        action="certificate.completed",
        resource_type="certificates",
        resource_id=cert.id,
        before=before,
        after=_certificate_snapshot(cert),
        actor_user_id=user.id,
        project_id=project.id,
        request=request,
    )
    return cert


@router.get("", response_model=list[CertificateRead])
async def list_certificates(
    project_id: UUID,
    response: Response,
    certificate_type: Annotated[CertificateType | None, Query()] = None,
    linked_element_global_id: Annotated[str | None, Query(max_length=22)] = None,
    linked_file_id: Annotated[UUID | None, Query()] = None,
    expiring_before: Annotated[date | None, Query()] = None,
    expired: Annotated[bool, Query()] = False,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> list[Certificate]:
    project = await _load_project_or_404(session, project_id)
    await _require_project_read_access(session, project.id, user, active_org_id)

    base = select(Certificate).where(
        Certificate.project_id == project.id,
        Certificate.status == CertificateStatus.ready,
        Certificate.deleted_at.is_(None),
    )
    if certificate_type is not None:
        base = base.where(Certificate.certificate_type == certificate_type)
    if linked_element_global_id is not None:
        base = base.where(Certificate.linked_element_global_id == linked_element_global_id)
    if linked_file_id is not None:
        base = base.where(Certificate.linked_file_id == linked_file_id)
    # Expiry filters drive the #N6 expiry-warning surface. A null valid_until is
    # "never expires", so it is excluded from both expiry views.
    if expired:
        base = base.where(
            Certificate.valid_until.is_not(None),
            Certificate.valid_until < datetime.now(UTC).date(),
        )
    if expiring_before is not None:
        base = base.where(
            Certificate.valid_until.is_not(None),
            Certificate.valid_until <= expiring_before,
        )

    total = (await session.scalar(select(func.count()).select_from(base.subquery()))) or 0
    response.headers["X-Total-Count"] = str(total)

    stmt = (
        base.options(selectinload(Certificate.uploaded_by_user))
        .order_by(Certificate.valid_until.asc().nulls_last(), Certificate.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    result = await session.execute(stmt)
    return list(result.scalars().all())


@router.get("/{certificate_id}", response_model=CertificateRead)
async def get_certificate(
    project_id: UUID,
    certificate_id: UUID,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> Certificate:
    project = await _load_project_or_404(session, project_id)
    await _require_project_read_access(session, project.id, user, active_org_id)
    return await _load_certificate_or_404(session, project.id, certificate_id)


@router.get("/{certificate_id}/download", response_model=CertificateDownloadResponse)
async def download_certificate(
    project_id: UUID,
    certificate_id: UUID,
    disposition: Annotated[Literal["attachment", "inline"], Query()] = "attachment",
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
    storage: StorageBackend = Depends(get_storage),
) -> CertificateDownloadResponse:
    project = await _load_project_or_404(session, project_id)
    await _require_project_read_access(session, project.id, user, active_org_id)
    cert = await _load_certificate_or_404(session, project.id, certificate_id)

    if cert.status != CertificateStatus.ready:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="CERTIFICATE_NOT_READY",
        )

    bucket = get_attachments_bucket()
    url = await storage.presigned_get_url(
        cert.storage_key, cert.original_filename, disposition=disposition, bucket=bucket
    )
    return CertificateDownloadResponse(download_url=url, expires_in=storage.presign_ttl)


@router.patch("/{certificate_id}", response_model=CertificateRead)
async def update_certificate(
    project_id: UUID,
    certificate_id: UUID,
    payload: CertificateUpdateRequest,
    request: Request,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> Certificate:
    project = await _load_project_or_404(session, project_id)
    membership = await _require_membership(session, project.id, user.id)
    try:
        require_permission(membership.role, Resource.certificate, Action.update)
    except HTTPException:
        await audit.log_permission_denied(
            role=membership.role.value,
            resource=Resource.certificate.value,
            action=Action.update.value,
            actor_user_id=user.id,
            resource_id=certificate_id,
            request=request,
        )
        raise

    cert = await _load_certificate_or_404(session, project.id, certificate_id)
    before = _certificate_snapshot(cert)

    updates = payload.model_dump(exclude_unset=True)
    for field, value in updates.items():
        setattr(cert, field, value)
    await session.flush()
    await session.refresh(cert)

    await audit.record(
        session,
        action="certificate.updated",
        resource_type="certificates",
        resource_id=cert.id,
        before=before,
        after=_certificate_snapshot(cert),
        actor_user_id=user.id,
        project_id=project.id,
        request=request,
    )
    return cert


@router.delete("/{certificate_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_certificate(
    project_id: UUID,
    certificate_id: UUID,
    request: Request,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> Response:
    project = await _load_project_or_404(session, project_id)
    membership = await _require_membership(session, project.id, user.id)
    try:
        require_permission(membership.role, Resource.certificate, Action.delete)
    except HTTPException:
        await audit.log_permission_denied(
            role=membership.role.value,
            resource=Resource.certificate.value,
            action=Action.delete.value,
            actor_user_id=user.id,
            resource_id=certificate_id,
            request=request,
        )
        raise

    cert = await _load_certificate_or_404(session, project.id, certificate_id)
    before = _certificate_snapshot(cert)
    cert.soft_delete()
    await session.flush()

    await audit.record(
        session,
        action="certificate.deleted",
        resource_type="certificates",
        resource_id=certificate_id,
        before=before,
        actor_user_id=user.id,
        project_id=project.id,
        request=request,
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
