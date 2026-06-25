"""Org-admin endpoints for managing organization settings.

Routes here require ``require_org_admin`` — i.e. an active org-admin
membership OR superuser. They let the org owner change surface-level
settings (name, logo) without super-admin access.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from bimdossier_api import audit
from bimdossier_api.auth.dependencies import require_org_admin
from bimdossier_api.db import get_async_session
from bimdossier_api.models.organization import Organization
from bimdossier_api.models.user import User
from bimdossier_api.schemas.admin import OrgNameUpdate, OrgNameUpdateResponse

router = APIRouter(tags=["organization-settings"])


@router.patch(
    "/organizations/{organization_id}",
    response_model=OrgNameUpdateResponse,
)
async def update_org_name(
    organization_id: UUID,
    payload: OrgNameUpdate,
    request: Request,
    requester: User = Depends(require_org_admin),
    session: AsyncSession = Depends(get_async_session),
) -> OrgNameUpdateResponse:
    org = await session.get(Organization, organization_id)
    if org is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="ORG_NOT_FOUND"
        )

    new_name = payload.name.strip()
    if not new_name:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="NAME_EMPTY_AFTER_TRIM",
        )

    if new_name == org.name:
        return OrgNameUpdateResponse(id=org.id, name=org.name)

    before = {"name": org.name}

    try:
        await session.execute(
            update(Organization)
            .where(Organization.id == organization_id)
            .values(name=new_name)
        )
        await session.flush()
    except IntegrityError:
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="ORG_NAME_TAKEN"
        )

    after = {"name": new_name}
    await audit.record_for_org(
        session,
        organization_id,
        action="organization.updated",
        resource_type="organization",
        resource_id=organization_id,
        before=before,
        after=after,
        actor_user_id=requester.id,
        request=request,
    )
    await session.commit()

    return OrgNameUpdateResponse(id=org.id, name=new_name)
