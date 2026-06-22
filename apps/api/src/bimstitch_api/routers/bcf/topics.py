"""BCF topic CRUD endpoints (and the 2D markup listing)."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any
from uuid import UUID, uuid4

from fastapi import Depends, HTTPException, Query, Request, Response, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from bimstitch_api import audit
from bimstitch_api.access import (
    load_project_or_404,
    require_membership,
    require_project_read_access,
    require_project_writable,
)
from bimstitch_api.auth.fastapi_users import current_verified_user
from bimstitch_api.auth.permissions import Action, Resource, require_permission
from bimstitch_api.models.bcf_topic import BcfTopic
from bimstitch_api.models.bcf_topic_label import BcfTopicLabel
from bimstitch_api.models.bcf_viewpoint import BcfViewpoint
from bimstitch_api.models.user import User
from bimstitch_api.schemas.bcf import (
    BcfMarkup2DItem,
    BcfTopicCreate,
    BcfTopicRead,
    BcfTopicSummary,
    BcfTopicUpdate,
)
from bimstitch_api.storage import get_storage
from bimstitch_api.tenancy import get_tenant_session, require_active_organization

from bimstitch_api.routers.bcf._shared import (
    BCF_VERSION,
    _build_viewpoint,
    _load_project_file_or_404,
    _load_topic_or_404,
    _resolve_snapshot_url,
    _sync_labels,
    _topic_snapshot,
    _topic_to_read,
    _user_display_name,
    router,
)


# ---------------------------------------------------------------------------
# CRUD — Topics
# ---------------------------------------------------------------------------


@router.post("", response_model=BcfTopicRead, status_code=status.HTTP_201_CREATED)
async def create_topic(
    project_id: UUID,
    payload: BcfTopicCreate,
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
    require_project_writable(project)

    now = datetime.now(UTC)
    author = _user_display_name(user)

    # Resolve the model version + dimension. Both fall back to the initial
    # viewpoint when the caller omits them: the 2D controller already stamps the
    # viewpoint with linked_file_id + is_2d, so a topic created from it inherits
    # the right values without the form having to repeat them.
    vp_payload = payload.viewpoint
    linked_file_id = payload.linked_file_id
    if linked_file_id is None and vp_payload is not None:
        linked_file_id = vp_payload.linked_file_id
    is_2d = payload.is_2d or (vp_payload.is_2d if vp_payload is not None else False)

    linked_model_id = payload.linked_model_id
    if linked_file_id is not None:
        linked_file = await _load_project_file_or_404(session, project.id, linked_file_id)
        # Backfill the logical-model anchor from the file when not given, so the
        # list can group issues across versions of the same model.
        if linked_model_id is None and linked_file.model_id is not None:
            linked_model_id = linked_file.model_id

    topic = BcfTopic(
        project_id=project.id,
        guid=str(uuid4()),
        title=payload.title,
        description=payload.description,
        topic_type=payload.topic_type,
        topic_status=payload.topic_status,
        priority=payload.priority,
        stage=payload.stage,
        assigned_to=payload.assigned_to,
        due_date=payload.due_date,
        creation_author=author,
        creation_date=now,
        created_by_user_id=user.id,
        bcf_version=BCF_VERSION,
        linked_finding_id=payload.linked_finding_id,
        linked_model_id=linked_model_id,
        linked_file_id=linked_file_id,
        is_2d=is_2d,
    )
    session.add(topic)
    await session.flush()

    # Add labels directly (topic is freshly created, no existing labels to clear)
    for i, name in enumerate(payload.labels):
        session.add(BcfTopicLabel(topic_id=topic.id, name=name[:64], position=i))

    if payload.viewpoint:
        vp = _build_viewpoint(payload.viewpoint, topic.id)
        session.add(vp)
        await session.flush()

    await session.refresh(topic)
    # Eager-load relationships for the response
    loaded = await _load_topic_or_404(session, project.id, topic.id, eager=True)

    await audit.record(
        session,
        action="bcf_topic.created",
        resource_type="bcf_topic",
        resource_id=topic.id,
        after=_topic_snapshot(loaded),
        actor_user_id=user.id,
        project_id=project.id,
        request=request,
    )

    storage = get_storage()
    return await _topic_to_read(loaded, storage)


@router.get("", response_model=list[BcfTopicSummary])
async def list_topics(
    project_id: UUID,
    response: Response,
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    search: str | None = Query(default=None, max_length=255),
    topic_status: str | None = Query(default=None, alias="status", max_length=50),
    priority: str | None = Query(default=None, max_length=50),
    topic_type: str | None = Query(default=None, alias="type", max_length=50),
    model_id: UUID | None = Query(default=None),
    file_id: UUID | None = Query(default=None),
    is_2d: bool | None = Query(default=None),
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> Any:
    project = await load_project_or_404(session, project_id)
    await require_project_read_access(session, project.id, user, active_org_id)

    base = select(BcfTopic).where(
        BcfTopic.project_id == project.id,
        BcfTopic.deleted_at.is_(None),
    )

    if search:
        base = base.where(BcfTopic.title.ilike(f"%{search}%"))
    if topic_status:
        base = base.where(BcfTopic.topic_status == topic_status)
    if priority:
        base = base.where(BcfTopic.priority == priority)
    if topic_type:
        base = base.where(BcfTopic.topic_type == topic_type)
    # Viewer-scope filters: a model (across all its versions), an exact version
    # (a ProjectFile), and the 2D/3D dimension. The in-viewer panel filters by
    # model_id + is_2d by default; file_id is the "this version only" toggle.
    if model_id is not None:
        base = base.where(BcfTopic.linked_model_id == model_id)
    if file_id is not None:
        base = base.where(BcfTopic.linked_file_id == file_id)
    if is_2d is not None:
        base = base.where(BcfTopic.is_2d.is_(is_2d))

    total = (await session.scalar(select(func.count()).select_from(base.subquery()))) or 0
    response.headers["X-Total-Count"] = str(total)

    stmt = base.options(
        selectinload(BcfTopic.viewpoints),
        selectinload(BcfTopic.linked_file),
    ).order_by(BcfTopic.creation_date.desc()).limit(limit).offset(offset)

    topics = list((await session.execute(stmt)).scalars().all())

    storage = get_storage()
    result = []
    for topic in topics:
        snapshot_url = None
        if topic.viewpoints:
            snapshot_url = await _resolve_snapshot_url(topic.viewpoints[0], storage)
        result.append(
            BcfTopicSummary(
                id=topic.id,
                guid=topic.guid,
                title=topic.title,
                topic_type=topic.topic_type,
                topic_status=topic.topic_status,
                priority=topic.priority,
                assigned_to=topic.assigned_to,
                creation_author=topic.creation_author,
                creation_date=topic.creation_date,
                linked_finding_id=topic.linked_finding_id,
                linked_model_id=topic.linked_model_id,
                linked_file_id=topic.linked_file_id,
                is_2d=topic.is_2d,
                model_version=(
                    topic.linked_file.version_number if topic.linked_file else None
                ),
                file_type=(
                    topic.linked_file.file_type.value if topic.linked_file else None
                ),
                has_viewpoint=bool(topic.viewpoints),
                snapshot_url=snapshot_url,
                created_at=topic.created_at,
            )
        )
    return result


@router.get("/markup-2d", response_model=list[BcfMarkup2DItem])
async def list_markup_2d(
    project_id: UUID,
    file_id: UUID = Query(...),
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> Any:
    """Return 2D markup for a PDF file, one entry per linked 2D-viewpoint topic.

    Placed before ``/{topic_id}`` so "markup-2d" is not parsed as a UUID.
    """
    project = await load_project_or_404(session, project_id)
    await require_project_read_access(session, project.id, user, active_org_id)

    stmt = (
        select(BcfTopic, BcfViewpoint)
        .join(BcfViewpoint, BcfViewpoint.topic_id == BcfTopic.id)
        .where(
            BcfTopic.project_id == project.id,
            BcfTopic.deleted_at.is_(None),
            BcfViewpoint.is_2d.is_(True),
            BcfViewpoint.linked_file_id == file_id,
        )
        .order_by(BcfTopic.creation_date)
    )
    rows = (await session.execute(stmt)).all()

    items: list[BcfMarkup2DItem] = []
    for topic, vp in rows:
        view_state = vp.view_state_2d or {}
        items.append(
            BcfMarkup2DItem(
                topic_id=topic.id,
                title=topic.title,
                topic_status=topic.topic_status,
                page=view_state.get("page"),
                annotations=view_state.get("annotations") or [],
            )
        )
    return items


@router.get("/{topic_id}", response_model=BcfTopicRead)
async def get_topic(
    project_id: UUID,
    topic_id: UUID,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> Any:
    project = await load_project_or_404(session, project_id)
    await require_project_read_access(session, project.id, user, active_org_id)
    topic = await _load_topic_or_404(session, project.id, topic_id, eager=True)
    storage = get_storage()
    return await _topic_to_read(topic, storage)


@router.patch("/{topic_id}", response_model=BcfTopicRead)
async def update_topic(
    project_id: UUID,
    topic_id: UUID,
    payload: BcfTopicUpdate,
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
            resource_id=topic_id,
            request=request,
        )
        raise
    require_project_writable(project)

    topic = await _load_topic_or_404(session, project.id, topic_id, eager=True)
    before = _topic_snapshot(topic)

    updates = payload.model_dump(exclude_unset=True)
    labels = updates.pop("labels", None)

    for field, value in updates.items():
        setattr(topic, field, value)

    if labels is not None:
        await _sync_labels(session, topic.id, labels)

    now = datetime.now(UTC)
    topic.modified_author = _user_display_name(user)
    topic.modified_date = now

    await session.flush()
    await session.refresh(topic)

    topic = await _load_topic_or_404(session, project.id, topic.id, eager=True)

    await audit.record(
        session,
        action="bcf_topic.updated",
        resource_type="bcf_topic",
        resource_id=topic.id,
        before=before,
        after=_topic_snapshot(topic),
        actor_user_id=user.id,
        project_id=project.id,
        request=request,
    )

    storage = get_storage()
    return await _topic_to_read(topic, storage)


@router.delete("/{topic_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_topic(
    project_id: UUID,
    topic_id: UUID,
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
            resource_id=topic_id,
            request=request,
        )
        raise
    require_project_writable(project)

    topic = await _load_topic_or_404(session, project.id, topic_id)
    before = _topic_snapshot(topic)
    topic.soft_delete()
    await session.flush()
    await audit.record(
        session,
        action="bcf_topic.deleted",
        resource_type="bcf_topic",
        resource_id=topic_id,
        before=before,
        actor_user_id=user.id,
        project_id=project.id,
        request=request,
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
