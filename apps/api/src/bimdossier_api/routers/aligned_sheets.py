"""Aligned PDF sheets: CRUD + the manual 2-point calibration endpoint.

An aligned sheet bridges a 3D ``Document`` (+ one of its storeys) and a PDF
``Document`` page (``pdf_document_id``), carrying the solved similarity transform. The
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

from bimdossier_api.access import (
    load_project_or_404,
    require_membership,
    require_project_read_access,
    require_project_writable,
)
from bimdossier_api.alignment import DegeneratePointsError, solve_similarity
from bimdossier_api.auth.fastapi_users import current_verified_user
from bimdossier_api.auth.permissions import Action, Resource, require_permission
from bimdossier_api.models.aligned_sheets import AlignedSheet
from bimdossier_api.models.levels import Level
from bimdossier_api.models.document import Document
from bimdossier_api.models.pdf_pages import PdfPage
from bimdossier_api.models.project_file import (
    FileType,
    ProjectFile,
    ProjectFileRole,
    ProjectFileStatus,
)
from bimdossier_api.models.user import User
from bimdossier_api.pagination import set_total_count
from bimdossier_api.pdf_pages import find_or_create_pdf_page
from bimdossier_api.routers.project_files._shared import resolve_head_file_id
from bimdossier_api.schemas.aligned_sheet import (
    AlignedSheetCreate,
    AlignedSheetRead,
    AlignedSheetUpdate,
    CalibrateRequest,
)
from bimdossier_api.tenancy import get_tenant_session, require_active_organization

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


async def _load_document_in_project(
    session: AsyncSession, project_id: UUID, document_id: UUID
) -> Document | None:
    return (
        await session.execute(
            select(Document).where(Document.id == document_id, Document.project_id == project_id)
        )
    ).scalar_one_or_none()


async def _resolve_page(session: AsyncSession, pdf_document_id: UUID, page_index: int) -> PdfPage:
    """Find-or-create the logical PdfPage for a 0-based ``page_index`` — pages are
    normally materialized at extraction, but a user can calibrate before that."""
    return await find_or_create_pdf_page(session, pdf_document_id, page_index + 1)


async def _is_stale_map(session: AsyncSession, sheets: list[AlignedSheet]) -> dict[UUID, bool]:
    """Map each sheet id -> whether its calibration drifted off the model head.

    A sheet is stale when it is calibrated AND pinned to a specific PDF version
    (``calibrated_pdf_file_id``) that is no longer the PDF model's effective head
    (the version the viewer renders). Batched: one models query + one files query
    regardless of sheet count.
    """
    pinned = [s for s in sheets if s.scale is not None and s.calibrated_pdf_file_id is not None]
    result: dict[UUID, bool] = {s.id: False for s in sheets}
    if not pinned:
        return result
    pdf_document_ids = {s.pdf_document_id for s in pinned}
    models = (
        (await session.execute(select(Document).where(Document.id.in_(pdf_document_ids)))).scalars().all()
    )
    model_by_id = {m.id: m for m in models}
    files = (
        (
            await session.execute(
                select(ProjectFile)
                .where(
                    ProjectFile.document_id.in_(pdf_document_ids),
                    ProjectFile.role == ProjectFileRole.model_source,
                    ProjectFile.status == ProjectFileStatus.ready,
                    ProjectFile.deleted_at.is_(None),
                )
                .order_by(ProjectFile.document_id, ProjectFile.version_number.desc())
            )
        )
        .scalars()
        .all()
    )
    files_by_model: dict[UUID, list[ProjectFile]] = {}
    for f in files:
        if f.document_id is not None:
            files_by_model.setdefault(f.document_id, []).append(f)
    for s in pinned:
        model = model_by_id.get(s.pdf_document_id)
        group = files_by_model.get(s.pdf_document_id, [])
        head = resolve_head_file_id(model, group) if model is not None else None
        result[s.id] = head is not None and head != s.calibrated_pdf_file_id
    return result


def _serialize(sheet: AlignedSheet, *, is_stale: bool) -> AlignedSheetRead:
    read = AlignedSheetRead.model_validate(sheet)
    read.is_stale = is_stale
    return read


@router.post("", response_model=AlignedSheetRead, status_code=status.HTTP_201_CREATED)
async def create_aligned_sheet(
    project_id: UUID,
    payload: AlignedSheetCreate,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> AlignedSheetRead:
    project = await load_project_or_404(session, project_id)
    membership = await require_membership(session, project.id, user.id)
    require_permission(membership.role, Resource.project_file, Action.create)
    require_project_writable(project)

    model = await _load_document_in_project(session, project.id, payload.document_id)
    if model is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="DOCUMENT_NOT_FOUND")

    level = (
        await session.execute(
            select(Level).where(
                Level.id == payload.level_id,
                Level.project_id == project.id,
                Level.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if level is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="LEVEL_NOT_FOUND"
        )

    pdf_model = await _load_document_in_project(session, project.id, payload.pdf_document_id)
    if pdf_model is None or pdf_model.primary_file_type is not FileType.pdf:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="ALIGNED_SHEET_PDF_DOCUMENT_INVALID",
        )

    page = await _resolve_page(session, payload.pdf_document_id, payload.page_index)
    sheet = AlignedSheet(
        project_id=project.id,
        document_id=payload.document_id,
        level_id=payload.level_id,
        pdf_document_id=payload.pdf_document_id,
        page_id=page.id,
        created_by_user_id=user.id,
    )
    session.add(sheet)
    try:
        await session.flush()
    except IntegrityError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="ALIGNED_SHEET_DUPLICATE"
        ) from exc
    sheet = await _load_sheet_or_404(session, project.id, sheet.id)
    stale = await _is_stale_map(session, [sheet])
    return _serialize(sheet, is_stale=stale[sheet.id])


@router.get("", response_model=list[AlignedSheetRead])
async def list_aligned_sheets(
    project_id: UUID,
    response: Response,
    document_id: UUID | None = Query(default=None),
    level_id: UUID | None = Query(default=None),
    pdf_document_id: UUID | None = Query(default=None),
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> list[AlignedSheetRead]:
    project = await load_project_or_404(session, project_id)
    await require_project_read_access(session, project.id, user, active_org_id)

    stmt = select(AlignedSheet).where(
        AlignedSheet.project_id == project.id, AlignedSheet.deleted_at.is_(None)
    )
    if document_id is not None:
        stmt = stmt.where(AlignedSheet.document_id == document_id)
    if level_id is not None:
        stmt = stmt.where(AlignedSheet.level_id == level_id)
    if pdf_document_id is not None:
        stmt = stmt.where(AlignedSheet.pdf_document_id == pdf_document_id)

    total = (await session.scalar(select(func.count()).select_from(stmt.subquery()))) or 0
    set_total_count(response, total)

    stmt = stmt.order_by(AlignedSheet.created_at.asc(), AlignedSheet.id.asc())
    sheets = list((await session.execute(stmt)).scalars().all())
    stale = await _is_stale_map(session, sheets)
    return [_serialize(s, is_stale=stale[s.id]) for s in sheets]


@router.get("/{sheet_id}", response_model=AlignedSheetRead)
async def get_aligned_sheet(
    project_id: UUID,
    sheet_id: UUID,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> AlignedSheetRead:
    project = await load_project_or_404(session, project_id)
    await require_project_read_access(session, project.id, user, active_org_id)
    sheet = await _load_sheet_or_404(session, project.id, sheet_id)
    stale = await _is_stale_map(session, [sheet])
    return _serialize(sheet, is_stale=stale[sheet.id])


@router.patch("/{sheet_id}", response_model=AlignedSheetRead)
async def update_aligned_sheet(
    project_id: UUID,
    sheet_id: UUID,
    payload: AlignedSheetUpdate,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> AlignedSheetRead:
    project = await load_project_or_404(session, project_id)
    membership = await require_membership(session, project.id, user.id)
    require_permission(membership.role, Resource.project_file, Action.update)
    require_project_writable(project)

    sheet = await _load_sheet_or_404(session, project.id, sheet_id)
    updates = payload.model_dump(exclude_unset=True)

    if updates.get("level_id") is not None:
        level = (
            await session.execute(
                select(Level).where(
                    Level.id == updates["level_id"],
                    Level.project_id == project.id,
                    Level.deleted_at.is_(None),
                )
            )
        ).scalar_one_or_none()
        if level is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="LEVEL_NOT_FOUND"
            )
        sheet.level_id = updates["level_id"]

    # page_index is resolved to the logical page (find-or-create); `page_index`
    # is no longer a settable column, so the former generic setattr loop would
    # hit the read-only property.
    if updates.get("page_index") is not None:
        page = await _resolve_page(session, sheet.pdf_document_id, updates["page_index"])
        # Assign the relationship (not just page_id) so the already-loaded `page`
        # is replaced — otherwise the page_number/page_index read properties keep
        # reporting the stale page after the re-load returns this same instance.
        sheet.page = page

    try:
        await session.flush()
    except IntegrityError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="ALIGNED_SHEET_DUPLICATE"
        ) from exc
    sheet = await _load_sheet_or_404(session, project.id, sheet.id)
    stale = await _is_stale_map(session, [sheet])
    return _serialize(sheet, is_stale=stale[sheet.id])


@router.post("/{sheet_id}/calibrate", response_model=AlignedSheetRead)
async def calibrate_aligned_sheet(
    project_id: UUID,
    sheet_id: UUID,
    payload: CalibrateRequest,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> AlignedSheetRead:
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
    sheet = await _load_sheet_or_404(session, project.id, sheet.id)
    stale = await _is_stale_map(session, [sheet])
    return _serialize(sheet, is_stale=stale[sheet.id])


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
