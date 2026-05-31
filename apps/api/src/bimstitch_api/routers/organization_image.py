"""Upload / delete an organization logo image.

Two route prefixes:
- /admin/organizations/{organization_id}/image  — superadmin
- /organizations/{organization_id}/image        — org admin
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile, status
from pydantic import BaseModel
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from bimstitch_api import audit
from bimstitch_api.auth.dependencies import require_org_admin, require_superuser
from bimstitch_api.db import get_async_session
from bimstitch_api.models.organization import Organization
from bimstitch_api.models.user import User
from bimstitch_api.storage import StorageBackend, get_attachments_bucket, get_storage

IMAGE_MAX_BYTES = 2 * 1024 * 1024  # 2 MB
IMAGE_ALLOWED_TYPES = {"image/png", "image/jpeg", "image/webp"}
IMAGE_EXT = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp"}


class OrgImageResponse(BaseModel):
    image_url: str


async def _upload_org_image(
    organization_id: UUID,
    file: UploadFile,
    requester: User,
    request: Request,
    session: AsyncSession,
    storage: StorageBackend,
) -> OrgImageResponse:
    content_type = file.content_type or ""
    if content_type not in IMAGE_ALLOWED_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="ORG_IMAGE_INVALID_TYPE",
        )

    data = await file.read()
    if len(data) > IMAGE_MAX_BYTES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="ORG_IMAGE_TOO_LARGE",
        )

    org = await session.get(Organization, organization_id)
    if org is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="ORG_NOT_FOUND",
        )

    bucket = get_attachments_bucket()
    ext = IMAGE_EXT[content_type]
    new_key = f"org-images/{organization_id}.{ext}"

    # Clean up old object if extension changed
    if org.image_key and org.image_key != new_key:
        try:
            await storage.delete_object(org.image_key, bucket=bucket)
        except Exception:
            pass

    await storage.put_object(new_key, content_type, data, bucket=bucket)

    await session.execute(
        update(Organization)
        .where(Organization.id == organization_id)
        .values(image_key=new_key)
    )
    await audit.record_for_org(
        session,
        organization_id,
        action="organization.image_uploaded",
        resource_type="organization",
        resource_id=organization_id,
        after={"image_key": new_key},
        actor_user_id=requester.id,
        request=request,
    )
    await session.commit()

    image_url = await storage.presigned_get_url(new_key, "org-logo", bucket=bucket)
    return OrgImageResponse(image_url=image_url)


async def _delete_org_image(
    organization_id: UUID,
    requester: User,
    request: Request,
    session: AsyncSession,
    storage: StorageBackend,
) -> None:
    org = await session.get(Organization, organization_id)
    if org is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="ORG_NOT_FOUND",
        )
    if org.image_key is None:
        return

    bucket = get_attachments_bucket()
    old_key = org.image_key
    try:
        await storage.delete_object(old_key, bucket=bucket)
    except Exception:
        pass

    await session.execute(
        update(Organization)
        .where(Organization.id == organization_id)
        .values(image_key=None)
    )
    await audit.record_for_org(
        session,
        organization_id,
        action="organization.image_removed",
        resource_type="organization",
        resource_id=organization_id,
        before={"image_key": old_key},
        actor_user_id=requester.id,
        request=request,
    )
    await session.commit()


# ---------------------------------------------------------------------------
# Super-admin routes
# ---------------------------------------------------------------------------

admin_router = APIRouter(prefix="/admin", tags=["admin"])


@admin_router.put(
    "/organizations/{organization_id}/image",
    response_model=OrgImageResponse,
)
async def admin_upload_org_image(
    organization_id: UUID,
    file: UploadFile,
    request: Request,
    requester: User = Depends(require_superuser),
    session: AsyncSession = Depends(get_async_session),
    storage: StorageBackend = Depends(get_storage),
) -> OrgImageResponse:
    return await _upload_org_image(
        organization_id, file, requester, request, session, storage,
    )


@admin_router.delete(
    "/organizations/{organization_id}/image",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def admin_delete_org_image(
    organization_id: UUID,
    request: Request,
    requester: User = Depends(require_superuser),
    session: AsyncSession = Depends(get_async_session),
    storage: StorageBackend = Depends(get_storage),
) -> None:
    await _delete_org_image(
        organization_id, requester, request, session, storage,
    )


# ---------------------------------------------------------------------------
# Org-admin routes
# ---------------------------------------------------------------------------

org_router = APIRouter(tags=["organization-settings"])


@org_router.put(
    "/organizations/{organization_id}/image",
    response_model=OrgImageResponse,
)
async def upload_org_image(
    organization_id: UUID,
    file: UploadFile,
    request: Request,
    requester: User = Depends(require_org_admin),
    session: AsyncSession = Depends(get_async_session),
    storage: StorageBackend = Depends(get_storage),
) -> OrgImageResponse:
    return await _upload_org_image(
        organization_id, file, requester, request, session, storage,
    )


@org_router.delete(
    "/organizations/{organization_id}/image",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_org_image(
    organization_id: UUID,
    request: Request,
    requester: User = Depends(require_org_admin),
    session: AsyncSession = Depends(get_async_session),
    storage: StorageBackend = Depends(get_storage),
) -> None:
    await _delete_org_image(
        organization_id, requester, request, session, storage,
    )
