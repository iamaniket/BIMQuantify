"""Shared router instance + helpers for the BCF topic package.

Split out of the original ``routers/bcf.py``: this module holds the single
``APIRouter`` and every helper used across the topic / comment / viewpoint /
import-export endpoint groups. Endpoint modules import ``router`` and the
helpers from here.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any
from uuid import UUID, uuid4

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from bimdossier_api.bcf.types import ParsedFile
from bimdossier_api.models.bcf_comment import BcfComment
from bimdossier_api.models.bcf_topic import BcfTopic
from bimdossier_api.models.bcf_topic_label import BcfTopicLabel
from bimdossier_api.models.bcf_viewpoint import BcfViewpoint
from bimdossier_api.models.project_file import ProjectFile
from bimdossier_api.models.user import User
from bimdossier_api.schemas.bcf import BcfViewpointCreate
from bimdossier_api.storage import get_attachments_bucket

if TYPE_CHECKING:
    from bimdossier_api.storage import StorageBackend

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
            selectinload(BcfTopic.linked_file),
        )
    topic = (await session.execute(stmt)).scalar_one_or_none()
    if topic is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="BCF_TOPIC_NOT_FOUND")
    return topic


async def _load_project_file_or_404(
    session: AsyncSession,
    project_id: UUID,
    file_id: UUID,
) -> ProjectFile:
    """Load a ProjectFile that belongs to the project (for topic version links)."""
    pf = (
        await session.execute(
            select(ProjectFile).where(
                ProjectFile.id == file_id,
                ProjectFile.project_id == project_id,
                ProjectFile.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if pf is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="PROJECT_FILE_NOT_FOUND"
        )
    return pf


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


def _match_file_to_project_file(
    parsed_files: list[ParsedFile],
    candidates: list[ProjectFile],
) -> ProjectFile | None:
    """Resolve a topic's BCF Header/File entries to a model-source ProjectFile.

    Matches by IfcProject GUID first (stable across versions), falling back to
    filename. When several versions match, the latest (highest version_number)
    wins — the sensible default for a fresh import. ``File.Date`` is preserved on
    round-trip but not used for matching (created_at differs across projects).
    """
    for ref in parsed_files:
        matches: list[ProjectFile] = []
        if ref.ifc_project:
            matches = [
                c
                for c in candidates
                if c.ifc_project_guid and c.ifc_project_guid == ref.ifc_project
            ]
        if not matches and ref.filename:
            matches = [c for c in candidates if c.original_filename == ref.filename]
        if matches:
            return max(matches, key=lambda c: c.version_number)
    return None


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
        "linked_document_id": topic.linked_document_id,
        "linked_file_id": topic.linked_file_id,
        "is_2d": topic.is_2d,
        "model_version": topic.linked_file.version_number if topic.linked_file else None,
        "file_type": (
            topic.linked_file.file_type.value if topic.linked_file else None
        ),
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
            "camera_view_point": {"x": vp.camera_vp_x, "y": vp.camera_vp_y, "z": vp.camera_vp_z},
            "camera_direction": {"x": vp.camera_dir_x, "y": vp.camera_dir_y, "z": vp.camera_dir_z},
            "camera_up_vector": {"x": vp.camera_up_x, "y": vp.camera_up_y, "z": vp.camera_up_z},
            "field_of_view": vp.field_of_view,
            "field_of_height": vp.field_of_height,
            "components": vp.components,
            "clipping_planes": vp.clipping_planes,
            "xray": vp.xray,
            "measurements": vp.measurements,
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
        camera_vp_x=payload.camera_view_point.x,
        camera_vp_y=payload.camera_view_point.y,
        camera_vp_z=payload.camera_view_point.z,
        camera_dir_x=payload.camera_direction.x,
        camera_dir_y=payload.camera_direction.y,
        camera_dir_z=payload.camera_direction.z,
        camera_up_x=payload.camera_up_vector.x,
        camera_up_y=payload.camera_up_vector.y,
        camera_up_z=payload.camera_up_vector.z,
        field_of_view=payload.field_of_view,
        field_of_height=payload.field_of_height,
        components=payload.components.model_dump() if payload.components else None,
        clipping_planes=[cp.model_dump() for cp in payload.clipping_planes] if payload.clipping_planes else None,
        xray=payload.xray.model_dump() if payload.xray else None,
        measurements=(
            [m.model_dump() for m in payload.measurements]
            if payload.measurements
            else None
        ),
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
