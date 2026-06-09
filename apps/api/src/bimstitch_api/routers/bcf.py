"""Per-project BCF (BIM Collaboration Format) topic CRUD + import/export.

BCF topics are the issue-tracking layer of the IFC viewer. Each topic captures
a viewpoint (camera, visibility, section planes) and a screenshot, plus free-text
comments.  Topics may be linked to compliance findings or models.

Router follows the same tenant-scoped, permission-gated, audit-logged pattern as
``risks.py``.  Snapshot upload uses the two-phase presigned pattern.
"""

from __future__ import annotations

from datetime import UTC, datetime
from io import BytesIO
from typing import TYPE_CHECKING, Any
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, UploadFile, status
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from bimstitch_api import audit
from bimstitch_api.auth.fastapi_users import current_verified_user
from bimstitch_api.auth.permissions import Action, Resource, require_permission
from bimstitch_api.bcf.generator import generate_bcf_archive
from bimstitch_api.bcf.parser import parse_bcf_archive
from bimstitch_api.bcf.types import (
    BcfComponents,
    ClippingPlane,
    ParsedBcf,
    ParsedComment,
    ParsedTopic,
    ParsedViewpoint,
    Vec3,
)
from bimstitch_api.models.bcf_comment import BcfComment
from bimstitch_api.models.bcf_topic import BcfTopic
from bimstitch_api.models.bcf_topic_label import BcfTopicLabel
from bimstitch_api.models.bcf_viewpoint import BcfViewpoint
from bimstitch_api.models.user import User
from bimstitch_api.routers.projects import (
    _load_project_or_404,
    _require_membership,
    _require_project_read_access,
    _require_project_writable,
)
from bimstitch_api.schemas.bcf import (
    BcfCommentCreate,
    BcfCommentRead,
    BcfImportResponse,
    BcfTopicCreate,
    BcfTopicRead,
    BcfTopicSummary,
    BcfTopicUpdate,
    BcfViewpointCreate,
    BcfViewpointRead,
)
from bimstitch_api.storage import get_attachments_bucket, get_storage
from bimstitch_api.tenancy import get_tenant_session, require_active_organization

if TYPE_CHECKING:
    from bimstitch_api.storage import StorageBackend

router = APIRouter(prefix="/projects/{project_id}/bcf-topics", tags=["bcf"])

BCF_VERSION = "3.0"
SNAPSHOT_PREFIX = "bcf-snapshots"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _user_display_name(user: User) -> str:
    """Best-effort display name for audit / BCF author fields."""
    if user.full_name:
        return user.full_name
    return user.email


async def _load_topic_or_404(
    session: AsyncSession,
    project_id: UUID,
    topic_id: UUID,
    *,
    eager: bool = False,
) -> BcfTopic:
    stmt = select(BcfTopic).where(
        BcfTopic.id == topic_id,
        BcfTopic.project_id == project_id,
        BcfTopic.deleted_at.is_(None),
    )
    if eager:
        stmt = stmt.options(
            selectinload(BcfTopic.viewpoints),
            selectinload(BcfTopic.comments),
            selectinload(BcfTopic.label_rows),
        )
    topic = (await session.execute(stmt)).scalar_one_or_none()
    if topic is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="BCF_TOPIC_NOT_FOUND")
    return topic


async def _load_comment_or_404(
    session: AsyncSession,
    topic_id: UUID,
    comment_id: UUID,
) -> BcfComment:
    comment = (
        await session.execute(
            select(BcfComment).where(
                BcfComment.id == comment_id,
                BcfComment.topic_id == topic_id,
            )
        )
    ).scalar_one_or_none()
    if comment is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="BCF_COMMENT_NOT_FOUND")
    return comment


def _snapshot_key(org_schema: str, topic_guid: str, vp_guid: str) -> str:
    return f"{SNAPSHOT_PREFIX}/{org_schema}/{topic_guid}/{vp_guid}.png"


async def _resolve_snapshot_url(
    viewpoint: BcfViewpoint, storage: StorageBackend
) -> str | None:
    if not viewpoint.snapshot_storage_key:
        return None
    try:
        return await storage.presigned_get_url(
            viewpoint.snapshot_storage_key,
            f"{viewpoint.guid}.png",
            disposition="inline",
            bucket=get_attachments_bucket(),
        )
    except Exception:
        return None


def _topic_snapshot(topic: BcfTopic) -> dict[str, Any]:
    return {
        "title": topic.title,
        "topic_type": topic.topic_type,
        "topic_status": topic.topic_status,
        "priority": topic.priority,
        "assigned_to": topic.assigned_to,
    }


async def _topic_to_read(
    topic: BcfTopic, storage: StorageBackend
) -> dict[str, Any]:
    """Convert a topic to a dict suitable for BcfTopicRead response."""
    data = {
        "id": topic.id,
        "project_id": topic.project_id,
        "guid": topic.guid,
        "title": topic.title,
        "description": topic.description,
        "topic_type": topic.topic_type,
        "topic_status": topic.topic_status,
        "priority": topic.priority,
        "stage": topic.stage,
        "assigned_to": topic.assigned_to,
        "labels": topic.labels,
        "due_date": topic.due_date,
        "creation_author": topic.creation_author,
        "creation_date": topic.creation_date,
        "modified_author": topic.modified_author,
        "modified_date": topic.modified_date,
        "linked_finding_id": topic.linked_finding_id,
        "linked_model_id": topic.linked_model_id,
        "created_by_user_id": topic.created_by_user_id,
        "bcf_version": topic.bcf_version,
        "import_source": topic.import_source,
        "created_at": topic.created_at,
        "updated_at": topic.updated_at,
        "viewpoints": [],
        "comments": [],
    }

    for vp in topic.viewpoints:
        snapshot_url = await _resolve_snapshot_url(vp, storage)
        vp_data = {
            "id": vp.id,
            "guid": vp.guid,
            "index_in_topic": vp.index_in_topic,
            "camera_type": vp.camera_type,
            "camera_view_point": vp.camera_view_point,
            "camera_direction": vp.camera_direction,
            "camera_up_vector": vp.camera_up_vector,
            "field_of_view": vp.field_of_view,
            "field_of_height": vp.field_of_height,
            "components": vp.components,
            "clipping_planes": vp.clipping_planes,
            "snapshot_url": snapshot_url,
            "is_2d": vp.is_2d,
            "view_state_2d": vp.view_state_2d,
            "linked_file_id": vp.linked_file_id,
            "created_at": vp.created_at,
        }
        data["viewpoints"].append(vp_data)

    for comment in topic.comments:
        data["comments"].append({
            "id": comment.id,
            "guid": comment.guid,
            "comment_text": comment.comment_text,
            "author": comment.author,
            "date": comment.date,
            "modified_author": comment.modified_author,
            "modified_date": comment.modified_date,
            "viewpoint_guid": comment.viewpoint_guid,
            "created_by_user_id": comment.created_by_user_id,
            "created_at": comment.created_at,
        })

    return data


def _build_viewpoint(payload: BcfViewpointCreate, topic_id: UUID) -> BcfViewpoint:
    vp_guid = payload.guid or str(uuid4())
    return BcfViewpoint(
        topic_id=topic_id,
        guid=vp_guid,
        index_in_topic=payload.index_in_topic,
        camera_type=payload.camera_type,
        camera_view_point=payload.camera_view_point.model_dump(),
        camera_direction=payload.camera_direction.model_dump(),
        camera_up_vector=payload.camera_up_vector.model_dump(),
        field_of_view=payload.field_of_view,
        field_of_height=payload.field_of_height,
        components=payload.components.model_dump() if payload.components else None,
        clipping_planes=[cp.model_dump() for cp in payload.clipping_planes] if payload.clipping_planes else None,
        is_2d=payload.is_2d,
        view_state_2d=payload.view_state_2d.model_dump() if payload.view_state_2d else None,
        linked_file_id=payload.linked_file_id,
    )


async def _sync_labels(session: AsyncSession, topic_id: UUID, labels: list[str]) -> None:
    """Replace existing labels with a new set."""
    from sqlalchemy import delete

    await session.execute(
        delete(BcfTopicLabel).where(BcfTopicLabel.topic_id == topic_id)
    )
    for i, name in enumerate(labels):
        session.add(BcfTopicLabel(topic_id=topic_id, name=name[:64], position=i))
    await session.flush()


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
    project = await _load_project_or_404(session, project_id)
    membership = await _require_membership(session, project.id, user.id)
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
    _require_project_writable(project)

    now = datetime.now(UTC)
    author = _user_display_name(user)
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
        linked_model_id=payload.linked_model_id,
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
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> Any:
    project = await _load_project_or_404(session, project_id)
    await _require_project_read_access(session, project.id, user, active_org_id)

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

    total = (await session.scalar(select(func.count()).select_from(base.subquery()))) or 0
    response.headers["X-Total-Count"] = str(total)

    stmt = base.options(
        selectinload(BcfTopic.viewpoints),
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
                snapshot_url=snapshot_url,
                created_at=topic.created_at,
            )
        )
    return result


# ---------------------------------------------------------------------------
# Import / Export  (MUST come before /{topic_id} routes to avoid
# FastAPI matching "import"/"export" as a UUID path parameter.)
# ---------------------------------------------------------------------------


@router.post("/import", response_model=BcfImportResponse)
async def import_bcf(
    project_id: UUID,
    file: UploadFile,
    request: Request,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> Any:
    project = await _load_project_or_404(session, project_id)
    membership = await _require_membership(session, project.id, user.id)
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
    _require_project_writable(project)

    data = await file.read()
    try:
        parsed = parse_bcf_archive(data)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="INVALID_BCF_ARCHIVE",
        ) from exc

    author = _user_display_name(user)
    now = datetime.now(UTC)
    org_schema = f"org_{str(active_org_id).replace('-', '')}"
    storage = get_storage()
    warnings_list: list[str] = []
    created_topics: list[BcfTopic] = []

    for pt in parsed.topics:
        topic = BcfTopic(
            project_id=project.id,
            guid=str(uuid4()),
            title=pt.title or "Untitled",
            description=pt.description,
            topic_type=pt.topic_type or "Issue",
            topic_status=pt.topic_status or "Open",
            priority=pt.priority,
            stage=pt.stage,
            assigned_to=pt.assigned_to,
            due_date=pt.due_date,
            creation_author=pt.creation_author or author,
            creation_date=pt.creation_date or now,
            modified_author=pt.modified_author,
            modified_date=pt.modified_date,
            created_by_user_id=user.id,
            bcf_version=parsed.version or BCF_VERSION,
            import_source=file.filename,
        )
        session.add(topic)
        await session.flush()

        for i, label in enumerate(pt.labels or []):
            session.add(BcfTopicLabel(topic_id=topic.id, name=label[:64], position=i))

        for j, pv in enumerate(pt.viewpoints or []):
            cam_vp = pv.camera_view_point
            cam_dir = pv.camera_direction
            cam_up = pv.camera_up_vector
            vp = BcfViewpoint(
                topic_id=topic.id,
                guid=pv.guid or str(uuid4()),
                index_in_topic=j,
                camera_type=pv.camera_type or "perspective",
                camera_view_point={"x": cam_vp.x, "y": cam_vp.y, "z": cam_vp.z},
                camera_direction={"x": cam_dir.x, "y": cam_dir.y, "z": cam_dir.z},
                camera_up_vector={"x": cam_up.x, "y": cam_up.y, "z": cam_up.z},
                field_of_view=pv.field_of_view,
                field_of_height=pv.field_of_height,
                components={
                    "default_visibility": pv.components.default_visibility,
                    "visibility_exceptions": pv.components.visibility_exceptions,
                    "selection": pv.components.selection,
                } if pv.components else None,
                clipping_planes=[
                    {
                        "location": {"x": cp.location.x, "y": cp.location.y, "z": cp.location.z},
                        "direction": {"x": cp.direction.x, "y": cp.direction.y, "z": cp.direction.z},
                    }
                    for cp in (pv.clipping_planes or [])
                ],
            )

            if pv.snapshot_data:
                key = _snapshot_key(org_schema, topic.guid, vp.guid)
                try:
                    await storage.put_object(key, "image/png", pv.snapshot_data, bucket=get_attachments_bucket())
                    vp.snapshot_storage_key = key
                except Exception:
                    warnings_list.append(f"Failed to upload snapshot for topic '{topic.title}' viewpoint {j}")

            session.add(vp)

        for pc in pt.comments or []:
            session.add(BcfComment(
                topic_id=topic.id,
                guid=pc.guid or str(uuid4()),
                comment_text=pc.text or "",
                author=pc.author or author,
                date=pc.date or now,
                modified_author=pc.modified_author,
                modified_date=pc.modified_date,
                viewpoint_guid=pc.viewpoint_guid,
                created_by_user_id=user.id,
            ))

        await session.flush()
        created_topics.append(topic)

    loaded: list[BcfTopic] = []
    for t in created_topics:
        loaded.append(await _load_topic_or_404(session, project.id, t.id, eager=True))

    topics_out = []
    for tp in loaded:
        topics_out.append(await _topic_to_read(tp, storage))

    await audit.record(
        session,
        action="bcf.imported",
        resource_type="bcf_topic",
        after={"imported_count": len(loaded), "source": file.filename},
        actor_user_id=user.id,
        request=request,
    )

    return BcfImportResponse(
        imported_count=len(loaded),
        topics=[BcfTopicRead.model_validate(t) for t in topics_out],
        warnings=warnings_list,
    )


@router.get("/export")
async def export_bcf(
    project_id: UUID,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> StreamingResponse:
    project = await _load_project_or_404(session, project_id)
    await _require_project_read_access(session, project.id, user, active_org_id)

    stmt = (
        select(BcfTopic)
        .where(
            BcfTopic.project_id == project.id,
            BcfTopic.deleted_at.is_(None),
        )
        .options(
            selectinload(BcfTopic.viewpoints),
            selectinload(BcfTopic.comments),
            selectinload(BcfTopic.label_rows),
        )
        .order_by(BcfTopic.creation_date)
    )
    topics = list((await session.execute(stmt)).scalars().all())
    storage = get_storage()

    parsed_topics: list[ParsedTopic] = []
    for topic in topics:
        viewpoints: list[ParsedViewpoint] = []
        for vp in topic.viewpoints:
            snapshot_bytes: bytes | None = None
            if vp.snapshot_storage_key:
                try:
                    head = await storage.head_object(vp.snapshot_storage_key, bucket=get_attachments_bucket())
                    size = int(head.get("ContentLength", 0))
                    if size > 0:
                        snapshot_bytes = await storage.get_object_range(
                            vp.snapshot_storage_key, 0, size - 1, bucket=get_attachments_bucket(),
                        )
                except Exception:
                    pass

            cam_vp = vp.camera_view_point or {}
            cam_dir = vp.camera_direction or {}
            cam_up = vp.camera_up_vector or {}
            pv = ParsedViewpoint(
                guid=vp.guid,
                camera_type=vp.camera_type,
                camera_view_point=Vec3(x=cam_vp.get("x", 0), y=cam_vp.get("y", 0), z=cam_vp.get("z", 0)),
                camera_direction=Vec3(x=cam_dir.get("x", 0), y=cam_dir.get("y", 0), z=cam_dir.get("z", 0)),
                camera_up_vector=Vec3(x=cam_up.get("x", 0), y=cam_up.get("y", 0), z=cam_up.get("z", 0)),
                field_of_view=vp.field_of_view,
                field_of_height=vp.field_of_height,
                components=BcfComponents(
                    default_visibility=vp.components.get("default_visibility", True),
                    visibility_exceptions=vp.components.get("visibility_exceptions", []),
                    selection=vp.components.get("selection", []),
                ) if vp.components else None,
                clipping_planes=[
                    ClippingPlane(
                        location=Vec3(x=cp["location"]["x"], y=cp["location"]["y"], z=cp["location"]["z"]),
                        direction=Vec3(x=cp["direction"]["x"], y=cp["direction"]["y"], z=cp["direction"]["z"]),
                    )
                    for cp in (vp.clipping_planes or [])
                ],
                snapshot_data=snapshot_bytes,
            )
            viewpoints.append(pv)

        comments: list[ParsedComment] = []
        for c in topic.comments:
            comments.append(ParsedComment(
                guid=c.guid,
                text=c.comment_text,
                author=c.author,
                date=c.date,
                modified_author=c.modified_author,
                modified_date=c.modified_date,
                viewpoint_guid=c.viewpoint_guid,
            ))

        parsed_topics.append(ParsedTopic(
            guid=topic.guid,
            title=topic.title,
            description=topic.description,
            topic_type=topic.topic_type,
            topic_status=topic.topic_status,
            priority=topic.priority,
            stage=topic.stage,
            assigned_to=topic.assigned_to,
            due_date=topic.due_date,
            creation_author=topic.creation_author,
            creation_date=topic.creation_date,
            modified_author=topic.modified_author,
            modified_date=topic.modified_date,
            labels=topic.labels,
            viewpoints=viewpoints,
            comments=comments,
        ))

    parsed_bcf = ParsedBcf(version=BCF_VERSION, topics=parsed_topics)
    archive_bytes = generate_bcf_archive(parsed_bcf)

    filename = f"{project.name or 'project'}_bcf_export.bcf"
    return StreamingResponse(
        BytesIO(archive_bytes),
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Content-Length": str(len(archive_bytes)),
        },
    )


@router.get("/{topic_id}", response_model=BcfTopicRead)
async def get_topic(
    project_id: UUID,
    topic_id: UUID,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> Any:
    project = await _load_project_or_404(session, project_id)
    await _require_project_read_access(session, project.id, user, active_org_id)
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
    project = await _load_project_or_404(session, project_id)
    membership = await _require_membership(session, project.id, user.id)
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
    _require_project_writable(project)

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
    project = await _load_project_or_404(session, project_id)
    membership = await _require_membership(session, project.id, user.id)
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
    _require_project_writable(project)

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
        request=request,
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


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
    project = await _load_project_or_404(session, project_id)
    membership = await _require_membership(session, project.id, user.id)
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
    project = await _load_project_or_404(session, project_id)
    membership = await _require_membership(session, project.id, user.id)
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
    project = await _load_project_or_404(session, project_id)
    membership = await _require_membership(session, project.id, user.id)
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


# ---------------------------------------------------------------------------
# Viewpoints
# ---------------------------------------------------------------------------


@router.post(
    "/{topic_id}/viewpoints",
    response_model=BcfViewpointRead,
    status_code=status.HTTP_201_CREATED,
)
async def add_viewpoint(
    project_id: UUID,
    topic_id: UUID,
    payload: BcfViewpointCreate,
    request: Request,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> Any:
    project = await _load_project_or_404(session, project_id)
    membership = await _require_membership(session, project.id, user.id)
    try:
        require_permission(membership.role, Resource.bcf_topic, Action.update)
    except HTTPException:
        await audit.log_permission_denied(
            role=membership.role.value,
            resource=Resource.bcf_topic.value,
            action=Action.update.value,
            actor_user_id=user.id,
            request=request,
        )
        raise

    topic = await _load_topic_or_404(session, project.id, topic_id)
    vp = _build_viewpoint(payload, topic.id)
    session.add(vp)
    await session.flush()
    await session.refresh(vp)

    storage = get_storage()
    snapshot_url = await _resolve_snapshot_url(vp, storage)

    return BcfViewpointRead(
        id=vp.id,
        guid=vp.guid,
        index_in_topic=vp.index_in_topic,
        camera_type=vp.camera_type,
        camera_view_point=vp.camera_view_point,
        camera_direction=vp.camera_direction,
        camera_up_vector=vp.camera_up_vector,
        field_of_view=vp.field_of_view,
        field_of_height=vp.field_of_height,
        components=vp.components,
        clipping_planes=vp.clipping_planes,
        snapshot_url=snapshot_url,
        is_2d=vp.is_2d,
        view_state_2d=vp.view_state_2d,
        linked_file_id=vp.linked_file_id,
        created_at=vp.created_at,
    )


# ---------------------------------------------------------------------------
# Snapshot upload (two-phase presigned)
# ---------------------------------------------------------------------------


from pydantic import BaseModel as _BaseModel  # noqa: E402


class SnapshotInitiateRequest(_BaseModel):
    content_type: str = "image/png"
    content_length: int


class SnapshotInitiateResponse(_BaseModel):
    upload_url: str
    storage_key: str


class SnapshotCompleteRequest(_BaseModel):
    storage_key: str


@router.post("/{topic_id}/viewpoints/{viewpoint_id}/snapshot-upload", response_model=SnapshotInitiateResponse)
async def initiate_snapshot_upload(
    project_id: UUID,
    topic_id: UUID,
    viewpoint_id: UUID,
    payload: SnapshotInitiateRequest,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> Any:
    project = await _load_project_or_404(session, project_id)
    membership = await _require_membership(session, project.id, user.id)
    require_permission(membership.role, Resource.bcf_topic, Action.update)

    topic = await _load_topic_or_404(session, project.id, topic_id, eager=True)
    vp = next((v for v in topic.viewpoints if v.id == viewpoint_id), None)
    if vp is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="BCF_VIEWPOINT_NOT_FOUND")

    org_schema = f"org_{str(active_org_id).replace('-', '')}"
    key = _snapshot_key(org_schema, topic.guid, vp.guid)

    storage = get_storage()
    upload_url = await storage.presigned_put_url(
        key,
        payload.content_type,
        payload.content_length,
        bucket=get_attachments_bucket(),
    )
    return SnapshotInitiateResponse(upload_url=upload_url, storage_key=key)


@router.post("/{topic_id}/viewpoints/{viewpoint_id}/snapshot-complete", status_code=status.HTTP_200_OK)
async def complete_snapshot_upload(
    project_id: UUID,
    topic_id: UUID,
    viewpoint_id: UUID,
    payload: SnapshotCompleteRequest,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> dict[str, str]:
    project = await _load_project_or_404(session, project_id)
    membership = await _require_membership(session, project.id, user.id)
    require_permission(membership.role, Resource.bcf_topic, Action.update)

    topic = await _load_topic_or_404(session, project.id, topic_id, eager=True)
    vp = next((v for v in topic.viewpoints if v.id == viewpoint_id), None)
    if vp is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="BCF_VIEWPOINT_NOT_FOUND")

    vp.snapshot_storage_key = payload.storage_key
    await session.flush()
    return {"status": "ok"}
