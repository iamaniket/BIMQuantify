"""Aligned PDF sheets: CRUD + the manual 2-point calibration endpoint.

An aligned sheet bridges a 3D ``Model`` (+ one of its storeys) and a PDF
``Model`` page (``pdf_model_id``), carrying the solved similarity transform. The
row is created uncalibrated, then ``POST /{id}/calibrate`` solves and stores the
transform from the control points the user picked.

Writes reuse the ``project_file`` permission cell (a drawing alignment is a
project-file-level action — owner/editor/contractor); reads need only
project-read access. Tenant isolation is the schema boundary; no explicit
``commit`` (the ``get_tenant_session`` transaction owns it).
"""

from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from bimstitch_api.access import (
    load_project_or_404,
    require_membership,
    require_project_read_access,
    require_project_writable,
)
from bimstitch_api.alignment import DegeneratePointsError, solve_similarity
from bimstitch_api.auth.fastapi_users import current_verified_user
from bimstitch_api.auth.permissions import Action, Resource, require_permission
from bimstitch_api.models.aligned_sheets import AlignedSheet
from bimstitch_api.models.model import Model
from bimstitch_api.models.project_file import FileType
from bimstitch_api.models.storeys import Storey
from bimstitch_api.models.user import User
from bimstitch_api.pagination import set_total_count
from bimstitch_api.schemas.aligned_sheet import (
    AlignedSheetCreate,
    AlignedSheetRead,
    AlignedSheetUpdate,
    CalibrateRequest,
)
from bimstitch_api.tenancy import get_tenant_session, require_active_organization

router = APIRouter(prefix="/projects/{project_id}/aligned-sheets", tags=["aligned-sheets"])


async def _load_sheet_or_404(
    session: AsyncSession, project_id: UUID, sheet_id: UUID
) -> AlignedSheet:
    sheet = (
        await session.execute(
            select(AlignedSheet).where(
                AlignedSheet.id == sheet_id,
                AlignedSheet.project_id == project_id,
                AlignedSheet.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if sheet is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="ALIGNED_SHEET_NOT_FOUND")
    return sheet


async def _load_model_in_project(
    session: AsyncSession, project_id: UUID, model_id: UUID
) -> Model | None:
    return (
        await session.execute(
            select(Model).where(Model.id == model_id, Model.project_id == project_id)
        )
    ).scalar_one_or_none()


@router.post("", response_model=AlignedSheetRead, status_code=status.HTTP_201_CREATED)
async def create_aligned_sheet(
    project_id: UUID,
    payload: AlignedSheetCreate,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> AlignedSheet:
    project = await load_project_or_404(session, project_id)
    membership = await require_membership(session, project.id, user.id)
    require_permission(membership.role, Resource.project_file, Action.create)
    require_project_writable(project)

    model = await _load_model_in_project(session, project.id, payload.model_id)
    if model is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="MODEL_NOT_FOUND")

    storey = (
        await session.execute(
            select(Storey).where(Storey.id == payload.storey_id, Storey.deleted_at.is_(None))
        )
    ).scalar_one_or_none()
    if storey is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="STOREY_NOT_FOUND")
    if storey.model_id != payload.model_id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="ALIGNED_SHEET_STOREY_MODEL_MISMATCH",
        )

    pdf_model = await _load_model_in_project(session, project.id, payload.pdf_model_id)
    if pdf_model is None or pdf_model.primary_file_type is not FileType.pdf:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="ALIGNED_SHEET_PDF_MODEL_INVALID",
        )

    sheet = AlignedSheet(
        project_id=project.id,
        model_id=payload.model_id,
        storey_id=payload.storey_id,
        pdf_model_id=payload.pdf_model_id,
        page_index=payload.page_index,
        created_by_user_id=user.id,
    )
    session.add(sheet)
    try:
        await session.flush()
    except IntegrityError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="ALIGNED_SHEET_DUPLICATE"
        ) from exc
    await session.refresh(sheet)
    return sheet


@router.get("", response_model=list[AlignedSheetRead])
async def list_aligned_sheets(
    project_id: UUID,
    response: Response,
    model_id: UUID | None = Query(default=None),
    storey_id: UUID | None = Query(default=None),
    pdf_model_id: UUID | None = Query(default=None),
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> list[AlignedSheet]:
    project = await load_project_or_404(session, project_id)
    await require_project_read_access(session, project.id, user, active_org_id)

    stmt = select(AlignedSheet).where(
        AlignedSheet.project_id == project.id, AlignedSheet.deleted_at.is_(None)
    )
    if model_id is not None:
        stmt = stmt.where(AlignedSheet.model_id == model_id)
    if storey_id is not None:
        stmt = stmt.where(AlignedSheet.storey_id == storey_id)
    if pdf_model_id is not None:
        stmt = stmt.where(AlignedSheet.pdf_model_id == pdf_model_id)

    total = (await session.scalar(select(func.count()).select_from(stmt.subquery()))) or 0
    set_total_count(response, total)

    stmt = stmt.order_by(AlignedSheet.created_at.asc(), AlignedSheet.id.asc())
    return list((await session.execute(stmt)).scalars().all())


@router.get("/{sheet_id}", response_model=AlignedSheetRead)
async def get_aligned_sheet(
    project_id: UUID,
    sheet_id: UUID,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> AlignedSheet:
    project = await load_project_or_404(session, project_id)
    await require_project_read_access(session, project.id, user, active_org_id)
    return await _load_sheet_or_404(session, project.id, sheet_id)


@router.patch("/{sheet_id}", response_model=AlignedSheetRead)
async def update_aligned_sheet(
    project_id: UUID,
    sheet_id: UUID,
    payload: AlignedSheetUpdate,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> AlignedSheet:
    project = await load_project_or_404(session, project_id)
    membership = await require_membership(session, project.id, user.id)
    require_permission(membership.role, Resource.project_file, Action.update)
    require_project_writable(project)

    sheet = await _load_sheet_or_404(session, project.id, sheet_id)
    updates = payload.model_dump(exclude_unset=True)

    if "storey_id" in updates and updates["storey_id"] is not None:
        new_storey_id = updates["storey_id"]
        storey = (
            await session.execute(
                select(Storey).where(Storey.id == new_storey_id, Storey.deleted_at.is_(None))
            )
        ).scalar_one_or_none()
        if storey is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="STOREY_NOT_FOUND")
        # A sheet always pins to a storey of its own 3D model.
        if storey.model_id != sheet.model_id:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="ALIGNED_SHEET_STOREY_MODEL_MISMATCH",
            )

    for field, value in updates.items():
        setattr(sheet, field, value)
    try:
        await session.flush()
    except IntegrityError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="ALIGNED_SHEET_DUPLICATE"
        ) from exc
    await session.refresh(sheet)
    return sheet


@router.post("/{sheet_id}/calibrate", response_model=AlignedSheetRead)
async def calibrate_aligned_sheet(
    project_id: UUID,
    sheet_id: UUID,
    payload: CalibrateRequest,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> AlignedSheet:
    project = await load_project_or_404(session, project_id)
    membership = await require_membership(session, project.id, user.id)
    require_permission(membership.role, Resource.project_file, Action.update)
    require_project_writable(project)

    sheet = await _load_sheet_or_404(session, project.id, sheet_id)

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
    control_points: dict[str, Any] = {
        "pdf": [list(p) for p in payload.pdf_points],
        "plan": [list(p) for p in payload.plan_points],
    }
    sheet.control_points = control_points
    if payload.pdf_file_id is not None:
        sheet.calibrated_pdf_file_id = payload.pdf_file_id

    try:
        await session.flush()
    except IntegrityError as exc:
        # A pdf_file_id that doesn't reference a real project file trips the FK.
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="PROJECT_FILE_NOT_FOUND",
        ) from exc
    await session.refresh(sheet)
    return sheet


@router.delete("/{sheet_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_aligned_sheet(
    project_id: UUID,
    sheet_id: UUID,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> Response:
    project = await load_project_or_404(session, project_id)
    membership = await require_membership(session, project.id, user.id)
    require_permission(membership.role, Resource.project_file, Action.delete)
    require_project_writable(project)

    sheet = await _load_sheet_or_404(session, project.id, sheet_id)
    sheet.soft_delete()
    await session.flush()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


__all__ = ["router"]
