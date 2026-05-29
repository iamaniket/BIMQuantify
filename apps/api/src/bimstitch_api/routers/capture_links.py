"""Capture link management (authenticated endpoints).

A capture link is a shareable URL that lets unauthenticated users upload
documents to a project. Links have a TTL, optional max-use counter, and
can be revoked.
"""

from __future__ import annotations

import secrets
from datetime import UTC, datetime, timedelta
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from bimstitch_api import audit
from bimstitch_api.auth.fastapi_users import current_verified_user
from bimstitch_api.auth.permissions import Action, Resource, require_permission
from bimstitch_api.config import Settings, get_settings
from bimstitch_api.models.capture_link import CaptureLink
from bimstitch_api.models.user import User
from bimstitch_api.routers.projects import (
    _load_project_or_404,
    _require_membership,
    _require_project_writable,
)
from bimstitch_api.schemas.capture_link import (
    CaptureLinkRead,
    CreateCaptureLinkRequest,
    CreateCaptureLinkResponse,
)
from bimstitch_api.tenancy import get_tenant_session, require_active_organization

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
    project = await _load_project_or_404(session, project_id)
    membership = await _require_membership(session, project.id, user.id)
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
    _require_project_writable(project)

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
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> list[CaptureLink]:
    project = await _load_project_or_404(session, project_id)
    membership = await _require_membership(session, project.id, user.id)
    require_permission(membership.role, Resource.capture_link, Action.read)

    result = await session.execute(
        select(CaptureLink)
        .where(CaptureLink.project_id == project.id)
        .order_by(CaptureLink.created_at.desc())
    )
    return list(result.scalars().all())


@router.delete("/{link_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_capture_link(
    project_id: UUID,
    link_id: UUID,
    request: Request,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> Response:
    project = await _load_project_or_404(session, project_id)
    membership = await _require_membership(session, project.id, user.id)
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
        request=request,
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
