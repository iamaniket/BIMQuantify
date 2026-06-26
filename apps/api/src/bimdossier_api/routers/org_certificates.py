"""Org-level certificate library (proof-of-conformity).

Reusable product certificates (KOMO, CE/DoP, warranties) stored at the
organisation level. Two-phase presigned upload (same pattern as project
certificates). Gated by org admin. Certificates can be copied into projects
via the link-from-library endpoint on the project certificates router.
"""

from __future__ import annotations

import logging
from datetime import UTC, date, datetime
from typing import Annotated, Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from bimdossier_api import audit
from bimdossier_api.access import is_org_admin
from bimdossier_api.auth.fastapi_users import current_verified_user
from bimdossier_api.config import Settings, get_settings
from bimdossier_api.models.certificate import CertificateStatus, CertificateType
from bimdossier_api.models.org_certificate import (
    ORG_CERTIFICATE_ALLOWED_EXTENSIONS,
    OrgCertificate,
)
from bimdossier_api.models.org_certificate_tag import OrgCertificateTag
from bimdossier_api.models.user import User
from bimdossier_api.pagination import (
    SortParams,
    apply_sort,
    sort_params,
)
from bimdossier_api.schemas.org_certificate import (
    OrgCertificateDownloadResponse,
    OrgCertificateInitiateRequest,
    OrgCertificateInitiateResponse,
    OrgCertificateRead,
    OrgCertificateStatsResponse,
    OrgCertificateUpdateRequest,
)
from bimdossier_api.storage import StorageBackend, get_attachments_bucket, get_storage
from bimdossier_api.storage.minio import ObjectNotFoundError
from bimdossier_api.tag_rows import replace_tags
from bimdossier_api.tenancy import get_tenant_session, require_active_organization

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/org-certificates", tags=["org-certificates"])


async def _require_org_admin(session: AsyncSession, user: User, organization_id: UUID) -> None:
    if user.is_superuser:
        return
    if await is_org_admin(session, user.id, organization_id):
        return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="ORG_ADMIN_REQUIRED",
    )


def _org_cert_snapshot(cert: OrgCertificate) -> dict[str, object]:
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
        "product_name": cert.product_name,
        "supplier_name": cert.supplier_name,
        "tags": cert.tags,
    }


async def _load_org_cert_or_404(
    session: AsyncSession, certificate_id: UUID
) -> OrgCertificate:
    cert = (
        await session.execute(
            select(OrgCertificate)
            .options(selectinload(OrgCertificate.uploaded_by_user))
            .where(
                OrgCertificate.id == certificate_id,
                OrgCertificate.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if cert is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="ORG_CERTIFICATE_NOT_FOUND",
        )
    return cert


@router.get("/stats", response_model=OrgCertificateStatsResponse)
async def get_org_certificate_stats(
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> OrgCertificateStatsResponse:
    await _require_org_admin(session, user, active_org_id)

    base = select(func.count()).where(
        OrgCertificate.status == CertificateStatus.ready,
        OrgCertificate.deleted_at.is_(None),
    )
    total = (await session.scalar(base)) or 0

    today = datetime.now(UTC).date()
    expiry_cutoff = date(today.year, today.month, today.day)

    expired = (
        await session.scalar(
            base.where(
                OrgCertificate.valid_until.is_not(None),
                OrgCertificate.valid_until < expiry_cutoff,
            )
        )
    ) or 0

    from datetime import timedelta

    soon_cutoff = expiry_cutoff + timedelta(days=30)
    expiring_soon = (
        await session.scalar(
            base.where(
                OrgCertificate.valid_until.is_not(None),
                OrgCertificate.valid_until >= expiry_cutoff,
                OrgCertificate.valid_until <= soon_cutoff,
            )
        )
    ) or 0

    return OrgCertificateStatsResponse(
        total=total, expiring_soon=expiring_soon, expired=expired
    )


@router.post(
    "/initiate",
    response_model=OrgCertificateInitiateResponse,
    status_code=status.HTTP_201_CREATED,
)
async def initiate_org_certificate_upload(
    payload: OrgCertificateInitiateRequest,
    request: Request,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
    storage: StorageBackend = Depends(get_storage),
    settings: Settings = Depends(get_settings),
) -> OrgCertificateInitiateResponse:
    await _require_org_admin(session, user, active_org_id)

    fname_lower = payload.filename.lower()
    dot_pos = fname_lower.rfind(".")
    ext = fname_lower[dot_pos:] if dot_pos >= 0 else ""
    if ext not in ORG_CERTIFICATE_ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "code": "INVALID_FILE_EXTENSION",
                "allowed": sorted(ORG_CERTIFICATE_ALLOWED_EXTENSIONS),
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

    storage_key = f"org-certificates/{uuid4()}{ext}"
    bucket = get_attachments_bucket()

    cert = OrgCertificate(
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
        product_name=payload.product_name,
        supplier_name=payload.supplier_name,
    )
    replace_tags(cert.tag_rows, OrgCertificateTag, payload.tags)
    session.add(cert)
    await session.flush()
    # Async-load tag_rows so the audit snapshot's `tags` property works (a
    # freshly-built row is not selectin-loaded).
    await session.refresh(cert, attribute_names=["tag_rows"])

    upload_url = await storage.presigned_put_url(
        storage_key, payload.content_type, payload.size_bytes, bucket=bucket
    )

    await audit.record(
        session,
        action="org_certificate.initiated",
        resource_type="org_certificates",
        resource_id=cert.id,
        after=_org_cert_snapshot(cert),
        actor_user_id=user.id,
        request=request,
    )

    return OrgCertificateInitiateResponse(
        certificate_id=cert.id,
        upload_url=upload_url,
        storage_key=storage_key,
        expires_in=storage.presign_ttl,
    )


@router.post("/{certificate_id}/complete", response_model=OrgCertificateRead)
async def complete_org_certificate_upload(
    certificate_id: UUID,
    request: Request,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
    storage: StorageBackend = Depends(get_storage),
) -> OrgCertificate:
    await _require_org_admin(session, user, active_org_id)

    cert = await _load_org_cert_or_404(session, certificate_id)
    if cert.status != CertificateStatus.pending:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="ORG_CERTIFICATE_NOT_PENDING",
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
            action="org_certificate.rejected",
            resource_type="org_certificates",
            resource_id=cert.id,
            after={"status": "rejected", "rejection_reason": "SIZE_MISMATCH"},
            actor_user_id=user.id,
            request=request,
        )
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="SIZE_MISMATCH",
        )

    before = {"status": cert.status.value}
    cert.status = CertificateStatus.ready
    await session.flush()

    await audit.record(
        session,
        action="org_certificate.completed",
        resource_type="org_certificates",
        resource_id=cert.id,
        before=before,
        after=_org_cert_snapshot(cert),
        actor_user_id=user.id,
        request=request,
    )
    # Re-fetch so the response carries DB-side timestamps + selectin-loaded tags.
    return await _load_org_cert_or_404(session, certificate_id)


@router.get("", response_model=list[OrgCertificateRead])
async def list_org_certificates(
    response: Response,
    certificate_type: Annotated[CertificateType | None, Query()] = None,
    search: Annotated[str | None, Query(max_length=200)] = None,
    expiring_before: Annotated[date | None, Query()] = None,
    expired: Annotated[bool, Query()] = False,
    tag: Annotated[list[str] | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
    sort: SortParams = Depends(sort_params),
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> list[OrgCertificate]:
    await _require_org_admin(session, user, active_org_id)

    base = select(OrgCertificate).where(
        OrgCertificate.status == CertificateStatus.ready,
        OrgCertificate.deleted_at.is_(None),
    )
    if certificate_type is not None:
        base = base.where(OrgCertificate.certificate_type == certificate_type)
    if search is not None and search.strip():
        pattern = f"%{search.strip()}%"
        base = base.where(
            or_(
                OrgCertificate.original_filename.ilike(pattern),
                OrgCertificate.product_name.ilike(pattern),
                OrgCertificate.supplier_name.ilike(pattern),
                OrgCertificate.issuer.ilike(pattern),
                OrgCertificate.certificate_number.ilike(pattern),
            )
        )
    if expired:
        base = base.where(
            OrgCertificate.valid_until.is_not(None),
            OrgCertificate.valid_until < datetime.now(UTC).date(),
        )
    if expiring_before is not None:
        base = base.where(
            OrgCertificate.valid_until.is_not(None),
            OrgCertificate.valid_until <= expiring_before,
        )
    # Tag filter: each requested tag must be present (AND semantics) so multiple
    # tags narrow the list. Backed by ix_org_certificate_tags_name.
    if tag:
        for tag_name in tag:
            base = base.where(
                select(OrgCertificateTag.id)
                .where(
                    OrgCertificateTag.org_certificate_id == OrgCertificate.id,
                    OrgCertificateTag.name == tag_name,
                )
                .exists()
            )

    total = (await session.scalar(select(func.count()).select_from(base.subquery()))) or 0
    response.headers["X-Total-Count"] = str(total)

    if sort.order_by is not None:
        ordered = apply_sort(
            base,
            sort,
            {
                "product_name": OrgCertificate.product_name,
                "certificate_type": OrgCertificate.certificate_type,
                "supplier_name": OrgCertificate.supplier_name,
                "issuer": OrgCertificate.issuer,
                "valid_until": OrgCertificate.valid_until,
                "created_at": OrgCertificate.created_at,
            },
            default="valid_until",
            tiebreaker=OrgCertificate.id,
        )
    else:
        # Default view: soonest-expiring first (nulls last), newest as tiebreaker.
        ordered = base.order_by(
            OrgCertificate.valid_until.asc().nulls_last(), OrgCertificate.created_at.desc()
        )
    stmt = (
        ordered.options(selectinload(OrgCertificate.uploaded_by_user))
        .limit(limit)
        .offset(offset)
    )
    result = await session.execute(stmt)
    return list(result.scalars().all())


@router.get("/tags", response_model=list[str])
async def list_org_certificate_tags(
    q: Annotated[str | None, Query(max_length=64)] = None,
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> list[str]:
    """Distinct tag names for autocomplete. Optional `q` prefix-matches (ILIKE).

    Declared before `/{certificate_id}` so the static path wins the route match.
    """
    await _require_org_admin(session, user, active_org_id)
    stmt = (
        select(OrgCertificateTag.name)
        .distinct()
        .order_by(OrgCertificateTag.name)
        .limit(limit)
    )
    if q and q.strip():
        stmt = stmt.where(OrgCertificateTag.name.ilike(f"{q.strip()}%"))
    result = await session.execute(stmt)
    return list(result.scalars().all())


@router.get("/{certificate_id}", response_model=OrgCertificateRead)
async def get_org_certificate(
    certificate_id: UUID,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> OrgCertificate:
    await _require_org_admin(session, user, active_org_id)
    return await _load_org_cert_or_404(session, certificate_id)


@router.get("/{certificate_id}/download", response_model=OrgCertificateDownloadResponse)
async def download_org_certificate(
    certificate_id: UUID,
    disposition: Annotated[Literal["attachment", "inline"], Query()] = "attachment",
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
    storage: StorageBackend = Depends(get_storage),
) -> OrgCertificateDownloadResponse:
    await _require_org_admin(session, user, active_org_id)
    cert = await _load_org_cert_or_404(session, certificate_id)

    if cert.status != CertificateStatus.ready:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="ORG_CERTIFICATE_NOT_READY",
        )

    bucket = get_attachments_bucket()
    url = await storage.presigned_get_url(
        cert.storage_key, cert.original_filename, disposition=disposition, bucket=bucket
    )
    return OrgCertificateDownloadResponse(download_url=url, expires_in=storage.presign_ttl)


@router.patch("/{certificate_id}", response_model=OrgCertificateRead)
async def update_org_certificate(
    certificate_id: UUID,
    payload: OrgCertificateUpdateRequest,
    request: Request,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> OrgCertificate:
    await _require_org_admin(session, user, active_org_id)

    cert = await _load_org_cert_or_404(session, certificate_id)
    before = _org_cert_snapshot(cert)

    updates = payload.model_dump(exclude_unset=True)
    # Tags are normalized into rows, not a column — pop and replace the set.
    has_tags = "tags" in updates
    tags = updates.pop("tags", None)
    for field, value in updates.items():
        setattr(cert, field, value)
    if has_tags:
        replace_tags(cert.tag_rows, OrgCertificateTag, tags)
    await session.flush()

    await audit.record(
        session,
        action="org_certificate.updated",
        resource_type="org_certificates",
        resource_id=cert.id,
        before=before,
        after=_org_cert_snapshot(cert),
        actor_user_id=user.id,
        request=request,
    )
    # Re-fetch so the response carries DB-side timestamps + selectin-loaded tags.
    return await _load_org_cert_or_404(session, certificate_id)


@router.delete("/{certificate_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_org_certificate(
    certificate_id: UUID,
    request: Request,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> Response:
    await _require_org_admin(session, user, active_org_id)

    cert = await _load_org_cert_or_404(session, certificate_id)
    before = _org_cert_snapshot(cert)
    cert.soft_delete()
    await session.flush()

    await audit.record(
        session,
        action="org_certificate.deleted",
        resource_type="org_certificates",
        resource_id=certificate_id,
        before=before,
        actor_user_id=user.id,
        request=request,
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
