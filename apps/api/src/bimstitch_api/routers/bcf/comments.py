"""BCF comment endpoints."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any
from uuid import UUID, uuid4

from fastapi import Depends, HTTPException, Request, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from bimstitch_api import audit
from bimstitch_api.access import load_project_or_404, require_membership
from bimstitch_api.auth.fastapi_users import current_verified_user
from bimstitch_api.auth.permissions import Action, Resource, require_permission
from bimstitch_api.models.bcf_comment import BcfComment
from bimstitch_api.models.user import User
from bimstitch_api.schemas.bcf import BcfCommentCreate, BcfCommentRead
from bimstitch_api.tenancy import get_tenant_session, require_active_organization

from bimstitch_api.routers.bcf._shared import (
    _load_comment_or_404,
    _load_topic_or_404,
    _user_display_name,
    router,
)


# ---------------------------------------------------------------------------
# CRUD — Comments
# ---------------------------------------------------------------------------


@router.post("/{topic_id}/comments", response_model=BcfCommentRead, status_code=status.HTTP_201_CREATED)
async def add_comment(
    project_id: UUID,
    topic_id: UUID,
    payload: BcfCommentCreate,
    request: Request,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> Any:
    project = await load_project_or_404(session, project_id)
    membership = await require_membership(session, project.id, user.id)
    try:
        require_permission(membership.role, Resource.bcf_topic, Action.create)
    except HTTPException:
        await audit.log_permission_denied(
            role=membership.role.value,
            resource=Resource.bcf_topic.value,
            action=Action.create.value,
            actor_user_id=user.id,
            request=request,
        )
        raise

    topic = await _load_topic_or_404(session, project.id, topic_id)
    now = datetime.now(UTC)
    author = _user_display_name(user)

    comment = BcfComment(
        topic_id=topic.id,
        guid=str(uuid4()),
        comment_text=payload.text,
        author=author,
        date=now,
        viewpoint_guid=payload.viewpoint_guid,
        created_by_user_id=user.id,
    )
    session.add(comment)
    await session.flush()
    await session.refresh(comment)

    await audit.record(
        session,
        action="bcf_comment.created",
        resource_type="bcf_comment",
        resource_id=comment.id,
        after={"comment_text": comment.comment_text, "topic_id": str(topic.id)},
        actor_user_id=user.id,
        project_id=project.id,
        request=request,
    )

    return BcfCommentRead.model_validate(comment)


@router.patch("/{topic_id}/comments/{comment_id}", response_model=BcfCommentRead)
async def update_comment(
    project_id: UUID,
    topic_id: UUID,
    comment_id: UUID,
    payload: BcfCommentCreate,
    request: Request,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> Any:
    project = await load_project_or_404(session, project_id)
    membership = await require_membership(session, project.id, user.id)
    try:
        require_permission(membership.role, Resource.bcf_topic, Action.update)
    except HTTPException:
        await audit.log_permission_denied(
            role=membership.role.value,
            resource=Resource.bcf_topic.value,
            action=Action.update.value,
            actor_user_id=user.id,
            resource_id=comment_id,
            request=request,
        )
        raise

    await _load_topic_or_404(session, project.id, topic_id)
    comment = await _load_comment_or_404(session, topic_id, comment_id)
    now = datetime.now(UTC)

    comment.comment_text = payload.text
    comment.modified_author = _user_display_name(user)
    comment.modified_date = now
    comment.viewpoint_guid = payload.viewpoint_guid

    await session.flush()
    await session.refresh(comment)
    return BcfCommentRead.model_validate(comment)


@router.delete("/{topic_id}/comments/{comment_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_comment(
    project_id: UUID,
    topic_id: UUID,
    comment_id: UUID,
    request: Request,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> Response:
    project = await load_project_or_404(session, project_id)
    membership = await require_membership(session, project.id, user.id)
    try:
        require_permission(membership.role, Resource.bcf_topic, Action.delete)
    except HTTPException:
        await audit.log_permission_denied(
            role=membership.role.value,
            resource=Resource.bcf_topic.value,
            action=Action.delete.value,
            actor_user_id=user.id,
            resource_id=comment_id,
            request=request,
        )
        raise

    await _load_topic_or_404(session, project.id, topic_id)
    comment = await _load_comment_or_404(session, topic_id, comment_id)
    await session.delete(comment)
    await session.flush()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
