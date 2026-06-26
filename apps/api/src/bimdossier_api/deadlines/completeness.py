"""Project dossier-completeness computation.

Single source of truth for "how complete is this project", shared by:

* the per-deadline readiness endpoint (`routers/deadlines.py::get_deadline_readiness`),
  which iterates *one deadline's* required dossier codes, and
* the project-overview aggregate (`routers/projects/overview.py`), whose
  completeness donut iterates the *full* dossier checklist for the project's
  (country, building_type) plus the findings and deadlines rings.

The per-requirement fulfillment helpers (`_check_fulfillment` and the count
helpers) were lifted verbatim out of `routers/deadlines.py` so both callers
compute from one implementation and can never drift. The portal donut
(`features/projects/detail/ProjectChartsPanel.tsx` +
`progressRings/ringSelectors.ts` + `dossierTemplate.ts`) is the client mirror
this reproduces; `compute_project_completeness` returns exactly the numbers it
renders so the dashboard no longer re-derives them client-side.
"""

from datetime import datetime
from uuid import UUID
from zoneinfo import ZoneInfo

from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from bimdossier_api.jurisdictions import get_dossier_requirements, pick_label
from bimdossier_api.models.certificate import Certificate, CertificateStatus
from bimdossier_api.models.deadline import Deadline, DeadlineStatus
from bimdossier_api.models.document import Document
from bimdossier_api.models.finding import Finding, FindingStatus
from bimdossier_api.models.project import Project
from bimdossier_api.models.project_file import (
    ExtractionStatus,
    FileType,
    ProjectFile,
    ProjectFileRole,
    ProjectFileStatus,
)

_AMS = ZoneInfo("Europe/Amsterdam")


# ---------------------------------------------------------------------------
# Response models
# ---------------------------------------------------------------------------


class ReadinessItem(BaseModel):
    """One dossier requirement and its met/missing state. Shared with the
    per-deadline readiness endpoint."""

    code: str
    label: str
    category: str
    required: bool
    fulfilled: bool
    count: int


class CompletenessSegment(BaseModel):
    """A dossier category group (e.g. "documents", "certificates"), counted over
    *all* items in the category — drives the Dossier wedge's drilldown."""

    category: str
    filled: int
    total: int


class DossierBlock(BaseModel):
    """The Dossier wedge: required-only headline + per-category groups."""

    filled: int
    total: int
    # round(filled/total*100); 100 when there are no required items (mirrors
    # `computeDossierCompleteness`, which treats an empty checklist as complete).
    pct: int
    optional_filled: int
    optional_total: int
    segments: list[CompletenessSegment]
    items: list[ReadinessItem]


class FindingsRingBlock(BaseModel):
    """The Findings wedge: a finding is "complete" once resolved or verified."""

    total: int
    complete: int
    by_status: dict[str, int]


class DeadlinesRingBlock(BaseModel):
    """The Deadlines wedge: not_applicable deadlines are excluded from total."""

    total: int
    met: int
    pending: int
    overdue: int


class CompletenessBlock(BaseModel):
    """The whole project-completeness donut: three wedges + the aggregate.

    `overall_*` sum the three wedges' filled/total counts; `overall_pct` uses
    the ring guard (0 when there is nothing to track), matching `ringPct`."""

    overall_filled: int
    overall_total: int
    overall_pct: int
    dossier: DossierBlock
    findings: FindingsRingBlock
    deadlines: DeadlinesRingBlock


# ---------------------------------------------------------------------------
# Per-requirement fulfillment (lifted verbatim from routers/deadlines.py)
# ---------------------------------------------------------------------------


async def _count_ready_attachments_in_slot(
    session: AsyncSession,
    project_id: UUID,
    slot: str,
) -> int:
    """Count ready, non-deleted attachments tagged with the given dossier slot."""
    return (
        await session.scalar(
            select(func.count()).select_from(
                select(ProjectFile.id)
                .where(
                    ProjectFile.project_id == project_id,
                    ProjectFile.role == ProjectFileRole.attachment,
                    ProjectFile.dossier_slot == slot,
                    ProjectFile.status == ProjectFileStatus.ready,
                    ProjectFile.deleted_at.is_(None),
                )
                .subquery()
            )
        )
    ) or 0


async def _count_models(session: AsyncSession, project_id: UUID) -> int:
    """Count non-deleted BIM models in the project."""
    return (
        await session.scalar(
            select(func.count()).select_from(
                select(Document.id)
                .where(
                    Document.project_id == project_id,
                    Document.deleted_at.is_(None),
                )
                .subquery()
            )
        )
    ) or 0


async def _count_viewable_models(session: AsyncSession, project_id: UUID) -> int:
    """Count distinct models with at least one *viewable* model-source file.

    "Viewable" mirrors the portal: a ready IFC whose geometry extraction
    succeeded, or a ready PDF (something the 3D/2D viewer can actually open).
    A model that exists but is still processing — or has no file — does not
    count. This is what fulfils the model-backed "drawings" dossier slot.
    """
    return (
        await session.scalar(
            select(func.count(func.distinct(ProjectFile.document_id))).where(
                ProjectFile.project_id == project_id,
                ProjectFile.role == ProjectFileRole.model_source,
                ProjectFile.deleted_at.is_(None),
                ProjectFile.document_id.is_not(None),
                ProjectFile.status == ProjectFileStatus.ready,
                (
                    (
                        (ProjectFile.file_type == FileType.ifc)
                        & (ProjectFile.extraction_status == ExtractionStatus.succeeded)
                    )
                    | (ProjectFile.file_type == FileType.pdf)
                ),
            )
        )
    ) or 0


async def _check_fulfillment(
    session: AsyncSession,
    project_id: UUID,
    source_kind: str,
    source_value: str,
) -> tuple[bool, int]:
    """Check whether a single dossier requirement is fulfilled.

    Returns (fulfilled, count) where count is the number of matching items.
    """
    if source_kind == "attachment_slot":
        count = await _count_ready_attachments_in_slot(session, project_id, source_value)
        return count > 0, count

    if source_kind == "certificate_type":
        count = (
            await session.scalar(
                select(func.count()).select_from(
                    select(Certificate.id)
                    .where(
                        Certificate.project_id == project_id,
                        Certificate.certificate_type == source_value,
                        Certificate.status == CertificateStatus.ready,
                        Certificate.deleted_at.is_(None),
                    )
                    .subquery()
                )
            )
        ) or 0
        return count > 0, count

    if source_kind == "derived":
        if source_value == "findings":
            open_count = (
                await session.scalar(
                    select(func.count()).select_from(
                        select(Finding.id)
                        .where(
                            Finding.project_id == project_id,
                            Finding.status.in_([FindingStatus.open, FindingStatus.in_progress]),
                            Finding.deleted_at.is_(None),
                        )
                        .subquery()
                    )
                )
            ) or 0
            return open_count == 0, open_count

        if source_value == "deadlines":
            today = datetime.now(_AMS).date()
            overdue_count = (
                await session.scalar(
                    select(func.count()).select_from(
                        select(Deadline.id)
                        .where(
                            Deadline.project_id == project_id,
                            Deadline.status == DeadlineStatus.pending,
                            Deadline.due_date < today,
                        )
                        .subquery()
                    )
                )
            ) or 0
            return overdue_count == 0, overdue_count

        if source_value == "documents":
            count = await _count_models(session, project_id)
            return count > 0, count

    if source_kind == "document" and source_value == "documents":
        # Drawings: a viewable/processed model (ready+extracted IFC or ready
        # PDF). Documents still processing — or without a file — don't count.
        count = await _count_viewable_models(session, project_id)
        return count > 0, count

    return False, 0


# ---------------------------------------------------------------------------
# Project-wide composite
# ---------------------------------------------------------------------------


async def _dossier_block(session: AsyncSession, project: Project) -> DossierBlock:
    bt = project.building_type.value if project.building_type else None
    reqs = get_dossier_requirements(project.country, bt)

    items: list[ReadinessItem] = []
    for req in reqs:
        fulfilled, count = await _check_fulfillment(
            session, project.id, req.source_kind, req.source_value
        )
        items.append(
            ReadinessItem(
                code=req.code,
                label=pick_label(req.label, "en", "nl"),
                category=req.category,
                required=req.required,
                fulfilled=fulfilled,
                count=count,
            )
        )

    # Per-category groups count every item (required + optional), first-seen
    # order — mirrors `dossierTemplate.ts` groups.
    seg_order: list[str] = []
    seg_filled: dict[str, int] = {}
    seg_total: dict[str, int] = {}
    for it in items:
        if it.category not in seg_total:
            seg_order.append(it.category)
            seg_filled[it.category] = 0
            seg_total[it.category] = 0
        seg_total[it.category] += 1
        if it.fulfilled:
            seg_filled[it.category] += 1
    segments = [
        CompletenessSegment(category=c, filled=seg_filled[c], total=seg_total[c]) for c in seg_order
    ]

    required = [it for it in items if it.required]
    filled = sum(1 for it in required if it.fulfilled)
    total = len(required)
    pct = round(100 * filled / total) if total else 100
    optional = [it for it in items if not it.required]

    return DossierBlock(
        filled=filled,
        total=total,
        pct=pct,
        optional_filled=sum(1 for it in optional if it.fulfilled),
        optional_total=len(optional),
        segments=segments,
        items=items,
    )


async def _findings_ring(session: AsyncSession, project_id: UUID) -> FindingsRingBlock:
    by_status: dict[str, int] = {s.value: 0 for s in FindingStatus}
    rows = await session.execute(
        select(Finding.status, func.count())
        .where(Finding.project_id == project_id, Finding.deleted_at.is_(None))
        .group_by(Finding.status)
    )
    for status_value, n in rows.all():
        by_status[status_value.value] = int(n)
    total = sum(by_status.values())
    complete = by_status[FindingStatus.resolved.value] + by_status[FindingStatus.verified.value]
    return FindingsRingBlock(total=total, complete=complete, by_status=by_status)


async def _deadlines_ring(session: AsyncSession, project_id: UUID) -> DeadlinesRingBlock:
    today = datetime.now(_AMS).date()
    rows = await session.execute(
        select(Deadline.status, Deadline.due_date).where(Deadline.project_id == project_id)
    )
    met = pending = overdue = total = 0
    for status_value, due_date in rows.all():
        if status_value == DeadlineStatus.not_applicable:
            continue
        total += 1
        if status_value == DeadlineStatus.met:
            met += 1
        elif due_date is not None and due_date < today:
            overdue += 1
        else:
            pending += 1
    return DeadlinesRingBlock(total=total, met=met, pending=pending, overdue=overdue)


async def compute_project_completeness(
    session: AsyncSession, project: Project
) -> CompletenessBlock:
    """The full project-completeness donut for the dashboard.

    Runs every sub-query inside the caller's tenant session/transaction — no
    commit. Composes the Dossier, Findings, and Deadlines wedges and the
    aggregate exactly as the portal donut does today, so the dashboard can drop
    the client-side `useDossierCompleteness` math (and its extra
    documents-with-versions + jurisdiction fetches).
    """
    dossier = await _dossier_block(session, project)
    findings = await _findings_ring(session, project.id)
    deadlines = await _deadlines_ring(session, project.id)

    overall_filled = dossier.filled + findings.complete + deadlines.met
    overall_total = dossier.total + findings.total + deadlines.total
    overall_pct = round(100 * overall_filled / overall_total) if overall_total else 0

    return CompletenessBlock(
        overall_filled=overall_filled,
        overall_total=overall_total,
        overall_pct=overall_pct,
        dossier=dossier,
        findings=findings,
        deadlines=deadlines,
    )
