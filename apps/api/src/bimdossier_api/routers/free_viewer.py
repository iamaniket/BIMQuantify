"""Free-tier ("free wedge") API surface.

Pooled, org-less endpoints over `public.free_models` / `public.free_snags`.
Users hit `get_free_session` (search_path=public, ROLE bim_app, only
`app.current_user_id` GUC) — never `get_tenant_session`. The owner-keyed RLS on
the free tables does the isolation; the free extraction callback runs as the
superuser (RLS-bypassing) and so must additionally validate every artifact key
with `assert_free_key_scoped`.

Surface:
  POST   /free/models/initiate                  cap-enforced presigned PUT
  POST   /free/models/{id}/complete             header parse + dispatch
  GET    /free/models                           list my models
  GET    /free/models/{id}                      model detail
  GET    /free/models/{id}/viewer-bundle        presigned fragments + artifacts
  DELETE /free/models/{id}                       delete row + objects
  POST   /free/models/{id}/snags                create snag
  GET    /free/models/{id}/snags                list snags
  PATCH  /free/snags/{id}                        edit / close snag
  DELETE /free/snags/{id}                        delete snag
  POST   /internal/jobs/free-callback           worker → write artifact keys

Every user-facing endpoint is gated on FREE_TIER_ENABLED (403 FREE_TIER_DISABLED
when off); the worker callback is gated only by the shared secret so in-flight
extractions still complete if the flag is flipped off.
"""

import os
from typing import cast
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select, update
from sqlalchemy import text as sql_text
from sqlalchemy.ext.asyncio import AsyncSession

from bimdossier_api.auth.fastapi_users import current_verified_user
from bimdossier_api.auth.ratelimit import FREE_UPLOAD_INITIATE_LIMITER
from bimdossier_api.background.locks import lock_id_for
from bimdossier_api.config import Settings, get_settings
from bimdossier_api.db import get_session_maker
from bimdossier_api.ifc.header import looks_like_zip, parse_ifc_header
from bimdossier_api.jobs import (
    FREE_CALLBACK_PATH,
    FREE_TIER_SENTINEL_ORG,
    DispatchJobError,
    JobTier,
    dispatch_job,
    require_worker_secret,
)
from bimdossier_api.models.free_model import FreeModel
from bimdossier_api.models.free_project import FreeProject
from bimdossier_api.models.free_snag import (
    FREE_SNAG_NOTE_MAX,
    FREE_SNAG_SEVERITIES,
    FREE_SNAG_STATUSES,
    FreeSnag,
)
from bimdossier_api.models.job import Job, JobStatus, JobType
from bimdossier_api.models.user import User
from bimdossier_api.storage import StorageBackend, get_storage
from bimdossier_api.storage.minio import ObjectNotFoundError
from bimdossier_api.storage.scoping import assert_free_key_scoped, free_key_prefix
from bimdossier_api.tenancy import get_free_session, open_free_session

# IFC-only for the free tier (the wedge is "view your IFC model free").
_FREE_ALLOWED_EXT = (".ifc", ".ifczip")
_HEADER_PEEK_BYTES = 2048
_ACTIVE_EXTRACTION = ("queued", "running")


def require_free_tier_enabled() -> None:
    """Gate every user-facing /free/* endpoint on the kill-switch."""
    if not get_settings().free_tier_enabled:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="FREE_TIER_DISABLED"
        )


router = APIRouter(
    prefix="/free",
    tags=["free-viewer"],
    dependencies=[Depends(require_free_tier_enabled)],
)
# Worker callback — secret-gated, NOT flag-gated (in-flight jobs must finish).
internal_router = APIRouter(prefix="/internal/jobs", tags=["internal"])


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------


class FreeModelInitiateRequest(BaseModel):
    filename: str = Field(min_length=1, max_length=255)
    size_bytes: int = Field(ge=1)
    content_type: str = Field(default="application/octet-stream", max_length=255)
    content_sha256: str | None = Field(default=None, max_length=64)
    # Optionally upload the model straight into a free project (grouping). The
    # project must be the caller's own — verified before the row is created.
    free_project_id: UUID | None = None


class FreeModelInitiateResponse(BaseModel):
    model_id: UUID
    upload_url: str
    storage_key: str
    expires_in: int


class FreeModelRead(BaseModel):
    id: UUID
    name: str
    original_filename: str
    status: str
    extraction_status: str
    ifc_schema: str | None
    size_bytes: int
    rejection_reason: str | None
    extraction_error: str | None
    converted_to_file_id: UUID | None
    free_project_id: UUID | None

    @classmethod
    def of(cls, m: FreeModel) -> "FreeModelRead":
        return cls(
            id=m.id,
            name=m.name,
            original_filename=m.original_filename,
            status=m.status,
            extraction_status=m.extraction_status,
            ifc_schema=m.ifc_schema,
            size_bytes=m.size_bytes,
            rejection_reason=m.rejection_reason,
            extraction_error=m.extraction_error,
            converted_to_file_id=m.converted_to_file_id,
            free_project_id=m.free_project_id,
        )


class FreeModelUpdate(BaseModel):
    # Rename or (re)assign a model to a free project. `free_project_id` may be set
    # to null to ungroup. Omitted fields are left unchanged (exclude_unset).
    name: str | None = Field(default=None, min_length=1, max_length=255)
    free_project_id: UUID | None = None


class FreeViewerBundle(BaseModel):
    model_id: UUID
    scene_id: str
    fragments_url: str
    metadata_url: str | None
    outline_url: str | None
    properties_url: str | None


class FreeSnagCreate(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    note: str | None = Field(default=None, max_length=FREE_SNAG_NOTE_MAX)
    severity: str = Field(default="medium")
    linked_file_type: str = Field(default="ifc", max_length=8)
    anchor_x: float | None = None
    anchor_y: float | None = None
    anchor_z: float | None = None
    anchor_page: int | None = None
    linked_element_global_id: str | None = Field(default=None, max_length=255)


class FreeSnagUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    note: str | None = Field(default=None, max_length=FREE_SNAG_NOTE_MAX)
    severity: str | None = None
    status: str | None = None


class FreeSnagRead(BaseModel):
    id: UUID
    free_model_id: UUID
    title: str
    note: str | None
    severity: str
    status: str
    linked_file_type: str
    anchor_x: float | None
    anchor_y: float | None
    anchor_z: float | None
    anchor_page: int | None
    linked_element_global_id: str | None

    @classmethod
    def of(cls, s: FreeSnag) -> "FreeSnagRead":
        return cls(
            id=s.id,
            free_model_id=s.free_model_id,
            title=s.title,
            note=s.note,
            severity=s.severity,
            status=s.status,
            linked_file_type=s.linked_file_type,
            anchor_x=s.anchor_x,
            anchor_y=s.anchor_y,
            anchor_z=s.anchor_z,
            anchor_page=s.anchor_page,
            linked_element_global_id=s.linked_element_global_id,
        )


class FreeCallbackRequest(BaseModel):
    # Mirrors the processor's CallbackPayload: it echoes back `file_id` (= the
    # free model id we dispatched with) and the artifact keys it uploaded. Extra
    # processor fields (organization_id, job_id, geometry_key, …) are ignored.
    file_id: UUID
    status: str  # running | succeeded | failed
    fragments_key: str | None = None
    metadata_key: str | None = None
    outline_key: str | None = None
    properties_key: str | None = None
    error: str | None = None


# ---------------------------------------------------------------------------
# Models — upload
# ---------------------------------------------------------------------------


@router.post(
    "/models/initiate",
    response_model=FreeModelInitiateResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(FREE_UPLOAD_INITIATE_LIMITER)],
)
async def initiate_free_upload(
    payload: FreeModelInitiateRequest,
    user: User = Depends(current_verified_user),
    session: AsyncSession = Depends(get_free_session),
    storage: StorageBackend = Depends(get_storage),
    settings: Settings = Depends(get_settings),
) -> FreeModelInitiateResponse:
    ext = os.path.splitext(payload.filename)[1].lower()
    if ext not in _FREE_ALLOWED_EXT:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="INVALID_FILE_EXTENSION"
        )
    if payload.size_bytes > settings.free_upload_max_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="FREE_UPLOAD_TOO_LARGE",
        )

    # Per-user model cap. RLS scopes this count to the caller's own rows.
    existing = (
        await session.scalar(
            select(func.count()).select_from(FreeModel).where(
                FreeModel.owner_user_id == user.id
            )
        )
    ) or 0
    if existing >= settings.free_max_models_per_user:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="FREE_MODEL_CAP_REACHED"
        )

    if payload.free_project_id is not None:
        await _assert_free_project_owned(session, payload.free_project_id, user.id)

    model_id = uuid4()
    storage_key = f"{free_key_prefix(user.id)}{model_id}/source{ext}"
    model = FreeModel(
        id=model_id,
        owner_user_id=user.id,
        free_project_id=payload.free_project_id,
        name=payload.filename,
        original_filename=payload.filename,
        storage_key=storage_key,
        size_bytes=payload.size_bytes,
        content_sha256=payload.content_sha256,
        status="pending",
        extraction_status="none",
    )
    session.add(model)
    upload_url = await storage.presigned_put_url(
        storage_key, payload.content_type, payload.size_bytes
    )
    return FreeModelInitiateResponse(
        model_id=model_id,
        upload_url=upload_url,
        storage_key=storage_key,
        expires_in=storage.presign_ttl,
    )


@router.post("/models/{model_id}/complete", response_model=FreeModelRead)
async def complete_free_upload(
    model_id: UUID,
    user: User = Depends(current_verified_user),
    storage: StorageBackend = Depends(get_storage),
    settings: Settings = Depends(get_settings),
) -> FreeModelRead:
    # Phase A — load + snapshot (own short free session, no connection held
    # during the S3 round-trips in phase B).
    async with open_free_session(user.id) as session:
        model = await _load_free_model_or_404(session, model_id, user.id)
        storage_key = model.storage_key
        size_bytes = model.size_bytes
        cur_status = model.status
        cur_extraction = model.extraction_status
        ext = os.path.splitext(storage_key)[1].lower()

    if cur_status == "rejected":
        return await _reload_free_model(user.id, model_id)
    if cur_status == "ready" and cur_extraction not in ("none", "failed"):
        # Already dispatched / running / done — idempotent.
        return await _reload_free_model(user.id, model_id)

    needs_validation = cur_status == "pending"

    if needs_validation:
        # Phase B — HEAD + header peek (no DB connection held).
        try:
            head = await storage.head_object(storage_key)
        except ObjectNotFoundError as exc:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail="OBJECT_NOT_UPLOADED"
            ) from exc
        actual = int(cast("int", head.get("ContentLength", 0) or 0))
        if actual > settings.free_upload_max_bytes:
            await _set_rejected(user.id, model_id, "FREE_UPLOAD_TOO_LARGE")
            return await _reload_free_model(user.id, model_id)
        peek = await storage.get_object_range(storage_key, 0, _HEADER_PEEK_BYTES - 1)

        rejection: str | None = None
        ifc_schema: str | None = None
        if ext == ".ifczip":
            if not looks_like_zip(peek):
                rejection = "FILE_NOT_ISO_10303_21"
        else:
            result = parse_ifc_header(peek)
            if result.rejection is not None:
                rejection = result.rejection.value
            elif result.schema is not None:
                ifc_schema = result.schema.value

        if rejection is not None:
            await _set_rejected(user.id, model_id, rejection)
            return await _reload_free_model(user.id, model_id)

        # Phase C — flip to ready.
        async with open_free_session(user.id) as session:
            await session.execute(
                update(FreeModel)
                .where(FreeModel.id == model_id, FreeModel.owner_user_id == user.id)
                .values(status="ready", ifc_schema=ifc_schema)
            )

    # Phase D — claim a global+per-user extraction slot, then dispatch.
    claimed = await _claim_free_extraction_slot(model_id, user.id, settings)
    if not claimed:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="FREE_EXTRACTION_BUSY",
        )

    detached = Job(
        id=model_id,
        job_type=JobType.ifc_extraction,
        status=JobStatus.pending,
        payload={
            # `file_id`/`project_id` satisfy the processor's IFC payload parse;
            # the processor derives artifact keys from `storage_key` (source.ifc
            # → source.frag …), so free artifacts land under free/<uid>/<mid>/.
            # `file_id` is echoed back as the callback identifier (= free model id).
            "file_id": str(model_id),
            "project_id": str(model_id),
            "storage_key": storage_key,
            # Route the worker's callback to the free path (it reads this off the
            # payload); the standard tenant callback must never see a free job.
            "callback_path": FREE_CALLBACK_PATH,
            # Cheaper meshing for the free path (paid keeps the threshold-1 default).
            "geometry_threshold": settings.free_job_geometry_threshold,
            "compressed": ext == ".ifczip",
        },
    )
    try:
        await dispatch_job(
            detached, settings, FREE_TIER_SENTINEL_ORG, tier=JobTier.free
        )
    except DispatchJobError as exc:
        await _set_extraction_failed(model_id, "dispatch failed")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY, detail="PROCESSOR_UNREACHABLE"
        ) from exc
    _ = size_bytes  # snapshot retained for parity with the tenant flow
    return await _reload_free_model(user.id, model_id)


# ---------------------------------------------------------------------------
# Models — read / delete
# ---------------------------------------------------------------------------


@router.get("/models", response_model=list[FreeModelRead])
async def list_free_models(
    user: User = Depends(current_verified_user),
    session: AsyncSession = Depends(get_free_session),
) -> list[FreeModelRead]:
    rows = (
        await session.execute(
            select(FreeModel)
            .where(FreeModel.owner_user_id == user.id)
            .order_by(FreeModel.created_at.desc())
        )
    ).scalars().all()
    return [FreeModelRead.of(m) for m in rows]


@router.get("/models/{model_id}", response_model=FreeModelRead)
async def get_free_model(
    model_id: UUID,
    user: User = Depends(current_verified_user),
    session: AsyncSession = Depends(get_free_session),
) -> FreeModelRead:
    model = await _load_free_model_or_404(session, model_id, user.id)
    return FreeModelRead.of(model)


@router.patch("/models/{model_id}", response_model=FreeModelRead)
async def update_free_model(
    model_id: UUID,
    payload: FreeModelUpdate,
    user: User = Depends(current_verified_user),
    session: AsyncSession = Depends(get_free_session),
) -> FreeModelRead:
    model = await _load_free_model_or_404(session, model_id, user.id)
    data = payload.model_dump(exclude_unset=True)
    if "free_project_id" in data:
        if data["free_project_id"] is not None:
            await _assert_free_project_owned(session, data["free_project_id"], user.id)
        model.free_project_id = data["free_project_id"]
    if data.get("name") is not None:
        model.name = data["name"]
    return FreeModelRead.of(model)


@router.get("/models/{model_id}/viewer-bundle", response_model=FreeViewerBundle)
async def free_viewer_bundle(
    model_id: UUID,
    user: User = Depends(current_verified_user),
    session: AsyncSession = Depends(get_free_session),
    storage: StorageBackend = Depends(get_storage),
) -> FreeViewerBundle:
    model = await _load_free_model_or_404(session, model_id, user.id)
    if model.extraction_status != "succeeded" or not model.fragments_key:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="FREE_NOT_READY"
        )
    # Stamp last-viewed so the idle reaper doesn't reap an actively-used model.
    model.last_viewed_at = func.now()

    async def _get(key: str | None, suffix: str) -> str | None:
        if key is None:
            return None
        return await storage.presigned_get_url(
            key, f"{model_id}-{suffix}", disposition="inline"
        )

    fragments_url = await _get(model.fragments_key, "fragments")
    assert fragments_url is not None  # guarded by the FREE_NOT_READY check above
    return FreeViewerBundle(
        model_id=model_id,
        scene_id=f"file-{model_id}",
        fragments_url=fragments_url,
        metadata_url=await _get(model.metadata_key, "metadata"),
        outline_url=await _get(model.outline_key, "outline"),
        properties_url=await _get(model.properties_key, "properties"),
    )


@router.delete("/models/{model_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_free_model(
    model_id: UUID,
    user: User = Depends(current_verified_user),
    storage: StorageBackend = Depends(get_storage),
) -> None:
    async with open_free_session(user.id) as session:
        model = await _load_free_model_or_404(session, model_id, user.id)
        prefix = f"{free_key_prefix(user.id)}{model_id}/"
        await session.delete(model)  # cascades free_snags
    # Storage cleanup after the row is gone (best-effort; reaper backstops).
    await storage.delete_prefix(prefix)


# ---------------------------------------------------------------------------
# Snags
# ---------------------------------------------------------------------------


@router.post(
    "/models/{model_id}/snags",
    response_model=FreeSnagRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_free_snag(
    model_id: UUID,
    payload: FreeSnagCreate,
    user: User = Depends(current_verified_user),
    session: AsyncSession = Depends(get_free_session),
) -> FreeSnagRead:
    if payload.severity not in FREE_SNAG_SEVERITIES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="VALIDATION_ERROR"
        )
    # Ownership of the parent model is enforced by RLS (404 if not the owner's).
    await _load_free_model_or_404(session, model_id, user.id)
    snag = FreeSnag(
        free_model_id=model_id,
        owner_user_id=user.id,
        title=payload.title,
        note=payload.note,
        severity=payload.severity,
        status="open",
        linked_file_type=payload.linked_file_type,
        anchor_x=payload.anchor_x,
        anchor_y=payload.anchor_y,
        anchor_z=payload.anchor_z,
        anchor_page=payload.anchor_page,
        linked_element_global_id=payload.linked_element_global_id,
    )
    session.add(snag)
    await session.flush()
    return FreeSnagRead.of(snag)


@router.get("/models/{model_id}/snags", response_model=list[FreeSnagRead])
async def list_free_snags(
    model_id: UUID,
    user: User = Depends(current_verified_user),
    session: AsyncSession = Depends(get_free_session),
) -> list[FreeSnagRead]:
    await _load_free_model_or_404(session, model_id, user.id)
    rows = (
        await session.execute(
            select(FreeSnag)
            .where(FreeSnag.free_model_id == model_id)
            .order_by(FreeSnag.created_at.asc())
        )
    ).scalars().all()
    return [FreeSnagRead.of(s) for s in rows]


@router.patch("/snags/{snag_id}", response_model=FreeSnagRead)
async def update_free_snag(
    snag_id: UUID,
    payload: FreeSnagUpdate,
    user: User = Depends(current_verified_user),
    session: AsyncSession = Depends(get_free_session),
) -> FreeSnagRead:
    snag = await _load_free_snag_or_404(session, snag_id, user.id)
    if payload.severity is not None:
        if payload.severity not in FREE_SNAG_SEVERITIES:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="VALIDATION_ERROR",
            )
        snag.severity = payload.severity
    if payload.status is not None:
        if payload.status not in FREE_SNAG_STATUSES:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="VALIDATION_ERROR",
            )
        snag.status = payload.status
    if payload.title is not None:
        snag.title = payload.title
    if payload.note is not None:
        snag.note = payload.note
    return FreeSnagRead.of(snag)


@router.delete("/snags/{snag_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_free_snag(
    snag_id: UUID,
    user: User = Depends(current_verified_user),
    session: AsyncSession = Depends(get_free_session),
) -> None:
    snag = await _load_free_snag_or_404(session, snag_id, user.id)
    await session.delete(snag)


# ---------------------------------------------------------------------------
# Worker callback (secret-gated, superuser session — RLS-bypassing)
# ---------------------------------------------------------------------------


@internal_router.post("/free-callback", status_code=status.HTTP_200_OK)
async def free_extraction_callback(
    payload: FreeCallbackRequest,
    _: None = Depends(require_worker_secret),
) -> dict[str, bool]:
    async with get_session_maker()() as session, session.begin():
        # Superuser session bypasses RLS — operate cross-user by id, so every
        # artifact key MUST be validated against the OWNER's prefix below.
        model = await session.get(FreeModel, payload.file_id, with_for_update=True)
        if model is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="FREE_MODEL_NOT_FOUND"
            )
        if model.extraction_status in ("succeeded", "failed"):
            return {"ok": True}  # terminal — idempotent no-op

        owner = model.owner_user_id
        if payload.status == "running":
            model.extraction_status = "running"
        elif payload.status == "succeeded":
            for key in (
                payload.fragments_key,
                payload.metadata_key,
                payload.outline_key,
                payload.properties_key,
            ):
                assert_free_key_scoped(key, owner)
            model.fragments_key = payload.fragments_key
            model.metadata_key = payload.metadata_key
            model.outline_key = payload.outline_key
            model.properties_key = payload.properties_key
            model.extraction_status = "succeeded"
            model.extraction_error = None
        elif payload.status == "failed":
            model.extraction_status = "failed"
            model.extraction_error = (payload.error or "extraction failed")[:2000]
        else:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="VALIDATION_ERROR",
            )
    return {"ok": True}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _load_free_model_or_404(
    session: AsyncSession, model_id: UUID, user_id: UUID
) -> FreeModel:
    model = (
        await session.execute(
            select(FreeModel).where(
                FreeModel.id == model_id, FreeModel.owner_user_id == user_id
            )
        )
    ).scalar_one_or_none()
    if model is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="FREE_MODEL_NOT_FOUND"
        )
    return model


async def _assert_free_project_owned(
    session: AsyncSession, project_id: UUID, user_id: UUID
) -> None:
    exists = (
        await session.execute(
            select(FreeProject.id).where(
                FreeProject.id == project_id, FreeProject.owner_user_id == user_id
            )
        )
    ).scalar_one_or_none()
    if exists is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="FREE_PROJECT_NOT_FOUND"
        )


async def _load_free_snag_or_404(
    session: AsyncSession, snag_id: UUID, user_id: UUID
) -> FreeSnag:
    snag = (
        await session.execute(
            select(FreeSnag).where(
                FreeSnag.id == snag_id, FreeSnag.owner_user_id == user_id
            )
        )
    ).scalar_one_or_none()
    if snag is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="FREE_SNAG_NOT_FOUND"
        )
    return snag


async def _reload_free_model(user_id: UUID, model_id: UUID) -> FreeModelRead:
    async with open_free_session(user_id) as session:
        model = await _load_free_model_or_404(session, model_id, user_id)
        return FreeModelRead.of(model)


async def _set_rejected(user_id: UUID, model_id: UUID, reason: str) -> None:
    async with open_free_session(user_id) as session:
        await session.execute(
            update(FreeModel)
            .where(FreeModel.id == model_id, FreeModel.owner_user_id == user_id)
            .values(status="rejected", rejection_reason=reason)
        )


async def _set_extraction_failed(model_id: UUID, error: str) -> None:
    async with get_session_maker()() as session, session.begin():
        await session.execute(
            update(FreeModel)
            .where(FreeModel.id == model_id)
            .values(extraction_status="failed", extraction_error=error)
        )


async def _claim_free_extraction_slot(
    model_id: UUID, user_id: UUID, settings: Settings
) -> bool:
    """Atomically check the global + per-user free-extraction caps and claim a
    slot by flipping the model to `queued`. Runs in a SUPERUSER session (RLS
    bypassed) so the GLOBAL count sees every user's rows — a free session can
    only see the caller's. A single global advisory lock serializes the
    count-and-claim so two concurrent completes can't both pass the cap.
    """
    async with get_session_maker()() as session, session.begin():
        await session.execute(
            sql_text("SELECT pg_advisory_xact_lock(:k)"),
            {"k": lock_id_for("free_extraction:global")},
        )
        global_active = (
            await session.scalar(
                select(func.count())
                .select_from(FreeModel)
                .where(FreeModel.extraction_status.in_(_ACTIVE_EXTRACTION))
            )
        ) or 0
        if global_active >= settings.free_extraction_concurrency_global:
            return False
        user_active = (
            await session.scalar(
                select(func.count())
                .select_from(FreeModel)
                .where(
                    FreeModel.owner_user_id == user_id,
                    FreeModel.extraction_status.in_(_ACTIVE_EXTRACTION),
                )
            )
        ) or 0
        if user_active >= settings.free_extraction_concurrency_per_user:
            return False
        await session.execute(
            update(FreeModel)
            .where(FreeModel.id == model_id, FreeModel.owner_user_id == user_id)
            .values(extraction_status="queued")
        )
    return True
