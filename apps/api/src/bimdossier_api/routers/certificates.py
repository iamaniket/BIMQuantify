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
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased, selectinload

from bimdossier_api import audit
from bimdossier_api.access import (
    load_project_or_404,
    require_membership,
    require_project_read_access,
    require_project_writable,
)
from bimdossier_api.auth.fastapi_users import current_verified_user
from bimdossier_api.auth.permissions import Action, Resource, require_permission
from bimdossier_api.auth.ratelimit import UPLOAD_INITIATE_LIMITER
from bimdossier_api.config import Settings, get_settings
from bimdossier_api.models.certificate import (
    CERTIFICATE_ALLOWED_EXTENSIONS,
    Certificate,
    CertificateStatus,
    CertificateType,
)
from bimdossier_api.models.org_certificate import OrgCertificate
from bimdossier_api.models.user import User
from bimdossier_api.schemas.certificate import (
    CertificateDownloadResponse,
    CertificateInitiateRequest,
    CertificateInitiateResponse,
    CertificateRead,
    CertificateUpdateRequest,
)
from bimdossier_api.schemas.org_certificate import LinkFromLibraryRequest
from bimdossier_api.content_disposition import resolve_attachment_download
from bimdossier_api.storage import (
    StorageBackend,
    get_attachments_bucket,
    get_storage,
    upload_service,
)
from bimdossier_api.tenancy import get_tenant_session, require_active_organization

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/projects/{project_id}/certificates", tags=["certificates"])


async def _next_version_in_group(
    session: AsyncSession, project_id: UUID, supersedes_id: UUID
) -> tuple[int, UUID]:
    """Resolve the version group of `supersedes_id` → (next_version, root_id).

    Mirrors the attachments helper: the root is `parent_certificate_id` (or the
    row itself); the next number is `max(version_number) + 1` over the whole
    group, so numbers are never reused. 404 if not a live certificate here.
    """
    superseded = await _load_certificate_or_404(session, project_id, supersedes_id)
    root_id = superseded.parent_certificate_id or superseded.id
    max_version = (
        await session.scalar(
            select(func.max(Certificate.version_number)).where(
                or_(Certificate.id == root_id, Certificate.parent_certificate_id == root_id)
            )
        )
    ) or 0
    return max_version + 1, root_id


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
        "org_certificate_id": str(cert.org_certificate_id) if cert.org_certificate_id else None,
        "version_number": cert.version_number,
        "parent_certificate_id": (
            str(cert.parent_certificate_id) if cert.parent_certificate_id else None
        ),
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
    dependencies=[Depends(UPLOAD_INITIATE_LIMITER)],
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
    project = await load_project_or_404(session, project_id)
    membership = await require_membership(session, project.id, user.id)
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
    require_project_writable(project)

    ext = upload_service.parse_extension(payload.filename)
    upload_service.ensure_allowed_extension(ext, CERTIFICATE_ALLOWED_EXTENSIONS)
    upload_service.ensure_within_size_limit(payload.size_bytes, settings.attachment_max_bytes)

    # New version of an existing certificate (supersedes_id set) joins that
    # certificate's version group; otherwise a fresh root at version 1.
    version_number = 1
    parent_id: UUID | None = None
    if payload.supersedes_id is not None:
        version_number, parent_id = await _next_version_in_group(
            session, project.id, payload.supersedes_id
        )

    storage_key = upload_service.build_storage_key(project.id, "certificates", ext)
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
        version_number=version_number,
        parent_certificate_id=parent_id,
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
    project = await load_project_or_404(session, project_id)
    membership = await require_membership(session, project.id, user.id)
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
    actual_size = await upload_service.head_verify_size(storage, cert.storage_key, bucket=bucket)
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

    completed_action = (
        "certificate.version_added"
        if cert.parent_certificate_id is not None
        else "certificate.completed"
    )
    await audit.record(
        session,
        action=completed_action,
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
    expiring_before: Annotated[date | None, Query()] = None,
    expired: Annotated[bool, Query()] = False,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> list[Certificate]:
    project = await load_project_or_404(session, project_id)
    await require_project_read_access(session, project.id, user, active_org_id)

    base = select(Certificate).where(
        Certificate.project_id == project.id,
        Certificate.status == CertificateStatus.ready,
        Certificate.deleted_at.is_(None),
    )
    # Head-of-group only: hide superseded versions (same rule as attachments).
    c2 = aliased(Certificate)
    has_newer = (
        select(c2.id)
        .where(
            c2.project_id == project.id,
            c2.status == CertificateStatus.ready,
            c2.deleted_at.is_(None),
            func.coalesce(c2.parent_certificate_id, c2.id)
            == func.coalesce(Certificate.parent_certificate_id, Certificate.id),
            c2.version_number > Certificate.version_number,
        )
        .exists()
    )
    base = base.where(~has_newer)
    if certificate_type is not None:
        base = base.where(Certificate.certificate_type == certificate_type)
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
    project = await load_project_or_404(session, project_id)
    await require_project_read_access(session, project.id, user, active_org_id)
    return await _load_certificate_or_404(session, project.id, certificate_id)


@router.get("/{certificate_id}/versions", response_model=list[CertificateRead])
async def list_certificate_versions(
    project_id: UUID,
    certificate_id: UUID,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> list[Certificate]:
    """Full version history of one logical certificate, newest version first.

    `certificate_id` may be any version in the group; the first element returned
    is the current head.
    """
    project = await load_project_or_404(session, project_id)
    await require_project_read_access(session, project.id, user, active_org_id)
    anchor = await _load_certificate_or_404(session, project.id, certificate_id)
    root_id = anchor.parent_certificate_id or anchor.id

    stmt = (
        select(Certificate)
        .options(selectinload(Certificate.uploaded_by_user))
        .where(
            Certificate.project_id == project.id,
            or_(Certificate.id == root_id, Certificate.parent_certificate_id == root_id),
            Certificate.deleted_at.is_(None),
        )
        .order_by(Certificate.version_number.desc())
    )
    result = await session.execute(stmt)
    return list(result.scalars().all())


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
    project = await load_project_or_404(session, project_id)
    await require_project_read_access(session, project.id, user, active_org_id)
    cert = await _load_certificate_or_404(session, project.id, certificate_id)

    if cert.status != CertificateStatus.ready:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="CERTIFICATE_NOT_READY",
        )

    bucket = get_attachments_bucket()
    # Canonical extension-derived content-type overrides the stored (caller-supplied)
    # type, and non-inline-safe types are forced to `attachment` — stored-XSS guard
    # (mirrors attachments.py; the stored content_type is not trusted at serve time).
    content_type, safe_disposition = resolve_attachment_download(cert.original_filename, disposition)
    url = await storage.presigned_get_url(
        cert.storage_key,
        cert.original_filename,
        disposition=safe_disposition,
        response_content_type=content_type,
        bucket=bucket,
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
    project = await load_project_or_404(session, project_id)
    membership = await require_membership(session, project.id, user.id)
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
    storage: StorageBackend = Depends(get_storage),
) -> Response:
    project = await load_project_or_404(session, project_id)
    membership = await require_membership(session, project.id, user.id)
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
    # Refuse to delete a version that still has newer versions chained to it
    # (M-db3) — same version-group guard as attachments. The certificate version
    # group is `coalesce(parent_certificate_id, id)`; deleting a lineage root
    # while children exist would orphan the version display. Delete newest-first.
    has_newer_versions = await session.scalar(
        select(Certificate.id)
        .where(
            Certificate.parent_certificate_id == cert.id,
            Certificate.deleted_at.is_(None),
        )
        .limit(1)
    )
    if has_newer_versions is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="FILE_VERSION_HAS_DESCENDANTS",
        )
    before = _certificate_snapshot(cert)
    storage_key = cert.storage_key
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
    # Best-effort object cleanup (DLC-2): the row delete is a soft-delete with no
    # restore path, so the stored bytes can go now. Never fail the request if the
    # object is already gone.
    try:
        await storage.delete_object(storage_key, bucket=get_attachments_bucket())
    except Exception:
        logger.warning(
            "delete_certificate: storage cleanup failed for %s", certificate_id,
            exc_info=True,
        )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/link-from-library",
    response_model=CertificateRead,
    status_code=status.HTTP_201_CREATED,
)
async def link_from_library(
    project_id: UUID,
    payload: LinkFromLibraryRequest,
    request: Request,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
    storage: StorageBackend = Depends(get_storage),
) -> Certificate:
    project = await load_project_or_404(session, project_id)
    membership = await require_membership(session, project.id, user.id)
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
    require_project_writable(project)

    org_cert = (
        await session.execute(
            select(OrgCertificate).where(
                OrgCertificate.id == payload.org_certificate_id,
                OrgCertificate.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if org_cert is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="ORG_CERTIFICATE_NOT_FOUND",
        )
    if org_cert.status != CertificateStatus.ready:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="ORG_CERTIFICATE_NOT_READY",
        )

    ext = upload_service.parse_extension(org_cert.original_filename)
    new_storage_key = upload_service.build_storage_key(project.id, "certificates", ext)

    bucket = get_attachments_bucket()
    await storage.copy_object(org_cert.storage_key, new_storage_key, bucket=bucket)

    cert = Certificate(
        project_id=project.id,
        uploaded_by_user_id=user.id,
        storage_key=new_storage_key,
        original_filename=org_cert.original_filename,
        size_bytes=org_cert.size_bytes,
        content_type=org_cert.content_type,
        content_sha256=org_cert.content_sha256,
        certificate_type=org_cert.certificate_type,
        status=CertificateStatus.ready,
        description=org_cert.description,
        certificate_number=org_cert.certificate_number,
        issuer=org_cert.issuer,
        subject=org_cert.subject,
        valid_from=org_cert.valid_from,
        valid_until=org_cert.valid_until,
        org_certificate_id=org_cert.id,
    )
    session.add(cert)
    await session.flush()
    await session.refresh(cert, ["uploaded_by_user"])

    await audit.record(
        session,
        action="certificate.linked_from_library",
        resource_type="certificates",
        resource_id=cert.id,
        after={
            **_certificate_snapshot(cert),
            "source_org_certificate_id": str(org_cert.id),
        },
        actor_user_id=user.id,
        project_id=project.id,
        request=request,
    )
    return cert
