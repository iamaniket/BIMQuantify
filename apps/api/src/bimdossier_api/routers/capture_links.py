"""Capture link management (authenticated endpoints).

A capture link is a shareable URL that lets unauthenticated users upload
documents to a project. Links have a TTL, optional max-use counter, and
can be revoked.
"""

from __future__ import annotations

import secrets
from datetime import UTC, datetime, timedelta
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from bimdossier_api import audit
from bimdossier_api.access import (
    load_project_or_404,
    require_membership,
    require_project_writable,
)
from bimdossier_api.auth.fastapi_users import current_verified_user
from bimdossier_api.auth.permissions import Action, Resource, require_permission
from bimdossier_api.config import Settings, get_settings
from bimdossier_api.models.capture_link import CaptureLink
from bimdossier_api.models.user import User
from bimdossier_api.schemas.capture_link import (
    CaptureLinkRead,
    CreateCaptureLinkRequest,
    CreateCaptureLinkResponse,
)
from bimdossier_api.tenancy import get_tenant_session, require_active_organization

router = APIRouter(prefix="/projects/{project_id}/capture-links", tags=["capture-links"])


def _capture_link_snapshot(link: CaptureLink) -> dict:
    return {
        "label": link.label,
        "expires_at": link.expires_at.isoformat() if link.expires_at else None,
        "max_uses": link.max_uses,
        "use_count": link.use_count,
        "revoked_at": link.revoked_at.isoformat() if link.revoked_at else None,
    }


@router.post("", response_model=CreateCaptureLinkResponse, status_code=status.HTTP_201_CREATED)
async def create_capture_link(
    project_id: UUID,
    payload: CreateCaptureLinkRequest,
    request: Request,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
    settings: Settings = Depends(get_settings),
) -> CreateCaptureLinkResponse:
    project = await load_project_or_404(session, project_id)
    membership = await require_membership(session, project.id, user.id)
    try:
        require_permission(membership.role, Resource.capture_link, Action.create)
    except HTTPException:
        await audit.log_permission_denied(
            role=membership.role.value,
            resource=Resource.capture_link.value,
            action=Action.create.value,
            actor_user_id=user.id,
            request=request,
        )
        raise
    require_project_writable(project)

    ttl_hours = min(payload.ttl_hours, settings.capture_link_max_ttl_hours)
    token = secrets.token_hex(32)
    expires_at = datetime.now(UTC) + timedelta(hours=ttl_hours)

    link = CaptureLink(
        project_id=project.id,
        token=token,
        created_by_user_id=user.id,
        label=payload.label,
        expires_at=expires_at,
        max_uses=payload.max_uses,
    )
    session.add(link)
    await session.flush()
    await session.refresh(link)

    capture_url = f"{settings.frontend_capture_url}/{active_org_id}/{token}"

    await audit.record(
        session,
        action="capture_link.created",
        resource_type="capture_links",
        resource_id=link.id,
        after=_capture_link_snapshot(link),
        actor_user_id=user.id,
        project_id=project.id,
        request=request,
    )

    return CreateCaptureLinkResponse(
        id=link.id,
        token=token,
        url=capture_url,
        expires_at=expires_at,
        label=link.label,
        max_uses=link.max_uses,
    )


@router.get("", response_model=list[CaptureLinkRead])
async def list_capture_links(
    project_id: UUID,
    response: Response,
    # Generous cap: the portal renders all links for a project (no paging UI).
    limit: int = Query(default=200, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
    settings: Settings = Depends(get_settings),
) -> list[CaptureLinkRead]:
    project = await load_project_or_404(session, project_id)
    membership = await require_membership(session, project.id, user.id)
    require_permission(membership.role, Resource.capture_link, Action.read)

    base = select(CaptureLink).where(CaptureLink.project_id == project.id)
    total = (await session.scalar(select(func.count()).select_from(base.subquery()))) or 0
    response.headers["X-Total-Count"] = str(total)
    result = await session.execute(
        base.order_by(CaptureLink.created_at.desc()).limit(limit).offset(offset)
    )
    # Rebuild the shareable URL per row (same construction as create) so an
    # authorized member can re-copy a link after creation.
    return [
        CaptureLinkRead.model_validate(row).model_copy(
            update={"url": f"{settings.frontend_capture_url}/{active_org_id}/{row.token}"}
        )
        for row in result.scalars().all()
    ]


@router.delete("/{link_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_capture_link(
    project_id: UUID,
    link_id: UUID,
    request: Request,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> Response:
    project = await load_project_or_404(session, project_id)
    membership = await require_membership(session, project.id, user.id)
    try:
        require_permission(membership.role, Resource.capture_link, Action.delete)
    except HTTPException:
        await audit.log_permission_denied(
            role=membership.role.value,
            resource=Resource.capture_link.value,
            action=Action.delete.value,
            actor_user_id=user.id,
            resource_id=link_id,
            request=request,
        )
        raise

    link = (
        await session.execute(
            select(CaptureLink).where(
                CaptureLink.id == link_id,
                CaptureLink.project_id == project.id,
            )
        )
    ).scalar_one_or_none()
    if link is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="CAPTURE_LINK_NOT_FOUND")

    if link.is_revoked:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="ALREADY_REVOKED")

    before = _capture_link_snapshot(link)
    link.revoked_at = datetime.now(UTC)
    await session.flush()

    await audit.record(
        session,
        action="capture_link.revoked",
        resource_type="capture_links",
        resource_id=link.id,
        before=before,
        after=_capture_link_snapshot(link),
        actor_user_id=user.id,
        project_id=project.id,
        request=request,
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
