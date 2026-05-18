"""Borgingsplan + Borgingsmomenten + ChecklistItem CRUD.

Wkb MVP backlog #15 + #16 + #17. A Borgingsplan is a versioned, project-scoped
plan containing ordered moments per construction phase, each owning a checklist.

Lifecycle (status): draft → published → superseded. The partial unique index
`ux_borgingsplans_one_active` enforces at most one row in `draft`/`published`
per project; older versions persist as `superseded` rows (legal audit trail).

Edit semantics: drafts are freely mutable; published plans are read-only.
`POST .../new-version` clones a published plan into a new draft and marks the
source `superseded`. No surprise auto-cloning on PATCH.

Generation: `POST .../generate` populates a draft from the jurisdiction's
borgingsmoment templates AND appends per-risk "Beheersmaatregel" items keyed
by RiskCategory → phases mapping in the jurisdiction registry.

RLS scopes through projects.organization_id via the denormalized `project_id`
column on borgingsmomenten + checklist_items. Audit log (backlog #36) is TODO.
"""

from datetime import UTC, date, datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from bimstitch_api.auth.fastapi_users import current_verified_user
from bimstitch_api.jurisdictions import pick_label
from bimstitch_api.jurisdictions import require as require_jurisdiction
from bimstitch_api.models.borgingsmoment import Borgingsmoment, BorgingsmomentPhase
from bimstitch_api.models.borgingsplan import Borgingsplan, BorgingsplanStatus
from bimstitch_api.models.checklist_item import ChecklistItem, ChecklistItemType, EvidenceType
from bimstitch_api.models.project import Project
from bimstitch_api.models.project_member import ProjectRole
from bimstitch_api.models.risk import Risk
from bimstitch_api.models.user import User
from bimstitch_api.routers.projects import (
    _load_project_or_404,
    _require_membership,
    _require_project_writable,
    _require_role,
)
from bimstitch_api.schemas.borgingsplan import (
    BorgingsmomentCreate,
    BorgingsmomentRead,
    BorgingsmomentUpdate,
    BorgingsplanRead,
    BorgingsplanUpdate,
    BorgingsplanVersionSummary,
    ChecklistItemCreate,
    ChecklistItemRead,
    ChecklistItemReorderRequest,
    ChecklistItemUpdate,
    GenerateOptions,
    MomentReorderRequest,
)
from bimstitch_api.tenancy import get_tenant_session

plan_router = APIRouter(tags=["borgingsplan"])
moment_router = APIRouter(tags=["borgingsplan"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


_PLAN_EAGER_OPTS = (
    selectinload(Borgingsplan.moments).selectinload(Borgingsmoment.checklist_items),
)


async def _load_active_plan_or_404(
    session: AsyncSession, project_id: UUID
) -> Borgingsplan:
    plan = (
        await session.execute(
            select(Borgingsplan)
            .options(*_PLAN_EAGER_OPTS)
            .where(
                Borgingsplan.project_id == project_id,
                Borgingsplan.status.in_(
                    (BorgingsplanStatus.draft, BorgingsplanStatus.published)
                ),
            )
            .order_by(Borgingsplan.version_number.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if plan is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="NO_ACTIVE_PLAN"
        )
    return plan


async def _reload_plan_with_children(
    session: AsyncSession, plan_id: UUID
) -> Borgingsplan:
    """Fetches a plan with its moments + nested checklist items eagerly loaded.

    Used as the last step of mutations so the response serializer never
    triggers a lazy load outside the async session (which raises
    MissingGreenlet under Pydantic v2's sync attribute walk).
    """
    return (
        await session.execute(
            select(Borgingsplan)
            .options(*_PLAN_EAGER_OPTS)
            .where(Borgingsplan.id == plan_id)
        )
    ).scalar_one()


async def _reload_moment_with_items(
    session: AsyncSession, moment_id: UUID
) -> Borgingsmoment:
    return (
        await session.execute(
            select(Borgingsmoment)
            .options(selectinload(Borgingsmoment.checklist_items))
            .where(Borgingsmoment.id == moment_id)
        )
    ).scalar_one()


async def _load_plan_in_project_or_404(
    session: AsyncSession, project_id: UUID, plan_id: UUID
) -> Borgingsplan:
    plan = (
        await session.execute(
            select(Borgingsplan)
            .options(*_PLAN_EAGER_OPTS)
            .where(
                Borgingsplan.id == plan_id, Borgingsplan.project_id == project_id
            )
        )
    ).scalar_one_or_none()
    if plan is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="BORGINGSPLAN_NOT_FOUND"
        )
    return plan


def _require_plan_draft(plan: Borgingsplan) -> None:
    if plan.status is not BorgingsplanStatus.draft:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="PLAN_NOT_EDITABLE"
        )


async def _next_version_number(session: AsyncSession, project_id: UUID) -> int:
    max_version = (
        await session.execute(
            select(func.coalesce(func.max(Borgingsplan.version_number), 0)).where(
                Borgingsplan.project_id == project_id
            )
        )
    ).scalar_one()
    return int(max_version) + 1


async def _load_moment_by_id_or_404(
    session: AsyncSession, moment_id: UUID
) -> Borgingsmoment:
    moment = (
        await session.execute(
            select(Borgingsmoment).where(Borgingsmoment.id == moment_id)
        )
    ).scalar_one_or_none()
    if moment is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="BORGINGSMOMENT_NOT_FOUND"
        )
    return moment


async def _load_moment_in_plan_or_404(
    session: AsyncSession, plan_id: UUID, moment_id: UUID
) -> Borgingsmoment:
    moment = (
        await session.execute(
            select(Borgingsmoment).where(
                Borgingsmoment.id == moment_id, Borgingsmoment.borgingsplan_id == plan_id
            )
        )
    ).scalar_one_or_none()
    if moment is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="BORGINGSMOMENT_NOT_FOUND"
        )
    return moment


async def _load_item_in_moment_or_404(
    session: AsyncSession, moment_id: UUID, item_id: UUID
) -> ChecklistItem:
    item = (
        await session.execute(
            select(ChecklistItem).where(
                ChecklistItem.id == item_id,
                ChecklistItem.borgingsmoment_id == moment_id,
            )
        )
    ).scalar_one_or_none()
    if item is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="CHECKLIST_ITEM_NOT_FOUND"
        )
    return item


async def _walk_to_project_via_moment(
    session: AsyncSession, moment: Borgingsmoment
) -> tuple[Project, Borgingsplan]:
    plan = (
        await session.execute(
            select(Borgingsplan).where(Borgingsplan.id == moment.borgingsplan_id)
        )
    ).scalar_one_or_none()
    if plan is None:
        # Shouldn't happen — orphan moments are blocked by FK CASCADE.
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="BORGINGSPLAN_NOT_FOUND"
        )
    project = await _load_project_or_404(session, plan.project_id)
    return project, plan


async def _walk_to_project_via_plan(
    session: AsyncSession, plan: Borgingsplan
) -> Project:
    return await _load_project_or_404(session, plan.project_id)


async def _project_risks(
    session: AsyncSession, project_id: UUID
) -> list[Risk]:
    result = await session.execute(
        select(Risk).where(Risk.project_id == project_id).order_by(Risk.created_at)
    )
    return list(result.scalars().all())


async def _build_plan_from_templates(
    session: AsyncSession,
    project: Project,
    creator_id: UUID,
    version_number: int,
) -> Borgingsplan:
    """Builds a draft Borgingsplan with templated moments + risk-derived items.

    Reads the jurisdiction registry for moment templates and risk→phase
    mapping; reads the project's existing risks and appends a
    'Beheersmaatregel' item to every moment whose phase ∈ category mapping.
    """
    jurisdiction = require_jurisdiction(project.country)
    risks = await _project_risks(session, project.id)
    risk_to_phases = jurisdiction.risk_category_to_phases
    # Template strings are LocaleMaps; seed each new row in the country's
    # default locale so existing portals (which today display NL projects in
    # Dutch by default) keep their behavior. Re-generating from a different
    # locale will be a separate ?locale= toggle on the generate endpoint.
    locale = jurisdiction.default_locale

    base_date = project.planned_start_date or date.today()

    plan = Borgingsplan(
        project_id=project.id,
        version_number=version_number,
        status=BorgingsplanStatus.draft,
        created_by_user_id=creator_id,
    )
    session.add(plan)
    await session.flush()

    # Group templates by phase, preserving registry order, so sequence_in_phase
    # follows the registry's ordering of templates.
    per_phase_seq: dict[str, int] = {}
    for mt in jurisdiction.borgingsmoment_templates:
        phase_str = mt.phase
        seq = per_phase_seq.get(phase_str, 0)
        per_phase_seq[phase_str] = seq + 1

        moment = Borgingsmoment(
            borgingsplan_id=plan.id,
            project_id=project.id,
            phase=BorgingsmomentPhase(phase_str),
            name=pick_label(mt.name, locale, locale),
            planned_date=base_date.fromordinal(
                base_date.toordinal() + mt.default_offset_days
            ),
            sequence_in_phase=seq,
        )
        session.add(moment)
        await session.flush()

        item_seq = 0
        for it in mt.checklist:
            session.add(
                ChecklistItem(
                    borgingsmoment_id=moment.id,
                    project_id=project.id,
                    item_type=ChecklistItemType.text,
                    description=pick_label(it.description, locale, locale),
                    evidence_type=EvidenceType(it.evidence_type),
                    bbl_article_ref=it.bbl_article_ref,
                    pass_fail_criteria=(
                        pick_label(it.pass_fail_criteria, locale, locale)
                        if it.pass_fail_criteria is not None
                        else None
                    ),
                    sequence=item_seq,
                )
            )
            item_seq += 1

        # Append risk-derived items if this phase is mapped from any risk.
        for risk in risks:
            phases = risk_to_phases.get(risk.category.value, ())
            if phase_str not in phases:
                continue
            session.add(
                ChecklistItem(
                    borgingsmoment_id=moment.id,
                    project_id=project.id,
                    item_type=ChecklistItemType.text,
                    description=f"Beheersmaatregel: {risk.mitigation}",
                    evidence_type=EvidenceType.document,
                    bbl_article_ref=risk.bbl_article_ref,
                    pass_fail_criteria=None,
                    sequence=item_seq,
                )
            )
            item_seq += 1

    await session.flush()
    return await _reload_plan_with_children(session, plan.id)


async def _delete_active_draft_if_present(
    session: AsyncSession, project_id: UUID
) -> None:
    existing = (
        await session.execute(
            select(Borgingsplan).where(
                Borgingsplan.project_id == project_id,
                Borgingsplan.status == BorgingsplanStatus.draft,
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        await session.delete(existing)
        await session.flush()


async def _clone_plan(
    session: AsyncSession,
    source: Borgingsplan,
    creator_id: UUID,
    version_number: int,
) -> Borgingsplan:
    new_plan = Borgingsplan(
        project_id=source.project_id,
        version_number=version_number,
        status=BorgingsplanStatus.draft,
        created_by_user_id=creator_id,
        notes=source.notes,
    )
    session.add(new_plan)
    await session.flush()

    # Reload source moments + items eagerly (selectin) to avoid lazy traps.
    source_moments = (
        await session.execute(
            select(Borgingsmoment)
            .where(Borgingsmoment.borgingsplan_id == source.id)
            .order_by(Borgingsmoment.phase, Borgingsmoment.sequence_in_phase)
        )
    ).scalars().all()

    for sm in source_moments:
        new_moment = Borgingsmoment(
            borgingsplan_id=new_plan.id,
            project_id=new_plan.project_id,
            phase=sm.phase,
            name=sm.name,
            planned_date=sm.planned_date,
            actual_date=sm.actual_date,
            responsible_user_id=sm.responsible_user_id,
            status=sm.status,
            sequence_in_phase=sm.sequence_in_phase,
            notes=sm.notes,
        )
        session.add(new_moment)
        await session.flush()

        source_items = (
            await session.execute(
                select(ChecklistItem)
                .where(ChecklistItem.borgingsmoment_id == sm.id)
                .order_by(ChecklistItem.sequence)
            )
        ).scalars().all()
        for si in source_items:
            session.add(
                ChecklistItem(
                    borgingsmoment_id=new_moment.id,
                    project_id=new_plan.project_id,
                    item_type=si.item_type,
                    description=si.description,
                    evidence_type=si.evidence_type,
                    bbl_article_ref=si.bbl_article_ref,
                    pass_fail_criteria=si.pass_fail_criteria,
                    sequence=si.sequence,
                    linked_element_global_id=si.linked_element_global_id,
                    linked_file_id=si.linked_file_id,
                    extra_data=si.extra_data,
                )
            )
    await session.flush()
    return await _reload_plan_with_children(session, new_plan.id)


# ---------------------------------------------------------------------------
# Plan-level endpoints
# ---------------------------------------------------------------------------


@plan_router.get(
    "/projects/{project_id}/borgingsplan", response_model=BorgingsplanRead
)
async def get_active_borgingsplan(
    project_id: UUID,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
) -> Borgingsplan:
    project = await _load_project_or_404(session, project_id)
    await _require_membership(session, project.id, user.id)
    return await _load_active_plan_or_404(session, project.id)


@plan_router.get(
    "/projects/{project_id}/borgingsplan/versions",
    response_model=list[BorgingsplanVersionSummary],
)
async def list_borgingsplan_versions(
    project_id: UUID,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
) -> list[Borgingsplan]:
    project = await _load_project_or_404(session, project_id)
    await _require_membership(session, project.id, user.id)
    result = await session.execute(
        select(Borgingsplan)
        .where(Borgingsplan.project_id == project.id)
        .order_by(Borgingsplan.version_number.desc())
    )
    return list(result.scalars().all())


@plan_router.post(
    "/projects/{project_id}/borgingsplan/generate",
    response_model=BorgingsplanRead,
    status_code=status.HTTP_201_CREATED,
)
async def generate_borgingsplan(
    project_id: UUID,
    payload: GenerateOptions | None = None,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
) -> Borgingsplan:
    project = await _load_project_or_404(session, project_id)
    membership = await _require_membership(session, project.id, user.id)
    _require_role(membership, ProjectRole.owner, ProjectRole.editor)
    _require_project_writable(project)
    opts = payload or GenerateOptions()

    # Resolve existing active plan, if any.
    existing = (
        await session.execute(
            select(Borgingsplan)
            .where(
                Borgingsplan.project_id == project.id,
                Borgingsplan.status.in_(
                    (BorgingsplanStatus.draft, BorgingsplanStatus.published)
                ),
            )
            .order_by(Borgingsplan.version_number.desc())
            .limit(1)
        )
    ).scalar_one_or_none()

    if existing is not None and existing.status is BorgingsplanStatus.published:
        if not opts.force:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="PUBLISHED_PLAN_EXISTS",
            )
        existing.status = BorgingsplanStatus.superseded
        existing.superseded_at = datetime.now(UTC)
        await session.flush()
    elif existing is not None and existing.status is BorgingsplanStatus.draft:
        await session.delete(existing)
        await session.flush()

    # TODO(#36): emit audit_log entry once the table lands.
    next_version = await _next_version_number(session, project.id)
    try:
        plan = await _build_plan_from_templates(session, project, user.id, next_version)
    except IntegrityError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="PLAN_GENERATION_RACE"
        ) from exc
    return plan


@plan_router.patch(
    "/projects/{project_id}/borgingsplan", response_model=BorgingsplanRead
)
async def update_borgingsplan(
    project_id: UUID,
    payload: BorgingsplanUpdate,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
) -> Borgingsplan:
    project = await _load_project_or_404(session, project_id)
    membership = await _require_membership(session, project.id, user.id)
    _require_role(membership, ProjectRole.owner, ProjectRole.editor)
    _require_project_writable(project)

    plan = await _load_active_plan_or_404(session, project.id)
    _require_plan_draft(plan)
    updates = payload.model_dump(exclude_unset=True)
    # TODO(#36): emit audit_log entry once the table lands.
    for field, value in updates.items():
        setattr(plan, field, value)
    await session.flush()
    return await _reload_plan_with_children(session, plan.id)


@plan_router.post(
    "/projects/{project_id}/borgingsplan/publish", response_model=BorgingsplanRead
)
async def publish_borgingsplan(
    project_id: UUID,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
) -> Borgingsplan:
    project = await _load_project_or_404(session, project_id)
    membership = await _require_membership(session, project.id, user.id)
    _require_role(membership, ProjectRole.owner)
    _require_project_writable(project)

    plan = await _load_active_plan_or_404(session, project.id)
    if plan.status is not BorgingsplanStatus.draft:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="PLAN_ALREADY_PUBLISHED"
        )

    # TODO(#36): emit audit_log entry once the table lands.
    plan.status = BorgingsplanStatus.published
    plan.published_at = datetime.now(UTC)
    await session.flush()
    return await _reload_plan_with_children(session, plan.id)


@plan_router.post(
    "/projects/{project_id}/borgingsplan/new-version",
    response_model=BorgingsplanRead,
    status_code=status.HTTP_201_CREATED,
)
async def new_borgingsplan_version(
    project_id: UUID,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
) -> Borgingsplan:
    project = await _load_project_or_404(session, project_id)
    membership = await _require_membership(session, project.id, user.id)
    _require_role(membership, ProjectRole.owner, ProjectRole.editor)
    _require_project_writable(project)

    source = await _load_active_plan_or_404(session, project.id)
    if source.status is not BorgingsplanStatus.published:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="PLAN_NOT_PUBLISHED"
        )

    # TODO(#36): emit audit_log entry once the table lands.
    source.status = BorgingsplanStatus.superseded
    source.superseded_at = datetime.now(UTC)
    await session.flush()
    next_version = await _next_version_number(session, project.id)
    try:
        new_plan = await _clone_plan(session, source, user.id, next_version)
    except IntegrityError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="PLAN_GENERATION_RACE"
        ) from exc
    return new_plan


@plan_router.post(
    "/projects/{project_id}/borgingsplan/{plan_id}/reset",
    response_model=BorgingsplanRead,
)
async def reset_borgingsplan_to_template(
    project_id: UUID,
    plan_id: UUID,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
) -> Borgingsplan:
    project = await _load_project_or_404(session, project_id)
    membership = await _require_membership(session, project.id, user.id)
    _require_role(membership, ProjectRole.owner, ProjectRole.editor)
    _require_project_writable(project)

    plan = await _load_plan_in_project_or_404(session, project.id, plan_id)
    _require_plan_draft(plan)

    # In-place regeneration: keep the version_number, replace contents.
    version_number = plan.version_number
    # TODO(#36): emit audit_log entry once the table lands.
    await session.delete(plan)
    await session.flush()
    try:
        new_plan = await _build_plan_from_templates(
            session, project, user.id, version_number
        )
    except IntegrityError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="PLAN_GENERATION_RACE"
        ) from exc
    return new_plan


# ---------------------------------------------------------------------------
# Moment-level endpoints
# ---------------------------------------------------------------------------


@moment_router.post(
    "/borgingsplans/{plan_id}/moments",
    response_model=BorgingsmomentRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_moment(
    plan_id: UUID,
    payload: BorgingsmomentCreate,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
) -> Borgingsmoment:
    plan = (
        await session.execute(select(Borgingsplan).where(Borgingsplan.id == plan_id))
    ).scalar_one_or_none()
    if plan is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="BORGINGSPLAN_NOT_FOUND"
        )
    project = await _walk_to_project_via_plan(session, plan)
    membership = await _require_membership(session, project.id, user.id)
    _require_role(membership, ProjectRole.owner, ProjectRole.editor)
    _require_project_writable(project)
    _require_plan_draft(plan)

    seq = payload.sequence_in_phase
    if seq is None:
        max_seq = (
            await session.execute(
                select(func.coalesce(func.max(Borgingsmoment.sequence_in_phase), -1))
                .where(
                    Borgingsmoment.borgingsplan_id == plan.id,
                    Borgingsmoment.phase == payload.phase,
                )
            )
        ).scalar_one()
        seq = int(max_seq) + 1

    data = payload.model_dump(exclude={"sequence_in_phase"})
    # TODO(#36): emit audit_log entry once the table lands.
    moment = Borgingsmoment(
        borgingsplan_id=plan.id,
        project_id=project.id,
        sequence_in_phase=seq,
        **data,
    )
    session.add(moment)
    await session.flush()
    return await _reload_moment_with_items(session, moment.id)


@moment_router.patch(
    "/borgingsplans/{plan_id}/moments/{moment_id}", response_model=BorgingsmomentRead
)
async def update_moment(
    plan_id: UUID,
    moment_id: UUID,
    payload: BorgingsmomentUpdate,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
) -> Borgingsmoment:
    moment = await _load_moment_in_plan_or_404(session, plan_id, moment_id)
    project, plan = await _walk_to_project_via_moment(session, moment)
    membership = await _require_membership(session, project.id, user.id)
    _require_role(membership, ProjectRole.owner, ProjectRole.editor)
    _require_project_writable(project)
    _require_plan_draft(plan)

    updates = payload.model_dump(exclude_unset=True)
    # TODO(#36): emit audit_log entry once the table lands.
    for field, value in updates.items():
        setattr(moment, field, value)
    await session.flush()
    return await _reload_moment_with_items(session, moment.id)


@moment_router.delete(
    "/borgingsplans/{plan_id}/moments/{moment_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_moment(
    plan_id: UUID,
    moment_id: UUID,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
) -> Response:
    moment = await _load_moment_in_plan_or_404(session, plan_id, moment_id)
    project, plan = await _walk_to_project_via_moment(session, moment)
    membership = await _require_membership(session, project.id, user.id)
    _require_role(membership, ProjectRole.owner, ProjectRole.editor)
    _require_project_writable(project)
    _require_plan_draft(plan)

    # TODO(#36): emit audit_log entry once the table lands.
    await session.delete(moment)
    await session.flush()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@moment_router.post(
    "/borgingsplans/{plan_id}/moments/reorder",
    response_model=list[BorgingsmomentRead],
)
async def reorder_moments(
    plan_id: UUID,
    payload: MomentReorderRequest,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
) -> list[Borgingsmoment]:
    plan = (
        await session.execute(select(Borgingsplan).where(Borgingsplan.id == plan_id))
    ).scalar_one_or_none()
    if plan is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="BORGINGSPLAN_NOT_FOUND"
        )
    project = await _walk_to_project_via_plan(session, plan)
    membership = await _require_membership(session, project.id, user.id)
    _require_role(membership, ProjectRole.owner, ProjectRole.editor)
    _require_project_writable(project)
    _require_plan_draft(plan)

    existing = (
        await session.execute(
            select(Borgingsmoment).where(
                Borgingsmoment.borgingsplan_id == plan.id,
                Borgingsmoment.phase == payload.phase,
            )
        )
    ).scalars().all()
    by_id = {m.id: m for m in existing}

    if set(by_id.keys()) != set(payload.moment_ids) or len(payload.moment_ids) != len(
        by_id
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="REORDER_MOMENT_IDS_MISMATCH",
        )

    # TODO(#36): emit audit_log entry once the table lands.
    for index, mid in enumerate(payload.moment_ids):
        by_id[mid].sequence_in_phase = index
    await session.flush()

    refreshed = (
        await session.execute(
            select(Borgingsmoment)
            .options(selectinload(Borgingsmoment.checklist_items))
            .where(
                Borgingsmoment.borgingsplan_id == plan.id,
                Borgingsmoment.phase == payload.phase,
            )
            .order_by(Borgingsmoment.sequence_in_phase)
        )
    ).scalars().all()
    return list(refreshed)


# ---------------------------------------------------------------------------
# Checklist-item endpoints
# ---------------------------------------------------------------------------


@moment_router.post(
    "/borgingsmomenten/{moment_id}/checklist-items",
    response_model=ChecklistItemRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_checklist_item(
    moment_id: UUID,
    payload: ChecklistItemCreate,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
) -> ChecklistItem:
    moment = await _load_moment_by_id_or_404(session, moment_id)
    project, plan = await _walk_to_project_via_moment(session, moment)
    membership = await _require_membership(session, project.id, user.id)
    _require_role(membership, ProjectRole.owner, ProjectRole.editor)
    _require_project_writable(project)
    _require_plan_draft(plan)

    seq = payload.sequence
    if seq is None:
        max_seq = (
            await session.execute(
                select(func.coalesce(func.max(ChecklistItem.sequence), -1)).where(
                    ChecklistItem.borgingsmoment_id == moment.id
                )
            )
        ).scalar_one()
        seq = int(max_seq) + 1

    data = payload.model_dump(exclude={"sequence"})
    # TODO(#36): emit audit_log entry once the table lands.
    item = ChecklistItem(
        borgingsmoment_id=moment.id,
        project_id=project.id,
        sequence=seq,
        **data,
    )
    session.add(item)
    await session.flush()
    await session.refresh(item)
    return item


@moment_router.patch(
    "/borgingsmomenten/{moment_id}/checklist-items/{item_id}",
    response_model=ChecklistItemRead,
)
async def update_checklist_item(
    moment_id: UUID,
    item_id: UUID,
    payload: ChecklistItemUpdate,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
) -> ChecklistItem:
    moment = await _load_moment_by_id_or_404(session, moment_id)
    project, plan = await _walk_to_project_via_moment(session, moment)
    membership = await _require_membership(session, project.id, user.id)
    _require_role(membership, ProjectRole.owner, ProjectRole.editor)
    _require_project_writable(project)
    _require_plan_draft(plan)

    item = await _load_item_in_moment_or_404(session, moment.id, item_id)
    updates = payload.model_dump(exclude_unset=True)
    # TODO(#36): emit audit_log entry once the table lands.
    for field, value in updates.items():
        setattr(item, field, value)
    await session.flush()
    await session.refresh(item)
    return item


@moment_router.delete(
    "/borgingsmomenten/{moment_id}/checklist-items/{item_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_checklist_item(
    moment_id: UUID,
    item_id: UUID,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
) -> Response:
    moment = await _load_moment_by_id_or_404(session, moment_id)
    project, plan = await _walk_to_project_via_moment(session, moment)
    membership = await _require_membership(session, project.id, user.id)
    _require_role(membership, ProjectRole.owner, ProjectRole.editor)
    _require_project_writable(project)
    _require_plan_draft(plan)

    item = await _load_item_in_moment_or_404(session, moment.id, item_id)
    # TODO(#36): emit audit_log entry once the table lands.
    await session.delete(item)
    await session.flush()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@moment_router.post(
    "/borgingsmomenten/{moment_id}/checklist-items/reorder",
    response_model=list[ChecklistItemRead],
)
async def reorder_checklist_items(
    moment_id: UUID,
    payload: ChecklistItemReorderRequest,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
) -> list[ChecklistItem]:
    moment = await _load_moment_by_id_or_404(session, moment_id)
    project, plan = await _walk_to_project_via_moment(session, moment)
    membership = await _require_membership(session, project.id, user.id)
    _require_role(membership, ProjectRole.owner, ProjectRole.editor)
    _require_project_writable(project)
    _require_plan_draft(plan)

    existing = (
        await session.execute(
            select(ChecklistItem).where(
                ChecklistItem.borgingsmoment_id == moment.id
            )
        )
    ).scalars().all()
    by_id = {it.id: it for it in existing}

    if set(by_id.keys()) != set(payload.item_ids) or len(payload.item_ids) != len(
        by_id
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="REORDER_ITEM_IDS_MISMATCH",
        )

    # TODO(#36): emit audit_log entry once the table lands.
    for index, iid in enumerate(payload.item_ids):
        by_id[iid].sequence = index
    await session.flush()

    refreshed = (
        await session.execute(
            select(ChecklistItem)
            .where(ChecklistItem.borgingsmoment_id == moment.id)
            .order_by(ChecklistItem.sequence)
        )
    ).scalars().all()
    return list(refreshed)
