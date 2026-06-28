"""Free-tier project surface — pooled `public.free_projects` + project-scoped views.

The free wedge lets an org-less user group their pooled `free_models` under a
pooled `free_projects` row (still owner-keyed RLS, never an `org_<hex>` schema).
The portal renders free projects through the SAME paid components, so every
endpoint here returns the IDENTICAL paid response schema:

  POST   /free/projects                 → ProjectRead   (reuses ProjectCreate body)
  GET    /free/projects                 → list[ProjectRead]
  GET    /free/projects/{id}            → ProjectRead
  PATCH  /free/projects/{id}            → ProjectRead   (ProjectUpdate body)
  DELETE /free/projects/{id}            → 204           (member models fall to ungrouped)
  GET    /free/projects/{id}/documents  → list[DocumentWithVersions]  (free models as containers)
  GET    /free/projects/{id}/snags      → list[FindingRead]           (board feed)
  GET    /free/projects/{id}/overview   → ProjectOverviewRead         (findings-only completeness)

Org-only overview blocks (dossier / deadlines / certificates / attachments /
reports) are returned zeroed so the existing Zod schemas validate unchanged; the
portal hides those sections behind a capability flag. Flag-gated like the rest of
`/free/*` (FREE_TIER_DISABLED when off).
"""

from datetime import datetime
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from bimdossier_api.auth.fastapi_users import current_verified_user
from bimdossier_api.deadlines.completeness import (
    CompletenessBlock,
    DeadlinesRingBlock,
    DossierBlock,
    FindingsRingBlock,
)
from bimdossier_api.models.document import DocumentDiscipline, DocumentStatus
from bimdossier_api.models.finding import FindingStatus
from bimdossier_api.models.free_model import FreeModel
from bimdossier_api.models.free_project import FreeProject
from bimdossier_api.models.free_snag import FreeSnag
from bimdossier_api.models.project_file import (
    ExtractionStatus,
    FileType,
    IfcSchema,
    ProjectFileRole,
    ProjectFileStatus,
)
from bimdossier_api.models.project_member import ProjectRole
from bimdossier_api.models.user import User
from bimdossier_api.routers.free_viewer import require_free_tier_enabled
from bimdossier_api.schemas.document import DocumentWithVersions
from bimdossier_api.schemas.finding import FindingRead
from bimdossier_api.schemas.project import (
    ProjectCreate,
    ProjectMemberRead,
    ProjectRead,
    ProjectUpdate,
)
from bimdossier_api.schemas.project_file import ProjectFileRead
from bimdossier_api.schemas.project_overview import (
    AttachmentsBlock,
    CertificatesBlock,
    DeadlinesBlock,
    FindingsBlock,
    OverviewStats,
    ProjectOverviewRead,
    ReportsBlock,
)
from bimdossier_api.tenancy import get_free_session

router = APIRouter(
    prefix="/free",
    tags=["free-viewer"],
    dependencies=[Depends(require_free_tier_enabled)],
)

# Per-user grouping cap (storage is bounded by the per-model cap; this just keeps
# the projects list sane). Generous — a free user rarely needs more.
FREE_MAX_PROJECTS_PER_USER = 20
# How many snags each overview findings-preview card serves (mirrors the paid
# OVERVIEW_PREVIEW_LIMIT).
_OVERVIEW_PREVIEW_LIMIT = 8
_AMS = ZoneInfo("Europe/Amsterdam")

_FREE_EXTRACTION_TO_ENUM = {
    "none": ExtractionStatus.not_started,
    "queued": ExtractionStatus.queued,
    "running": ExtractionStatus.running,
    "succeeded": ExtractionStatus.succeeded,
    "failed": ExtractionStatus.failed,
}
_FREE_FILE_STATUS_TO_ENUM = {
    "pending": ProjectFileStatus.pending,
    "ready": ProjectFileStatus.ready,
    "rejected": ProjectFileStatus.rejected,
}
_IFC_SCHEMA_VALUES = {s.value for s in IfcSchema}


# ---------------------------------------------------------------------------
# Project CRUD
# ---------------------------------------------------------------------------


@router.post("/projects", response_model=ProjectRead, status_code=status.HTTP_201_CREATED)
async def create_free_project(
    payload: ProjectCreate,
    user: User = Depends(current_verified_user),
    session: AsyncSession = Depends(get_free_session),
) -> ProjectRead:
    count = (
        await session.scalar(
            select(func.count())
            .select_from(FreeProject)
            .where(FreeProject.owner_user_id == user.id)
        )
    ) or 0
    if count >= FREE_MAX_PROJECTS_PER_USER:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="FREE_PROJECT_CAP_REACHED"
        )
    project = FreeProject(
        owner_user_id=user.id,
        name=payload.name,
        description=payload.description,
        thumbnail_url=payload.thumbnail_url,
        reference_code=payload.reference_code,
        country=payload.country,
        phase=payload.phase.value,
        delivery_date=payload.delivery_date,
        planned_start_date=payload.planned_start_date,
        building_type=payload.building_type.value if payload.building_type else None,
        street=payload.street,
        house_number=payload.house_number,
        postal_code=payload.postal_code,
        city=payload.city,
        municipality=payload.municipality,
        bag_id=payload.bag_id,
        permit_number=payload.permit_number,
        latitude=payload.latitude,
        longitude=payload.longitude,
    )
    session.add(project)
    await session.flush()
    return _free_project_to_read(project)


@router.get("/projects", response_model=list[ProjectRead])
async def list_free_projects(
    user: User = Depends(current_verified_user),
    session: AsyncSession = Depends(get_free_session),
) -> list[ProjectRead]:
    rows = (
        (
            await session.execute(
                select(FreeProject)
                .where(FreeProject.owner_user_id == user.id)
                .order_by(FreeProject.created_at.desc())
            )
        )
        .scalars()
        .all()
    )
    return [_free_project_to_read(p) for p in rows]


@router.get("/projects/{project_id}", response_model=ProjectRead)
async def get_free_project(
    project_id: UUID,
    user: User = Depends(current_verified_user),
    session: AsyncSession = Depends(get_free_session),
) -> ProjectRead:
    project = await _load_free_project_or_404(session, project_id, user.id)
    return _free_project_to_read(project)


@router.patch("/projects/{project_id}", response_model=ProjectRead)
async def update_free_project(
    project_id: UUID,
    payload: ProjectUpdate,
    user: User = Depends(current_verified_user),
    session: AsyncSession = Depends(get_free_session),
) -> ProjectRead:
    project = await _load_free_project_or_404(session, project_id, user.id)
    data = payload.model_dump(exclude_unset=True)
    for field, value in data.items():
        if field == "phase" and value is not None:
            project.phase = value.value if hasattr(value, "value") else value
        elif field == "building_type":
            project.building_type = (
                value.value if (value is not None and hasattr(value, "value")) else value
            )
        elif field == "instrument_ref":
            continue  # free projects don't store the Wkb instrument
        else:
            setattr(project, field, value)
    return _free_project_to_read(project)


@router.delete("/projects/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_free_project(
    project_id: UUID,
    user: User = Depends(current_verified_user),
    session: AsyncSession = Depends(get_free_session),
) -> None:
    project = await _load_free_project_or_404(session, project_id, user.id)
    # FK is ON DELETE SET NULL — member models survive as ungrouped.
    await session.delete(project)


# ---------------------------------------------------------------------------
# Project-scoped views (paid-identical shapes)
# ---------------------------------------------------------------------------


@router.get("/projects/{project_id}/documents", response_model=list[DocumentWithVersions])
async def list_free_project_documents(
    project_id: UUID,
    user: User = Depends(current_verified_user),
    session: AsyncSession = Depends(get_free_session),
) -> list[DocumentWithVersions]:
    await _load_free_project_or_404(session, project_id, user.id)
    rows = (
        (
            await session.execute(
                select(FreeModel)
                .where(FreeModel.free_project_id == project_id)
                .order_by(FreeModel.created_at.desc())
            )
        )
        .scalars()
        .all()
    )
    return [_free_model_to_document(m, project_id) for m in rows]


@router.get("/projects/{project_id}/snags", response_model=list[FindingRead])
async def list_free_project_snags(
    project_id: UUID,
    user: User = Depends(current_verified_user),
    session: AsyncSession = Depends(get_free_session),
) -> list[FindingRead]:
    await _load_free_project_or_404(session, project_id, user.id)
    rows = await _load_project_snags(session, project_id)
    return [_free_snag_to_finding(s, project_id) for s in rows]


@router.get("/projects/{project_id}/overview", response_model=ProjectOverviewRead)
async def get_free_project_overview(
    project_id: UUID,
    user: User = Depends(current_verified_user),
    session: AsyncSession = Depends(get_free_session),
) -> ProjectOverviewRead:
    project = await _load_free_project_or_404(session, project_id, user.id)
    snags = await _load_project_snags(session, project_id)

    by_status: dict[str, int] = {s.value: 0 for s in FindingStatus}
    for snag in snags:
        by_status[snag.status] = by_status.get(snag.status, 0) + 1
    total = sum(by_status.values())
    complete = by_status[FindingStatus.resolved.value] + by_status[FindingStatus.verified.value]
    open_count = by_status[FindingStatus.open.value] + by_status[FindingStatus.in_progress.value]

    findings_ring = FindingsRingBlock(total=total, complete=complete, by_status=by_status)
    # Org-only wedges zeroed (the portal hides them via the capability flag).
    dossier = DossierBlock(
        filled=0, total=0, pct=0, optional_filled=0, optional_total=0, segments=[], items=[]
    )
    deadlines_ring = DeadlinesRingBlock(total=0, met=0, pending=0, overdue=0)
    completeness = CompletenessBlock(
        overall_filled=complete,
        overall_total=total,
        overall_pct=round(100 * complete / total) if total else 0,
        dossier=dossier,
        findings=findings_ring,
        deadlines=deadlines_ring,
    )

    # Newest-first preview (snags come back created_at ASC for the board).
    preview = [
        _free_snag_to_finding(s, project_id)
        for s in sorted(snags, key=lambda s: s.created_at, reverse=True)[:_OVERVIEW_PREVIEW_LIMIT]
    ]
    findings_block = FindingsBlock(count=total, open=open_count, preview=preview)

    delivery_days: int | None = None
    if project.delivery_date is not None:
        delivery_days = (project.delivery_date - datetime.now(_AMS).date()).days
    stats = OverviewStats(
        deadlines_met=0,
        deadlines_total=0,
        attachments_count=0,
        holdback_pct=0,
        delivery_days_remaining=delivery_days,
    )

    owner_member = ProjectMemberRead(
        project_id=project.id,
        user_id=user.id,
        role=ProjectRole.owner,
        created_at=project.created_at,
        email=user.email,
        full_name=user.full_name,
    )

    return ProjectOverviewRead(
        project=_free_project_to_read(project),
        completeness=completeness,
        stats=stats,
        findings=findings_block,
        certificates=CertificatesBlock(count=0, expired=0, expiring_soon=0, preview=[]),
        attachments=AttachmentsBlock(count=0, preview=[]),
        reports=ReportsBlock(count=0, preview=[]),
        deadlines=DeadlinesBlock(total=0, met=0, overdue=0, preview=[]),
        members=[owner_member],
        activity_timeline=[],
    )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _load_free_project_or_404(
    session: AsyncSession, project_id: UUID, user_id: UUID
) -> FreeProject:
    project = (
        await session.execute(
            select(FreeProject).where(
                FreeProject.id == project_id, FreeProject.owner_user_id == user_id
            )
        )
    ).scalar_one_or_none()
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="FREE_PROJECT_NOT_FOUND")
    return project


async def _load_project_snags(session: AsyncSession, project_id: UUID) -> list[FreeSnag]:
    return list(
        (
            await session.execute(
                select(FreeSnag)
                .join(FreeModel, FreeModel.id == FreeSnag.free_model_id)
                .where(FreeModel.free_project_id == project_id)
                .order_by(FreeSnag.created_at.asc())
            )
        )
        .scalars()
        .all()
    )


def _free_project_to_read(p: FreeProject) -> ProjectRead:
    return ProjectRead(
        id=p.id,
        owner_id=p.owner_user_id,
        name=p.name,
        description=p.description,
        thumbnail_url=p.thumbnail_url,
        reference_code=p.reference_code,
        phase=p.phase,
        country=p.country,
        delivery_date=p.delivery_date,
        planned_start_date=p.planned_start_date,
        building_type=p.building_type,
        street=p.street,
        house_number=p.house_number,
        postal_code=p.postal_code,
        city=p.city,
        municipality=p.municipality,
        bag_id=p.bag_id,
        permit_number=p.permit_number,
        instrument_ref=None,
        latitude=p.latitude,
        longitude=p.longitude,
        lifecycle_state=p.lifecycle_state,
        created_at=p.created_at,
        updated_at=p.updated_at,
        # A free project always belongs solely to its creator.
        my_role=ProjectRole.owner,
    )


def _free_model_to_document(m: FreeModel, project_id: UUID) -> DocumentWithVersions:
    ifc_schema = m.ifc_schema if (m.ifc_schema in _IFC_SCHEMA_VALUES) else None
    version = ProjectFileRead(
        id=m.id,
        role=ProjectFileRole.model_source,
        document_id=m.id,
        project_id=project_id,
        version_number=1,
        uploaded_by_user_id=m.owner_user_id,
        original_filename=m.original_filename,
        size_bytes=m.size_bytes,
        content_type="application/octet-stream",
        content_sha256=m.content_sha256,
        ifc_project_guid=None,
        file_type=FileType.ifc,
        ifc_schema=ifc_schema,
        status=_FREE_FILE_STATUS_TO_ENUM.get(m.status, ProjectFileStatus.pending),
        rejection_reason=m.rejection_reason,
        extraction_status=_FREE_EXTRACTION_TO_ENUM.get(
            m.extraction_status, ExtractionStatus.not_started
        ),
        extraction_error=m.extraction_error,
        extraction_started_at=None,
        extraction_finished_at=None,
        extractor_version=None,
        detected_kind=None,
        page_count=None,
        created_at=m.created_at,
        updated_at=m.updated_at,
    )
    return DocumentWithVersions(
        id=m.id,
        project_id=project_id,
        name=m.name,
        discipline=DocumentDiscipline.other,
        status=DocumentStatus.active,
        primary_file_type=FileType.ifc,
        level_id=None,
        head_file_id=m.id,
        created_at=m.created_at,
        updated_at=m.updated_at,
        versions=[version],
    )


def _free_snag_to_finding(s: FreeSnag, project_id: UUID) -> FindingRead:
    """Adapt a pooled free snag to the paid FindingRead shape so the kanban board
    + finding cards render unchanged. Paid-only fields (assignee, deadline,
    photos, template, resolution, bbl ref) are null for the free tier."""
    return FindingRead(
        id=s.id,
        project_id=project_id,
        title=s.title,
        # FindingRead.description is required (min_length=1); free notes are
        # optional, so fall back to the title.
        description=s.note or s.title,
        severity=s.severity,
        bbl_article_ref=None,
        status=s.status,
        assignee_user_id=None,
        deadline_date=None,
        created_by_user_id=s.owner_user_id,
        source_checklist_item_id=None,
        borgingsmoment_id=None,
        # Version-independent identity = the free model (free has no versions).
        linked_document_id=s.free_model_id,
        linked_file_id=s.free_model_id,
        linked_element_global_id=s.linked_element_global_id,
        linked_file_type=s.linked_file_type,
        anchor_x=s.anchor_x,
        anchor_y=s.anchor_y,
        anchor_z=s.anchor_z,
        anchor_page=s.anchor_page,
        anchor_page_id=None,
        photo_ids=None,
        resolution_note=None,
        resolution_evidence_ids=None,
        reference_attachment_ids=None,
        template_id=None,
        custom_values=None,
        duplicate_of_finding_id=None,
        created_at=s.created_at,
        updated_at=s.updated_at,
    )
