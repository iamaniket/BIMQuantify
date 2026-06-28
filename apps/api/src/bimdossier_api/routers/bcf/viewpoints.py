"""BCF viewpoint endpoints + two-phase snapshot upload."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from bimdossier_api import audit
from bimdossier_api.access import load_project_or_404, require_membership
from bimdossier_api.auth.fastapi_users import current_verified_user
from bimdossier_api.auth.permissions import Action, Resource, require_permission
from bimdossier_api.models.user import User
from bimdossier_api.schemas.bcf import BcfViewpointCreate, BcfViewpointRead
from bimdossier_api.storage import StorageBackend, get_attachments_bucket, get_storage
from bimdossier_api.storage.minio import ObjectNotFoundError
from bimdossier_api.tenancy import (
    get_tenant_session,
    require_active_organization,
    schema_name_for,
)

from bimdossier_api.routers.bcf._shared import (
    _build_viewpoint,
    _load_topic_or_404,
    _resolve_snapshot_url,
    _snapshot_key,
    _snapshot_prefix,
    router,
)


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
            request=request,
        )
        raise

    topic = await _load_topic_or_404(session, project.id, topic_id)
    vp = _build_viewpoint(payload, topic.id)
    session.add(vp)
    await session.flush()
    await session.refresh(vp)

    storage = get_storage()
    snapshot_url = await _resolve_snapshot_url(
        vp, storage, _snapshot_prefix(schema_name_for(active_org_id))
    )

    return BcfViewpointRead(
        id=vp.id,
        guid=vp.guid,
        index_in_topic=vp.index_in_topic,
        camera_type=vp.camera_type,
        camera_view_point={"x": vp.camera_vp_x, "y": vp.camera_vp_y, "z": vp.camera_vp_z},
        camera_direction={"x": vp.camera_dir_x, "y": vp.camera_dir_y, "z": vp.camera_dir_z},
        camera_up_vector={"x": vp.camera_up_x, "y": vp.camera_up_y, "z": vp.camera_up_z},
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
    # Accepted for backward compatibility but IGNORED: the server recomputes the
    # canonical key from the org schema + topic/viewpoint GUIDs rather than trust
    # a client-supplied key (which could point at another tenant's object in the
    # shared attachments bucket). See complete_snapshot_upload.
    storage_key: str | None = None


@router.post("/{topic_id}/viewpoints/{viewpoint_id}/snapshot-upload", response_model=SnapshotInitiateResponse)
async def initiate_snapshot_upload(
    project_id: UUID,
    topic_id: UUID,
    viewpoint_id: UUID,
    payload: SnapshotInitiateRequest,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
    storage: StorageBackend = Depends(get_storage),
) -> Any:
    project = await load_project_or_404(session, project_id)
    membership = await require_membership(session, project.id, user.id)
    require_permission(membership.role, Resource.bcf_topic, Action.update)

    topic = await _load_topic_or_404(session, project.id, topic_id, eager=True)
    vp = next((v for v in topic.viewpoints if v.id == viewpoint_id), None)
    if vp is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="BCF_VIEWPOINT_NOT_FOUND")

    key = _snapshot_key(schema_name_for(active_org_id), topic.guid, vp.guid)

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
    storage: StorageBackend = Depends(get_storage),
) -> dict[str, str]:
    project = await load_project_or_404(session, project_id)
    membership = await require_membership(session, project.id, user.id)
    require_permission(membership.role, Resource.bcf_topic, Action.update)

    topic = await _load_topic_or_404(session, project.id, topic_id, eager=True)
    vp = next((v for v in topic.viewpoints if v.id == viewpoint_id), None)
    if vp is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="BCF_VIEWPOINT_NOT_FOUND")

    # Recompute the canonical key server-side — never trust payload.storage_key.
    # This is the exact key `initiate_snapshot_upload` presigned, so the client's
    # upload lands here; a client value pointing elsewhere is simply ignored.
    key = _snapshot_key(schema_name_for(active_org_id), topic.guid, vp.guid)

    # HEAD-verify the object exists before binding the row to it.
    try:
        await storage.head_object(key, bucket=get_attachments_bucket())
    except ObjectNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="OBJECT_NOT_UPLOADED",
        ) from exc

    vp.snapshot_storage_key = key
    await session.flush()
    return {"status": "ok"}
