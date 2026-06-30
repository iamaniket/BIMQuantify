"""Free-tier project surface — pooled `public.free_projects` + project-scoped views.

The free wedge lets an org-less user group their pooled `free_documents` under a
pooled `free_projects` row (still owner-keyed RLS, never an `org_<hex>` schema).
The portal renders free projects through the SAME paid components, so every
endpoint here returns the IDENTICAL paid response schema:

  POST   /free/projects                 → ProjectRead   (reuses ProjectCreate body)
  GET    /free/projects                 → list[ProjectRead]
  GET    /free/projects/{id}            → ProjectRead
  PATCH  /free/projects/{id}            → ProjectRead   (ProjectUpdate body)
  DELETE /free/projects/{id}            → 204           (cascades containers/files/findings)
  GET    /free/projects/{id}/findings      → list[FindingRead]           (board feed)

The container + file CRUD (`/free/projects/{id}/documents…`) lives in
`free_documents.py`; the `/findings` + `/overview` views here read those tables.
  GET    /free/projects/{id}/overview   → ProjectOverviewRead         (findings-only completeness)

Org-only overview blocks (dossier / deadlines / certificates / attachments /
reports) are returned zeroed so the existing Zod schemas validate unchanged; the
portal hides those sections behind a capability flag. Flag-gated like the rest of
`/free/*` (FREE_TIER_DISABLED when off).
"""

import contextlib
import csv
import io
import secrets
from datetime import datetime
from typing import Annotated
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

from fastapi import (
    APIRouter,
    Depends,
    File,
    HTTPException,
    Request,
    Response,
    UploadFile,
    status,
)
from pydantic import BaseModel, EmailStr
from sqlalchemy import func, select
from sqlalchemy import text as sql_text
from sqlalchemy.ext.asyncio import AsyncSession

from bimdossier_api.auth.fastapi_users import current_verified_user
from bimdossier_api.auth.manager import UserManager, get_user_manager
from bimdossier_api.auth.ratelimit import INVITE_LIMITER
from bimdossier_api.background.locks import lock_id_for
from bimdossier_api.config import Settings, get_settings
from bimdossier_api.db import get_async_session
from bimdossier_api.deadlines.completeness import (
    CompletenessBlock,
    DeadlinesRingBlock,
    DossierBlock,
    FindingsRingBlock,
)
from bimdossier_api.free_limits import resolve_free_limits
from bimdossier_api.i18n import coerce_locale
from bimdossier_api.models.finding import FindingStatus
from bimdossier_api.models.free_document import FreeDocument
from bimdossier_api.models.free_finding import FreeFinding
from bimdossier_api.models.free_project import FreeProject
from bimdossier_api.models.free_project_member import FreeProjectMember
from bimdossier_api.models.project_member import ProjectRole
from bimdossier_api.models.user import User
from bimdossier_api.routers.finding import (
    _FINDINGS_CSV_COLUMNS,
    _XLSX_MEDIA_TYPE,
    _csv_row_dict,
)
from bimdossier_api.routers.free_access import (
    assert_can_create_free_content,
    assert_free_account_not_expired,
    count_free_members,
    require_free_tier_enabled,
    resolve_free_role,
)
from bimdossier_api.routers.projects._shared import _validate_country
from bimdossier_api.schemas.finding import FindingExport, FindingRead
from bimdossier_api.schemas.project import (
    ProjectCreate,
    ProjectMemberRead,
    ProjectRead,
    ProjectUpdate,
)
from bimdossier_api.schemas.project_overview import (
    AttachmentsBlock,
    CertificatesBlock,
    DeadlinesBlock,
    FindingsBlock,
    OverviewStats,
    ProjectOverviewRead,
    ReportsBlock,
)
from bimdossier_api.storage import StorageBackend, get_storage
from bimdossier_api.storage.scoping import free_key_prefix
from bimdossier_api.tenancy import get_free_session, open_free_session

router = APIRouter(
    prefix="/free",
    tags=["free-viewer"],
    dependencies=[Depends(require_free_tier_enabled)],
)

# How many snags each overview findings-preview card serves (mirrors the paid
# OVERVIEW_PREVIEW_LIMIT).
_OVERVIEW_PREVIEW_LIMIT = 8
_AMS = ZoneInfo("Europe/Amsterdam")


# ---------------------------------------------------------------------------
# Project CRUD
# ---------------------------------------------------------------------------


@router.post("/projects", response_model=ProjectRead, status_code=status.HTTP_201_CREATED)
async def create_free_project(
    payload: ProjectCreate,
    user: User = Depends(current_verified_user),
    session: AsyncSession = Depends(get_free_session),
    storage: StorageBackend = Depends(get_storage),
) -> ProjectRead:
    # Create-gate: only org-less users whose trial is still open may create free
    # content. A paid user may be a member of a free project but never create one.
    # Returns the user's effective caps (override ?? env default).
    limits = await assert_can_create_free_content(user)
    # Reject a country with no registered jurisdiction before persisting (mirrors
    # the paid create; an unsupported country breaks a later free→paid conversion).
    _validate_country(payload.country)
    # Serialize this user's concurrent creates so the owned-project cap can't be
    # TOCTOU-raced. Transaction-scoped (released on the free session's commit).
    await session.execute(
        sql_text("SELECT pg_advisory_xact_lock(:k)"),
        {"k": lock_id_for(f"free_project_create:{user.id}")},
    )
    count = (
        await session.scalar(
            select(func.count())
            .select_from(FreeProject)
            .where(FreeProject.owner_user_id == user.id)
        )
    ) or 0
    if count >= limits.max_projects:
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
    return await _free_project_to_read(project, ProjectRole.owner, storage)


@router.get("/projects", response_model=list[ProjectRead])
async def list_free_projects(
    user: User = Depends(current_verified_user),
    session: AsyncSession = Depends(get_free_session),
    storage: StorageBackend = Depends(get_storage),
) -> list[ProjectRead]:
    # RLS returns owned AND shared-with-me projects. Resolve the caller's role
    # per row so the portal can badge "Shared" and gate writes.
    rows = (
        (
            await session.execute(
                select(FreeProject).order_by(FreeProject.created_at.desc())
            )
        )
        .scalars()
        .all()
    )
    member_roles = {
        pid: role
        for pid, role in (
            await session.execute(
                select(
                    FreeProjectMember.free_project_id, FreeProjectMember.role
                ).where(FreeProjectMember.user_id == user.id)
            )
        ).all()
    }
    out: list[ProjectRead] = []
    for p in rows:
        if p.owner_user_id == user.id:
            role = ProjectRole.owner
        else:
            role = _role_enum(member_roles.get(p.id))
        out.append(await _free_project_to_read(p, role, storage))
    return out


@router.get("/projects/{project_id}", response_model=ProjectRead)
async def get_free_project(
    project_id: UUID,
    user: User = Depends(current_verified_user),
    session: AsyncSession = Depends(get_free_session),
    storage: StorageBackend = Depends(get_storage),
) -> ProjectRead:
    project = await _load_accessible_free_project_or_404(session, project_id)
    role = _role_enum(await resolve_free_role(session, project_id, user.id))
    return await _free_project_to_read(project, role, storage)


@router.patch("/projects/{project_id}", response_model=ProjectRead)
async def update_free_project(
    project_id: UUID,
    payload: ProjectUpdate,
    user: User = Depends(current_verified_user),
    session: AsyncSession = Depends(get_free_session),
    storage: StorageBackend = Depends(get_storage),
) -> ProjectRead:
    project = await _load_free_project_or_404(session, project_id, user.id)
    await assert_free_account_not_expired(user)
    data = payload.model_dump(exclude_unset=True)
    if "country" in data:
        _validate_country(data["country"])
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
    return await _free_project_to_read(project, storage=storage)


@router.delete("/projects/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_free_project(
    project_id: UUID,
    user: User = Depends(current_verified_user),
    storage: StorageBackend = Depends(get_storage),
) -> None:
    # Container/file/snag rows cascade (FK ON DELETE CASCADE); their storage
    # objects don't, so collect the container ids first and best-effort delete
    # each container's object prefix after the rows are gone (reaper backstops).
    async with open_free_session(user.id) as session:
        project = await _load_free_project_or_404(session, project_id, user.id)
        doc_ids = list(
            (
                await session.execute(
                    select(FreeDocument.id).where(
                        FreeDocument.free_project_id == project_id
                    )
                )
            )
            .scalars()
            .all()
        )
        await session.delete(project)
    for did in doc_ids:
        await storage.delete_prefix(f"{free_key_prefix(user.id)}{did}/")


@router.post("/projects/{project_id}/thumbnail", response_model=ProjectRead)
async def update_free_project_thumbnail(
    project_id: UUID,
    thumbnail: Annotated[UploadFile, File()],
    user: User = Depends(current_verified_user),
    session: AsyncSession = Depends(get_free_session),
    storage: StorageBackend = Depends(get_storage),
    settings: Settings = Depends(get_settings),
) -> ProjectRead:
    """Upload or replace a free project's cover image (multipart/form-data).

    Owner-only (the explicit owner load is the gate, mirroring PATCH/DELETE). The
    same validation as the paid endpoint, but the object lives under the owner's
    free key prefix (`free/<uid>/thumbnails/…`) so it stays inside the user's
    storage scope — NOT the org thumbnail prefix.
    """
    project = await _load_free_project_or_404(session, project_id, user.id)
    await assert_free_account_not_expired(user)

    allowed_types = [t.strip() for t in settings.thumbnail_allowed_content_types.split(",")]
    content_type = thumbnail.content_type or ""
    if content_type not in allowed_types:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="THUMBNAIL_UNSUPPORTED_TYPE",
        )
    data = await thumbnail.read()
    if len(data) > settings.thumbnail_max_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="THUMBNAIL_TOO_LARGE",
        )

    ext = content_type.split("/")[-1].replace("jpeg", "jpg")
    prefix = f"{free_key_prefix(user.id)}thumbnails/"
    new_key = f"{prefix}{uuid4()}.{ext}"
    await storage.put_object(new_key, content_type, data)

    # Best-effort cleanup of the previous cover (only if it was ours).
    old_key = project.thumbnail_url
    if old_key is not None and old_key.startswith(prefix):
        with contextlib.suppress(Exception):
            await storage.delete_object(old_key)

    project.thumbnail_url = new_key
    # No explicit flush (mirrors update_free_project): the change commits with the
    # free session at request end. Flushing here would expire the server-side
    # `updated_at`, and the subsequent in-memory read would lazy-load it under
    # async SQLAlchemy → MissingGreenlet.
    return await _free_project_to_read(project, storage=storage)


# ---------------------------------------------------------------------------
# Project-scoped views (paid-identical shapes)
# ---------------------------------------------------------------------------


@router.get("/projects/{project_id}/findings", response_model=list[FindingRead])
async def list_free_project_snags(
    project_id: UUID,
    user: User = Depends(current_verified_user),
    session: AsyncSession = Depends(get_free_session),
) -> list[FindingRead]:
    await _load_accessible_free_project_or_404(session, project_id)
    rows = await _load_project_snags(session, project_id)
    return [_free_finding_to_finding(s, project_id) for s in rows]


# --- Findings export (CSV / XLSX / JSON) -----------------------------------
# These run on the SUPERUSER session (like the members endpoint) so they can
# resolve assignee/creator display names past the per-user `users` RLS; access
# is validated by hand via `_assert_free_participant`. No audit row (free has no
# pooled audit_log); the data volume is tiny (capped), so no streaming cursor.


@router.get("/projects/{project_id}/findings/export.csv", response_class=Response)
async def export_free_findings_csv(
    project_id: UUID,
    user: User = Depends(current_verified_user),
    session: AsyncSession = Depends(get_async_session),
) -> Response:
    project = await _load_free_project_superuser_or_404(session, project_id)
    await _assert_free_participant(session, project, user.id)
    snags = await _load_project_snags(session, project_id)
    names = await _resolve_free_user_names(session, snags)

    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=list(_FINDINGS_CSV_COLUMNS), extrasaction="ignore")
    writer.writeheader()
    for s in snags:
        writer.writerow(_free_finding_csv_row(s, names))
    return Response(
        content=buf.getvalue().encode("utf-8"),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="findings-{project_id}.csv"'},
    )


@router.get("/projects/{project_id}/findings/export.xlsx", response_class=Response)
async def export_free_findings_xlsx(
    project_id: UUID,
    user: User = Depends(current_verified_user),
    session: AsyncSession = Depends(get_async_session),
) -> Response:
    from openpyxl import Workbook  # type: ignore[import-untyped]  # cold path

    project = await _load_free_project_superuser_or_404(session, project_id)
    await _assert_free_participant(session, project, user.id)
    snags = await _load_project_snags(session, project_id)
    names = await _resolve_free_user_names(session, snags)

    wb = Workbook(write_only=True)
    ws = wb.create_sheet("Findings")
    ws.append(list(_FINDINGS_CSV_COLUMNS))
    for s in snags:
        row = _free_finding_csv_row(s, names)
        ws.append([row[c] for c in _FINDINGS_CSV_COLUMNS])
    buf = io.BytesIO()
    wb.save(buf)
    return Response(
        content=buf.getvalue(),
        media_type=_XLSX_MEDIA_TYPE,
        headers={"Content-Disposition": f'attachment; filename="findings-{project_id}.xlsx"'},
    )


@router.get("/projects/{project_id}/findings/export.json", response_model=FindingExport)
async def export_free_findings_json(
    project_id: UUID,
    user: User = Depends(current_verified_user),
    session: AsyncSession = Depends(get_async_session),
) -> FindingExport:
    project = await _load_free_project_superuser_or_404(session, project_id)
    await _assert_free_participant(session, project, user.id)
    snags = await _load_project_snags(session, project_id)
    return FindingExport(
        project_id=project_id,
        count=len(snags),
        findings=[_free_finding_to_finding(s, project_id) for s in snags],
    )


@router.get("/projects/{project_id}/overview", response_model=ProjectOverviewRead)
async def get_free_project_overview(
    project_id: UUID,
    user: User = Depends(current_verified_user),
    session: AsyncSession = Depends(get_free_session),
    storage: StorageBackend = Depends(get_storage),
) -> ProjectOverviewRead:
    project = await _load_accessible_free_project_or_404(session, project_id)
    my_role = _role_enum(await resolve_free_role(session, project_id, user.id))
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
        _free_finding_to_finding(s, project_id)
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

    # The caller's own member row (full member list comes from GET .../members).
    caller_member = ProjectMemberRead(
        project_id=project.id,
        user_id=user.id,
        role=my_role,
        created_at=project.created_at,
        email=user.email,
        full_name=user.full_name,
    )

    return ProjectOverviewRead(
        project=await _free_project_to_read(project, my_role, storage),
        completeness=completeness,
        stats=stats,
        findings=findings_block,
        certificates=CertificatesBlock(count=0, expired=0, expiring_soon=0, preview=[]),
        attachments=AttachmentsBlock(count=0, preview=[]),
        reports=ReportsBlock(count=0, preview=[]),
        deadlines=DeadlinesBlock(total=0, met=0, overdue=0, preview=[]),
        members=[caller_member],
        activity_timeline=[],
    )


# ---------------------------------------------------------------------------
# Member management (control plane)
#
# These endpoints read/write `users` + `free_project_members`, which the free
# (bim_app) session's RLS hides — so they run on the SUPERUSER session
# (`get_async_session`, RLS-bypassing) with ownership validated by hand, exactly
# like the org-invite + signup flows. Membership NEVER creates an
# OrganizationMember, so it never consumes an org seat. Only the owner manages
# membership; the owner is always an org-less user (the create-gate guarantees
# it) and is never stored as a member row.
# ---------------------------------------------------------------------------

# Roles assignable to an invited member (owner is not assignable — there is
# exactly one owner, derived from free_projects.owner_user_id).
_FREE_ASSIGNABLE_ROLES = (ProjectRole.editor, ProjectRole.viewer)


class FreeMemberInvite(BaseModel):
    email: EmailStr
    role: ProjectRole = ProjectRole.viewer


class FreeMemberRoleUpdate(BaseModel):
    role: ProjectRole


@router.get("/projects/{project_id}/members", response_model=list[ProjectMemberRead])
async def list_free_project_members(
    project_id: UUID,
    user: User = Depends(current_verified_user),
    session: AsyncSession = Depends(get_async_session),
) -> list[ProjectMemberRead]:
    project = await _load_free_project_superuser_or_404(session, project_id)
    await _assert_free_participant(session, project, user.id)
    members: list[ProjectMemberRead] = []
    owner = await session.get(User, project.owner_user_id)
    if owner is not None:
        members.append(
            ProjectMemberRead(
                project_id=project.id,
                user_id=owner.id,
                role=ProjectRole.owner,
                created_at=project.created_at,
                email=owner.email,
                full_name=owner.full_name,
            )
        )
    rows = (
        await session.execute(
            select(FreeProjectMember, User)
            .join(User, FreeProjectMember.user_id == User.id)
            .where(FreeProjectMember.free_project_id == project_id)
            .order_by(FreeProjectMember.created_at.asc())
        )
    ).all()
    for m, u in rows:
        members.append(
            ProjectMemberRead(
                project_id=project.id,
                user_id=u.id,
                role=ProjectRole(m.role),
                created_at=m.created_at,
                email=u.email,
                full_name=u.full_name,
            )
        )
    return members


@router.post(
    "/projects/{project_id}/members",
    response_model=ProjectMemberRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(INVITE_LIMITER)],
)
async def add_free_project_member(
    project_id: UUID,
    payload: FreeMemberInvite,
    request: Request,
    user: User = Depends(current_verified_user),
    session: AsyncSession = Depends(get_async_session),
    user_manager: UserManager = Depends(get_user_manager),
) -> ProjectMemberRead:
    if payload.role not in _FREE_ASSIGNABLE_ROLES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="VALIDATION_ERROR"
        )
    project = await _load_free_project_superuser_or_404(session, project_id)
    if project.owner_user_id != user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="FREE_FORBIDDEN")

    # Serialize concurrent invites on this project so the member cap can't be
    # TOCTOU-raced. Transaction-scoped (released on commit below).
    await session.execute(
        sql_text("SELECT pg_advisory_xact_lock(:k)"),
        {"k": lock_id_for(f"free_members:{project_id}")},
    )
    # The owner's effective caps + trial. `session` is the superuser session here,
    # so it can read the (no-bim_app-grant) free_user_limits override row.
    limits = await resolve_free_limits(user, session)
    if limits.is_expired:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="FREE_ACCOUNT_EXPIRED"
        )
    if await count_free_members(session, project_id) >= limits.max_members_per_project:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="FREE_MEMBER_CAP_REACHED"
        )

    normalized = payload.email.strip().lower()
    target = await session.scalar(select(User).where(func.lower(User.email) == normalized))
    if target is not None and target.id == user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="FREE_CANNOT_INVITE_SELF"
        )

    new_user = False
    if target is None:
        # Mirror the signup/admin-invite pattern: insert with an unguessable
        # pre-hashed password (activation sets the real one) so validate_password
        # is never tripped; the activation email lets them set a password + log in.
        target = User(
            email=payload.email,
            hashed_password=user_manager.password_helper.hash(secrets.token_hex(32)),
            is_active=True,
            is_verified=False,
            is_superuser=False,
            locale=coerce_locale(None),
        )
        session.add(target)
        await session.flush()
        new_user = True

    already = await session.scalar(
        select(FreeProjectMember.user_id).where(
            FreeProjectMember.free_project_id == project_id,
            FreeProjectMember.user_id == target.id,
        )
    )
    if already is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="FREE_MEMBER_ALREADY_EXISTS"
        )

    member = FreeProjectMember(
        free_project_id=project_id,
        user_id=target.id,
        role=payload.role.value,
        created_by_user_id=user.id,
    )
    session.add(member)
    await session.flush()
    await session.refresh(member, ["created_at"])
    # Snapshot response fields before commit expires the instances.
    resp = ProjectMemberRead(
        project_id=project_id,
        user_id=target.id,
        role=payload.role,
        created_at=member.created_at,
        email=target.email,
        full_name=target.full_name,
    )
    await session.commit()
    if new_user:
        # Best-effort activation email (swallowed in on_after_request_verify).
        await user_manager.request_verify(target, request)
    return resp


@router.patch(
    "/projects/{project_id}/members/{member_user_id}",
    response_model=ProjectMemberRead,
)
async def update_free_project_member(
    project_id: UUID,
    member_user_id: UUID,
    payload: FreeMemberRoleUpdate,
    user: User = Depends(current_verified_user),
    session: AsyncSession = Depends(get_async_session),
) -> ProjectMemberRead:
    if payload.role not in _FREE_ASSIGNABLE_ROLES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="VALIDATION_ERROR"
        )
    project = await _load_free_project_superuser_or_404(session, project_id)
    if project.owner_user_id != user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="FREE_FORBIDDEN")
    member = await session.scalar(
        select(FreeProjectMember).where(
            FreeProjectMember.free_project_id == project_id,
            FreeProjectMember.user_id == member_user_id,
        )
    )
    if member is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="FREE_MEMBER_NOT_FOUND"
        )
    await assert_free_account_not_expired(user)
    member.role = payload.role.value
    target = await session.get(User, member_user_id)
    resp = ProjectMemberRead(
        project_id=project_id,
        user_id=member_user_id,
        role=payload.role,
        created_at=member.created_at,
        email=target.email if target else "",
        full_name=target.full_name if target else None,
    )
    await session.commit()
    return resp


@router.delete(
    "/projects/{project_id}/members/{member_user_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def remove_free_project_member(
    project_id: UUID,
    member_user_id: UUID,
    user: User = Depends(current_verified_user),
    session: AsyncSession = Depends(get_async_session),
) -> None:
    project = await _load_free_project_superuser_or_404(session, project_id)
    # Owner may remove anyone; a member may remove only themselves (leave).
    if project.owner_user_id != user.id and member_user_id != user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="FREE_FORBIDDEN")
    member = await session.scalar(
        select(FreeProjectMember).where(
            FreeProjectMember.free_project_id == project_id,
            FreeProjectMember.user_id == member_user_id,
        )
    )
    if member is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="FREE_MEMBER_NOT_FOUND"
        )
    await session.delete(member)
    await session.commit()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _load_free_project_superuser_or_404(
    session: AsyncSession, project_id: UUID
) -> FreeProject:
    """Load a free project on the SUPERUSER session (RLS-bypassed). Ownership /
    participation is validated by the caller."""
    project = await session.get(FreeProject, project_id)
    if project is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="FREE_PROJECT_NOT_FOUND"
        )
    return project


async def _assert_free_participant(
    session: AsyncSession, project: FreeProject, user_id: UUID
) -> None:
    """404 (hide existence) unless the caller owns the project or is a member."""
    if project.owner_user_id == user_id:
        return
    member = await session.scalar(
        select(FreeProjectMember.user_id).where(
            FreeProjectMember.free_project_id == project.id,
            FreeProjectMember.user_id == user_id,
        )
    )
    if member is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="FREE_PROJECT_NOT_FOUND"
        )


async def _load_free_project_or_404(
    session: AsyncSession, project_id: UUID, user_id: UUID
) -> FreeProject:
    """OWNER-only project load — used by the owner-only mutations (PATCH/DELETE
    project). The explicit owner filter is belt-and-suspenders over RLS so a
    member can never reach a project's mutation endpoints."""
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


async def _load_accessible_free_project_or_404(
    session: AsyncSession, project_id: UUID
) -> FreeProject:
    """PARTICIPANT project load — owner OR member (RLS-scoped). Used by the read
    endpoints (get, documents, snags, overview)."""
    project = (
        await session.execute(select(FreeProject).where(FreeProject.id == project_id))
    ).scalar_one_or_none()
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="FREE_PROJECT_NOT_FOUND")
    return project


async def _resolve_free_user_names(
    session: AsyncSession, snags: list[FreeFinding]
) -> dict[UUID, str]:
    """Map participant user ids (assignees + creators across the snags) to a
    display name (full_name, else email). Runs on the SUPERUSER session so the
    `users` RLS doesn't blank out other participants."""
    ids = {s.assigned_to_user_id for s in snags if s.assigned_to_user_id is not None}
    ids |= {s.created_by_user_id for s in snags if s.created_by_user_id is not None}
    if not ids:
        return {}
    rows = (
        await session.execute(
            select(User.id, User.full_name, User.email).where(User.id.in_(ids))
        )
    ).all()
    return {uid: (full_name or email) for uid, full_name, email in rows}


def _free_finding_element_reference(s: FreeFinding) -> str:
    """Readable location string for the export — the IFC GlobalId, else the
    file (+ page for a PDF anchor), else blank. Mirrors the paid helper."""
    if s.linked_element_global_id:
        return s.linked_element_global_id
    if s.linked_file_id is not None:
        if s.linked_file_type == "pdf" and s.anchor_page is not None:
            return f"file:{s.linked_file_id} p.{s.anchor_page}"
        return f"file:{s.linked_file_id}"
    return ""


def _free_finding_csv_row(s: FreeFinding, names: dict[UUID, str]) -> dict[str, str]:
    """Build an export row from a free snag, reusing the paid column builder. The
    paid-only columns (bbl ref, photos, resolution evidence/note) are blank/zero."""
    return _csv_row_dict(
        id=str(s.id),
        title=s.title,
        description=s.note or "",
        severity=s.severity,
        status=s.status,
        bbl_article_ref="",
        assignee=names.get(s.assigned_to_user_id, "") if s.assigned_to_user_id else "",
        deadline_date=s.deadline_date.isoformat() if s.deadline_date else "",
        created_by=names.get(s.created_by_user_id, "") if s.created_by_user_id else "",
        created_at=s.created_at.isoformat() if s.created_at else "",
        updated_at=s.updated_at.isoformat() if s.updated_at else "",
        element_reference=_free_finding_element_reference(s),
        photo_count="0",
        resolution_evidence_count="0",
        resolution_note="",
    )


async def _load_project_snags(session: AsyncSession, project_id: UUID) -> list[FreeFinding]:
    return list(
        (
            await session.execute(
                select(FreeFinding)
                .join(FreeDocument, FreeDocument.id == FreeFinding.free_document_id)
                .where(FreeDocument.free_project_id == project_id)
                .order_by(FreeFinding.created_at.asc())
            )
        )
        .scalars()
        .all()
    )


async def _free_project_to_read(
    p: FreeProject,
    my_role: ProjectRole = ProjectRole.owner,
    storage: StorageBackend | None = None,
) -> ProjectRead:
    # An uploaded cover is stored as a `free/<uid>/thumbnails/…` key; presign it
    # so the portal can render it (MinIO is CORS-restricted). A client-provided
    # external URL (from the create wizard) passes through untouched.
    thumbnail_url = p.thumbnail_url
    if storage is not None and thumbnail_url is not None and thumbnail_url.startswith("free/"):
        thumbnail_url = await storage.presigned_get_url(
            thumbnail_url, "thumbnail", disposition="inline"
        )
    return ProjectRead(
        id=p.id,
        owner_id=p.owner_user_id,
        name=p.name,
        description=p.description,
        thumbnail_url=thumbnail_url,
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
        # The caller's role on this project (owner for their own, editor/viewer
        # for a shared one) so the portal gates writes without a second fetch.
        my_role=my_role,
    )


def _role_enum(role: str | None) -> ProjectRole:
    """Map a resolved free role string to ProjectRole (defaults to viewer)."""
    try:
        return ProjectRole(role) if role is not None else ProjectRole.viewer
    except ValueError:
        return ProjectRole.viewer


def _free_finding_to_finding(
    s: FreeFinding, project_id: UUID, *, include_photos: bool = False
) -> FindingRead:
    """Adapt a pooled free snag to the paid FindingRead shape so the kanban board,
    finding cards AND the viewer inspector render free snags unchanged — the single
    server-side serializer so the client needs no free→paid adapter.

    `include_photos` controls whether photo / resolution-evidence ids are read off
    `s.attachment_links` (the free-on-mobile evidence). It is `False` for the board
    feed (which never selectinloads the links — reading them would MissingGreenlet)
    and `True` for the per-document/per-snag endpoints (which do load them). The
    remaining paid-only fields (template, resolution note, bbl ref) are null for the
    free tier."""
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
        assignee_user_id=s.assigned_to_user_id,
        deadline_date=s.deadline_date,
        created_by_user_id=s.created_by_user_id or s.owner_user_id,
        source_checklist_item_id=None,
        borgingsmoment_id=None,
        # Version-independent identity = the container; linked_file_id pins the
        # version it was filed against (mirrors paid Finding).
        linked_document_id=s.free_document_id,
        linked_file_id=s.linked_file_id or s.free_document_id,
        linked_element_global_id=s.linked_element_global_id,
        linked_file_type=s.linked_file_type,
        anchor_x=s.anchor_x,
        anchor_y=s.anchor_y,
        anchor_z=s.anchor_z,
        anchor_page=s.anchor_page,
        anchor_page_id=None,
        # FindingRead.photo_ids / resolution_evidence_ids are list[str]; the free
        # snag's properties return list[UUID], so stringify (only when including).
        photo_ids=(
            [str(p) for p in s.photo_ids]
            if include_photos and s.photo_ids is not None
            else None
        ),
        resolution_note=None,
        resolution_evidence_ids=(
            [str(e) for e in s.resolution_evidence_ids]
            if include_photos and s.resolution_evidence_ids is not None
            else None
        ),
        reference_attachment_ids=None,
        template_id=None,
        custom_values=None,
        duplicate_of_finding_id=None,
        created_at=s.created_at,
        updated_at=s.updated_at,
    )
