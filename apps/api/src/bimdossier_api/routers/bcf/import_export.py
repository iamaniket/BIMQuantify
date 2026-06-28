"""BCF import / export endpoints (BCF archive parse + generate)."""

from __future__ import annotations

from datetime import UTC, datetime
from io import BytesIO
from typing import Any
from uuid import UUID, uuid4

from fastapi import Depends, HTTPException, Request, UploadFile, status
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from bimdossier_api import audit
from bimdossier_api.access import (
    load_project_or_404,
    require_membership,
    require_project_read_access,
    require_project_writable,
)
from bimdossier_api.auth.fastapi_users import current_verified_user
from bimdossier_api.auth.permissions import Action, Resource, require_permission
from bimdossier_api.bcf.generator import generate_bcf_archive
from bimdossier_api.bcf.parser import BcfArchiveTooLargeError, parse_bcf_archive
from bimdossier_api.bcf.types import (
    BcfComponents,
    ClippingPlane,
    ParsedBcf,
    ParsedComment,
    ParsedFile,
    ParsedTopic,
    ParsedViewpoint,
    Vec3,
)
from bimdossier_api.config import get_settings
from bimdossier_api.content_disposition import safe_content_disposition
from bimdossier_api.models.bcf_comment import BcfComment
from bimdossier_api.models.bcf_topic import BcfTopic
from bimdossier_api.models.bcf_topic_label import BcfTopicLabel
from bimdossier_api.models.bcf_viewpoint import BcfViewpoint
from bimdossier_api.models.project_file import ProjectFile, ProjectFileRole
from bimdossier_api.models.user import User
from bimdossier_api.routers.bcf._shared import (
    BCF_VERSION,
    _load_topic_or_404,
    _match_file_to_project_file,
    _snapshot_key,
    _snapshot_prefix,
    _topic_to_read,
    _user_display_name,
    router,
)
from bimdossier_api.schemas.bcf import BcfImportResponse, BcfTopicRead
from bimdossier_api.storage import get_attachments_bucket, get_storage
from bimdossier_api.tenancy import (
    get_tenant_session,
    require_active_organization,
    schema_name_for,
)

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

    # Bound the read so a giant upload can't OOM the single-process API. Reading
    # one byte past the cap lets us detect over-limit without buffering it all;
    # the structural zip-bomb guards (entry count / ratio / decompressed size)
    # live in parse_bcf_archive.
    max_bytes = get_settings().bcf_import_max_bytes
    data = await file.read(max_bytes + 1)
    if len(data) > max_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail={"code": "BCF_ARCHIVE_TOO_LARGE", "max_bytes": max_bytes},
        )
    try:
        parsed = parse_bcf_archive(data)
    except BcfArchiveTooLargeError as exc:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="BCF_ARCHIVE_TOO_LARGE",
        ) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="INVALID_BCF_ARCHIVE",
        ) from exc

    author = _user_display_name(user)
    now = datetime.now(UTC)
    org_schema = schema_name_for(active_org_id)
    storage = get_storage()
    warnings_list: list[str] = []
    created_topics: list[BcfTopic] = []

    # Model-source files in this project, for matching BCF Header/File → model.
    candidate_files = list(
        (
            await session.execute(
                select(ProjectFile).where(
                    ProjectFile.project_id == project.id,
                    ProjectFile.role == ProjectFileRole.model_source,
                    ProjectFile.deleted_at.is_(None),
                )
            )
        )
        .scalars()
        .all()
    )

    for pt in parsed.topics:
        matched_file = (
            _match_file_to_project_file(pt.files, candidate_files) if pt.files else None
        )
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
            linked_file_id=matched_file.id if matched_file else None,
            linked_document_id=matched_file.document_id if matched_file else None,
            is_2d=any(v.is_2d for v in (pt.viewpoints or [])),
        )
        session.add(topic)
        await session.flush()

        for i, label in enumerate(pt.labels or []):
            session.add(BcfTopicLabel(topic_id=topic.id, name=label[:64], position=i))

        for j, pv in enumerate(pt.viewpoints or []):
            vp = BcfViewpoint(
                topic_id=topic.id,
                guid=pv.guid or str(uuid4()),
                index_in_topic=j,
                camera_type=pv.camera_type or "perspective",
                camera_vp_x=pv.camera_view_point.x,
                camera_vp_y=pv.camera_view_point.y,
                camera_vp_z=pv.camera_view_point.z,
                camera_dir_x=pv.camera_direction.x,
                camera_dir_y=pv.camera_direction.y,
                camera_dir_z=pv.camera_direction.z,
                camera_up_x=pv.camera_up_vector.x,
                camera_up_y=pv.camera_up_vector.y,
                camera_up_z=pv.camera_up_vector.z,
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
        topics_out.append(await _topic_to_read(tp, storage, org_schema))

    await audit.record(
        session,
        action="bcf.imported",
        resource_type="bcf_topic",
        after={"imported_count": len(loaded), "source": file.filename},
        actor_user_id=user.id,
        project_id=project.id,
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
    project = await load_project_or_404(session, project_id)
    await require_project_read_access(session, project.id, user, active_org_id)

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
            selectinload(BcfTopic.linked_file),
        )
        .order_by(BcfTopic.creation_date)
    )
    topics = list((await session.execute(stmt)).scalars().all())
    storage = get_storage()
    snapshot_prefix = _snapshot_prefix(schema_name_for(active_org_id))

    parsed_topics: list[ParsedTopic] = []
    for topic in topics:
        viewpoints: list[ParsedViewpoint] = []
        for vp in topic.viewpoints:
            snapshot_bytes: bytes | None = None
            # Only fetch keys scoped to this org's prefix — a pre-fix bad row
            # pointing at another tenant's object must not leak into the export.
            if vp.snapshot_storage_key and vp.snapshot_storage_key.startswith(snapshot_prefix):
                try:
                    head = await storage.head_object(vp.snapshot_storage_key, bucket=get_attachments_bucket())
                    size = int(head.get("ContentLength", 0))
                    if size > 0:
                        snapshot_bytes = await storage.get_object_range(
                            vp.snapshot_storage_key, 0, size - 1, bucket=get_attachments_bucket(),
                        )
                except Exception:
                    pass

            pv = ParsedViewpoint(
                guid=vp.guid,
                camera_type=vp.camera_type,
                camera_view_point=Vec3(x=vp.camera_vp_x, y=vp.camera_vp_y, z=vp.camera_vp_z),
                camera_direction=Vec3(x=vp.camera_dir_x, y=vp.camera_dir_y, z=vp.camera_dir_z),
                camera_up_vector=Vec3(x=vp.camera_up_x, y=vp.camera_up_y, z=vp.camera_up_z),
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

        # Header/File: emit the standard model reference so other BCF tools can
        # match this topic to the right model + version.
        files: list[ParsedFile] = []
        if topic.linked_file is not None:
            lf = topic.linked_file
            files.append(ParsedFile(
                ifc_project=lf.ifc_project_guid,
                filename=lf.original_filename,
                date=lf.created_at,
                is_external=True,
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
            files=files,
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
            "Content-Disposition": safe_content_disposition(filename),
            "Content-Length": str(len(archive_bytes)),
        },
    )
