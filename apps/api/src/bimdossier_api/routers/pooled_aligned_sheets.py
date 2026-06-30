"""Free-tier PDF↔IFC calibration CRUD — pooled `public.pooled_aligned_sheets`.

Mirror of routers/aligned_sheets.py for the free tier: a 2-point similarity that
overlays a free PDF drawing page on a free IFC model in the unified viewer, reusing
`alignment.similarity.solve_similarity`. The PDF page is referenced by
`page_number` (int) — free has no pooled pdf_pages table.

Owner writes, members read; owner-OR-member RLS (`get_free_session`) is the
isolation boundary, the explicit owner load is the permission gate.
"""

from datetime import datetime
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from bimdossier_api.alignment.similarity import DegeneratePointsError, solve_similarity
from bimdossier_api.auth.fastapi_users import current_verified_user
from bimdossier_api.models.pooled_aligned_sheet import PooledAlignedSheet
from bimdossier_api.models.pooled_document import PooledDocument
from bimdossier_api.models.pooled_level import PooledLevel
from bimdossier_api.models.pooled_project_file import PooledProjectFile
from bimdossier_api.models.user import User
from bimdossier_api.routers.free_access import (
    assert_free_account_not_expired,
    require_free_tier_enabled,
)
from bimdossier_api.routers.pooled_projects import (
    _load_accessible_free_project_or_404,
    _load_free_project_or_404,
)
from bimdossier_api.schemas.aligned_sheet import CalibrateRequest
from bimdossier_api.tenancy import get_free_session

router = APIRouter(
    prefix="/free/projects/{project_id}/aligned-sheets",
    tags=["free-viewer"],
    dependencies=[Depends(require_free_tier_enabled)],
)


class PooledAlignedSheetCreate(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    document_id: UUID  # the 3D (IFC) container supplying world coords
    level_id: UUID
    pdf_document_id: UUID  # the PDF container whose page is aligned
    page_number: int = Field(default=1, ge=1)


class PooledAlignedSheetUpdate(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    level_id: UUID | None = None
    page_number: int | None = Field(default=None, ge=1)


class PooledAlignedSheetRead(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    id: UUID
    project_id: UUID
    document_id: UUID
    level_id: UUID
    pdf_document_id: UUID
    page_number: int
    page_index: int  # 0-based, derived (page_number - 1) for viewer back-compat
    calibrated_pdf_file_id: UUID | None = None
    transform_type: str
    scale: float | None = None
    rotation_rad: float | None = None
    offset_x: float | None = None
    offset_y: float | None = None
    control_points: dict[str, Any] | None = None
    is_calibrated: bool
    is_stale: bool = False
    created_at: datetime
    updated_at: datetime


def _serialize(s: PooledAlignedSheet, *, is_stale: bool = False) -> PooledAlignedSheetRead:
    return PooledAlignedSheetRead(
        id=s.id,
        project_id=s.pooled_project_id,
        document_id=s.pooled_document_id,
        level_id=s.pooled_level_id,
        pdf_document_id=s.pooled_pdf_document_id,
        page_number=s.page_number,
        page_index=s.page_number - 1,
        calibrated_pdf_file_id=s.calibrated_pdf_file_id,
        transform_type=s.transform_type,
        scale=s.scale,
        rotation_rad=s.rotation_rad,
        offset_x=s.offset_x,
        offset_y=s.offset_y,
        control_points=s.control_points,
        is_calibrated=s.is_calibrated,
        is_stale=is_stale,
        created_at=s.created_at,
        updated_at=s.updated_at,
    )


async def _load_sheet_or_404(
    session: AsyncSession, project_id: UUID, sheet_id: UUID
) -> PooledAlignedSheet:
    sheet = (
        await session.execute(
            select(PooledAlignedSheet).where(
                PooledAlignedSheet.id == sheet_id,
                PooledAlignedSheet.pooled_project_id == project_id,
                PooledAlignedSheet.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if sheet is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="ALIGNED_SHEET_NOT_FOUND"
        )
    return sheet


async def _pdf_head_file_id(session: AsyncSession, pdf_document_id: UUID) -> UUID | None:
    """Current head version of a free PDF container (head_file_id, else newest ready)."""
    doc = await session.get(PooledDocument, pdf_document_id)
    if doc is not None and doc.head_file_id is not None:
        return doc.head_file_id
    return await session.scalar(
        select(PooledProjectFile.id)
        .where(
            PooledProjectFile.pooled_document_id == pdf_document_id,
            PooledProjectFile.status == "ready",
            PooledProjectFile.deleted_at.is_(None),
        )
        .order_by(PooledProjectFile.version_number.desc())
        .limit(1)
    )


async def _is_stale(session: AsyncSession, sheet: PooledAlignedSheet) -> bool:
    """True when calibration was solved on a PDF version that's no longer head."""
    if sheet.calibrated_pdf_file_id is None:
        return False
    head = await _pdf_head_file_id(session, sheet.pooled_pdf_document_id)
    return head is not None and sheet.calibrated_pdf_file_id != head


async def _doc_in_project(
    session: AsyncSession, document_id: UUID, project_id: UUID, *, pdf: bool
) -> PooledDocument | None:
    doc = (
        await session.execute(
            select(PooledDocument).where(
                PooledDocument.id == document_id,
                PooledDocument.pooled_project_id == project_id,
                PooledDocument.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if doc is None:
        return None
    if pdf and doc.primary_file_type != "pdf":
        return None
    return doc


@router.post("", response_model=PooledAlignedSheetRead, status_code=status.HTTP_201_CREATED)
async def create_free_aligned_sheet(
    project_id: UUID,
    payload: PooledAlignedSheetCreate,
    user: User = Depends(current_verified_user),
    session: AsyncSession = Depends(get_free_session),
) -> PooledAlignedSheetRead:
    project = await _load_free_project_or_404(session, project_id, user.id)  # owner-only
    await assert_free_account_not_expired(user)
    # The PDF document must exist in the project and actually be a PDF.
    if await _doc_in_project(session, payload.pdf_document_id, project.id, pdf=True) is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="ALIGNED_SHEET_PDF_DOCUMENT_INVALID",
        )
    # The 3D document must exist in the project.
    if await _doc_in_project(session, payload.document_id, project.id, pdf=False) is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="FREE_DOCUMENT_NOT_FOUND"
        )
    # The level must exist in the project.
    level = await session.scalar(
        select(PooledLevel.id).where(
            PooledLevel.id == payload.level_id,
            PooledLevel.pooled_project_id == project.id,
            PooledLevel.deleted_at.is_(None),
        )
    )
    if level is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="LEVEL_NOT_FOUND")

    sheet = PooledAlignedSheet(
        owner_user_id=project.owner_user_id,
        pooled_project_id=project.id,
        pooled_document_id=payload.document_id,
        pooled_level_id=payload.level_id,
        pooled_pdf_document_id=payload.pdf_document_id,
        page_number=payload.page_number,
        created_by_user_id=user.id,
    )
    session.add(sheet)
    try:
        await session.flush()
    except IntegrityError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="ALIGNED_SHEET_DUPLICATE"
        ) from exc
    return _serialize(sheet, is_stale=False)


@router.get("", response_model=list[PooledAlignedSheetRead])
async def list_pooled_aligned_sheets(
    project_id: UUID,
    user: User = Depends(current_verified_user),
    session: AsyncSession = Depends(get_free_session),
) -> list[PooledAlignedSheetRead]:
    await _load_accessible_free_project_or_404(session, project_id)  # owner-or-member
    rows = (
        (
            await session.execute(
                select(PooledAlignedSheet)
                .where(
                    PooledAlignedSheet.pooled_project_id == project_id,
                    PooledAlignedSheet.deleted_at.is_(None),
                )
                .order_by(PooledAlignedSheet.created_at.asc())
            )
        )
        .scalars()
        .all()
    )
    return [_serialize(s, is_stale=await _is_stale(session, s)) for s in rows]


@router.post("/{sheet_id}/calibrate", response_model=PooledAlignedSheetRead)
async def calibrate_free_aligned_sheet(
    project_id: UUID,
    sheet_id: UUID,
    payload: CalibrateRequest,
    user: User = Depends(current_verified_user),
    session: AsyncSession = Depends(get_free_session),
) -> PooledAlignedSheetRead:
    await _load_free_project_or_404(session, project_id, user.id)  # owner-only
    await assert_free_account_not_expired(user)
    sheet = await _load_sheet_or_404(session, project_id, sheet_id)

    try:
        transform = solve_similarity(payload.pdf_points, payload.plan_points)
    except DegeneratePointsError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="ALIGNED_SHEET_DEGENERATE_POINTS",
        ) from exc

    sheet.scale = transform.scale
    sheet.rotation_rad = transform.rotation_rad
    sheet.offset_x = transform.offset_x
    sheet.offset_y = transform.offset_y
    sheet.control_points = {
        "pdf": [list(p) for p in payload.pdf_points],
        "plan": [list(p) for p in payload.plan_points],
    }
    if payload.pdf_file_id is not None:
        sheet.calibrated_pdf_file_id = payload.pdf_file_id

    try:
        await session.flush()
    except IntegrityError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="PROJECT_FILE_NOT_FOUND",
        ) from exc
    await session.refresh(sheet)
    return _serialize(sheet, is_stale=await _is_stale(session, sheet))


@router.patch("/{sheet_id}", response_model=PooledAlignedSheetRead)
async def update_free_aligned_sheet(
    project_id: UUID,
    sheet_id: UUID,
    payload: PooledAlignedSheetUpdate,
    user: User = Depends(current_verified_user),
    session: AsyncSession = Depends(get_free_session),
) -> PooledAlignedSheetRead:
    """Re-pin a sheet to a different level / page (owner-only)."""
    await _load_free_project_or_404(session, project_id, user.id)  # owner-only
    await assert_free_account_not_expired(user)
    sheet = await _load_sheet_or_404(session, project_id, sheet_id)
    updates = payload.model_dump(exclude_unset=True)
    if updates.get("level_id") is not None:
        level = await session.scalar(
            select(PooledLevel.id).where(
                PooledLevel.id == updates["level_id"],
                PooledLevel.pooled_project_id == project_id,
                PooledLevel.deleted_at.is_(None),
            )
        )
        if level is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="LEVEL_NOT_FOUND")
        sheet.pooled_level_id = updates["level_id"]
    if updates.get("page_number") is not None:
        sheet.page_number = updates["page_number"]
    try:
        await session.flush()
    except IntegrityError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="ALIGNED_SHEET_DUPLICATE"
        ) from exc
    await session.refresh(sheet)
    return _serialize(sheet, is_stale=await _is_stale(session, sheet))


@router.delete("/{sheet_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_free_aligned_sheet(
    project_id: UUID,
    sheet_id: UUID,
    user: User = Depends(current_verified_user),
    session: AsyncSession = Depends(get_free_session),
) -> Response:
    await _load_free_project_or_404(session, project_id, user.id)  # owner-only
    sheet = await _load_sheet_or_404(session, project_id, sheet_id)
    await session.delete(sheet)
    await session.flush()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


__all__ = ["router"]
