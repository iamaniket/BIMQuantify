"""Per-project Bevinding (inspection finding) CRUD.

Wkb MVP backlog #25: a finding is a first-class object (not a sub-record of an
inspection) so one defect can be tracked across multiple borgingsmomenten. In
the current aannemer-first mode findings are created manually from the KB's
emailed/PDF report; the `source_checklist_item_id` column is reserved for the
later auto-draft-from-failed-checklist hook.

RLS filters every read/write by tenant (schema-per-tenant); project-membership +
the `Resource.finding` permission matrix gate the writes. A finding is promoted
from `draft` to `open` by setting a deadline and an assignee.
"""

import csv
import io
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from bimstitch_api import audit
from bimstitch_api.access import (
    get_membership,
    load_project_or_404,
    require_membership,
    require_project_read_access,
    require_project_writable,
)
from bimstitch_api.attachment_links import replace_attachment_links
from bimstitch_api.auth.fastapi_users import current_verified_user
from bimstitch_api.auth.permissions import Action, Resource, require_permission
from bimstitch_api.finding_custom_values import build_custom_values
from bimstitch_api.i18n import resolve_org_locale, t
from bimstitch_api.models.audit_log import AuditLog
from bimstitch_api.models.finding import Finding, FindingSeverity, FindingStatus
from bimstitch_api.models.finding_attachment import FindingAttachment
from bimstitch_api.models.notification import NotificationEventType
from bimstitch_api.models.org_template import OrgTemplate
from bimstitch_api.models.project_member import ProjectRole
from bimstitch_api.models.user import User
from bimstitch_api.notifications.service import create_notification
from bimstitch_api.schemas.finding import (
    FindingCreate,
    FindingHistoryChange,
    FindingHistoryEntry,
    FindingRead,
    FindingUpdate,
)
from bimstitch_api.tenancy import get_tenant_session, require_active_organization

router = APIRouter(prefix="/projects/{project_id}/findings", tags=["findings"])


# Legal Bevinding lifecycle transitions (#26/#27). The finding moves
# draft -> open -> in_progress/resolved -> verified. `verified` is the
# kwaliteitsborger's acceptance and is terminal — there is no revert. A
# resolution can be reworked (resolved -> in_progress) or re-opened
# (in_progress -> open). Same-status writes are no-ops and skip the map.
_FINDING_TRANSITIONS: dict[FindingStatus, frozenset[FindingStatus]] = {
    FindingStatus.draft: frozenset({FindingStatus.open}),
    FindingStatus.open: frozenset({FindingStatus.in_progress, FindingStatus.resolved}),
    FindingStatus.in_progress: frozenset({FindingStatus.resolved, FindingStatus.open}),
    FindingStatus.resolved: frozenset({FindingStatus.verified, FindingStatus.in_progress}),
    FindingStatus.verified: frozenset(),
}


def _finding_snapshot(finding: Finding) -> dict[str, object]:
    return {
        "title": finding.title,
        "description": finding.description,
        "severity": finding.severity.value,
        "status": finding.status.value,
        "assignee_user_id": str(finding.assignee_user_id) if finding.assignee_user_id else None,
        "deadline_date": finding.deadline_date.isoformat() if finding.deadline_date else None,
        "bbl_article_ref": finding.bbl_article_ref,
        "source_checklist_item_id": (
            str(finding.source_checklist_item_id) if finding.source_checklist_item_id else None
        ),
        "borgingsmoment_id": (
            str(finding.borgingsmoment_id) if finding.borgingsmoment_id else None
        ),
        "linked_model_id": str(finding.linked_model_id) if finding.linked_model_id else None,
        "linked_file_id": str(finding.linked_file_id) if finding.linked_file_id else None,
        "linked_element_global_id": finding.linked_element_global_id,
        "linked_file_type": finding.linked_file_type,
        "anchor_x": finding.anchor_x,
        "anchor_y": finding.anchor_y,
        "anchor_z": finding.anchor_z,
        "anchor_page": finding.anchor_page,
        "resolution_note": finding.resolution_note,
        "has_references": bool(finding.reference_attachment_ids),
        # Counts (not the id lists) so the history diff can render "added 2
        # photos" without leaking attachment ids into the audit snapshot.
        "photo_count": len(finding.photo_ids or []),
        "resolution_evidence_count": len(finding.resolution_evidence_ids or []),
        "template_id": str(finding.template_id) if finding.template_id else None,
        "has_custom_values": bool(finding.custom_values),
    }


def _enforce_builtin_required(
    template: OrgTemplate | None,
    data: dict[str, object],
    photo_ids: list[str] | None,
    reference_attachment_ids: list[str] | None,
) -> None:
    """Server-side backstop for built-in finding fields a template marked
    required (the portal also enforces these in the dynamic form)."""
    if template is None:
        return
    cfg = template.builtin_fields or {}

    def _required(key: str) -> bool:
        entry = cfg.get(key)
        return bool(isinstance(entry, dict) and entry.get("required"))

    def _missing(detail: str) -> HTTPException:
        return HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"FINDING_TEMPLATE_REQUIRED_FIELD:{detail}",
        )

    bbl = data.get("bbl_article_ref")
    if _required("bbl_article_ref") and not (isinstance(bbl, str) and bbl.strip()):
        raise _missing("bbl_article_ref")
    if _required("photos") and not photo_ids:
        raise _missing("photos")
    if _required("references") and not reference_attachment_ids:
        raise _missing("references")


async def _load_finding_or_404(
    session: AsyncSession, project_id: UUID, finding_id: UUID
) -> Finding:
    """Filters on both columns so a finding under a sibling project surfaces as
    404, not a 200 leaking the row. Soft-deleted rows are also hidden."""
    finding = (
        await session.execute(
            select(Finding).where(
                Finding.id == finding_id,
                Finding.project_id == project_id,
                Finding.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if finding is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="FINDING_NOT_FOUND")
    return finding


@router.post("", response_model=FindingRead, status_code=status.HTTP_201_CREATED)
async def create_finding(
    project_id: UUID,
    payload: FindingCreate,
    request: Request,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> Finding:
    project = await load_project_or_404(session, project_id)
    membership = await require_membership(session, project.id, user.id)
    try:
        require_permission(membership.role, Resource.finding, Action.create)
    except HTTPException:
        await audit.log_permission_denied(
            role=membership.role.value,
            resource=Resource.finding.value,
            action=Action.create.value,
            actor_user_id=user.id,
            request=request,
        )
        raise
    require_project_writable(project)

    data = payload.model_dump()
    photo_ids = data.pop("photo_ids", None)
    reference_attachment_ids = data.pop("reference_attachment_ids", None)
    template_id = data.pop("template_id", None)
    raw_custom_values = data.pop("custom_values", None)

    template: OrgTemplate | None = None
    if template_id is not None:
        template = (
            await session.execute(
                select(OrgTemplate).where(
                    OrgTemplate.id == template_id,
                    OrgTemplate.deleted_at.is_(None),
                )
            )
        ).scalar_one_or_none()
        if template is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="FINDING_TEMPLATE_NOT_FOUND",
            )
    custom_values = build_custom_values(template, raw_custom_values)
    _enforce_builtin_required(template, data, photo_ids, reference_attachment_ids)

    finding = Finding(
        project_id=project.id,
        created_by_user_id=user.id,
        status=FindingStatus.draft,
        template_id=template_id,
        custom_values=custom_values,
        **data,
    )
    replace_attachment_links(
        finding.attachment_links, FindingAttachment, kind="photo", ids=photo_ids
    )
    replace_attachment_links(
        finding.attachment_links,
        FindingAttachment,
        kind="reference",
        ids=reference_attachment_ids,
    )
    session.add(finding)
    try:
        await session.flush()
    except IntegrityError as exc:
        # A photo/reference id that doesn't reference a real attachment trips the
        # FK — surface a clean 422 instead of a 500.
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="ATTACHMENT_NOT_FOUND",
        ) from exc
    # Re-load so the eager attachment links are populated (a freshly-built row
    # is not selectin-loaded) for both the audit snapshot and the response.
    finding = await _load_finding_or_404(session, project.id, finding.id)
    await audit.record(
        session,
        action="finding.created",
        resource_type="finding",
        resource_id=finding.id,
        after=_finding_snapshot(finding),
        actor_user_id=user.id,
        project_id=project.id,
        request=request,
    )
    return finding


@router.get("", response_model=list[FindingRead])
async def list_findings(
    project_id: UUID,
    response: Response,
    status_filter: FindingStatus | None = None,
    severity: FindingSeverity | None = None,
    assignee_user_id: UUID | None = None,
    linked_model_id: UUID | None = None,
    linked_file_id: UUID | None = None,
    linked_element_global_id: str | None = Query(default=None, max_length=255),
    unlinked: bool = False,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> list[Finding]:
    project = await load_project_or_404(session, project_id)
    await require_project_read_access(session, project.id, user, active_org_id)

    stmt = select(Finding).where(Finding.project_id == project.id, Finding.deleted_at.is_(None))
    if status_filter is not None:
        stmt = stmt.where(Finding.status == status_filter)
    if severity is not None:
        stmt = stmt.where(Finding.severity == severity)
    if assignee_user_id is not None:
        stmt = stmt.where(Finding.assignee_user_id == assignee_user_id)
    # Version-independent identity: model + GlobalId. This is what the viewer
    # element panel queries so a finding follows the element across versions.
    if linked_model_id is not None:
        stmt = stmt.where(Finding.linked_model_id == linked_model_id)
    if linked_file_id is not None:
        stmt = stmt.where(Finding.linked_file_id == linked_file_id)
    if linked_element_global_id is not None:
        stmt = stmt.where(Finding.linked_element_global_id == linked_element_global_id)
    if unlinked:
        stmt = stmt.where(Finding.linked_element_global_id.is_(None))

    total = (await session.scalar(select(func.count()).select_from(stmt.subquery()))) or 0
    response.headers["X-Total-Count"] = str(total)

    stmt = stmt.order_by(Finding.created_at.desc()).limit(limit).offset(offset)
    result = await session.execute(stmt)
    return list(result.scalars().all())


# One row per finding (#G2). Columns are the full human-relevant inventory;
# enum columns emit neutral `.value` codes (Dutch labels are a UI concern).
_FINDINGS_CSV_COLUMNS: tuple[str, ...] = (
    "id",
    "title",
    "description",
    "severity",
    "status",
    "bbl_article_ref",
    "assignee",
    "deadline_date",
    "created_by",
    "created_at",
    "updated_at",
    "element_reference",
    "photo_count",
    "resolution_evidence_count",
    "resolution_note",
)


def _display_name(u: User | None) -> str:
    """Display name (full_name, else email) for an eager-loaded User, or blank."""
    if u is None:
        return ""
    return u.full_name or u.email


def _finding_element_reference(f: Finding) -> str:
    """A single readable location/element string for the export. IFC → the
    element GlobalId; a drawing-anchored finding → the file (+ page for PDF);
    otherwise blank."""
    if f.linked_element_global_id:
        return f.linked_element_global_id
    if f.linked_file_id is not None:
        if f.linked_file_type == "pdf" and f.anchor_page is not None:
            return f"file:{f.linked_file_id} p.{f.anchor_page}"
        return f"file:{f.linked_file_id}"
    return ""


def _finding_csv_row(f: Finding) -> dict[str, str]:
    return {
        "id": str(f.id),
        "title": f.title,
        "description": f.description,
        "severity": f.severity.value,
        "status": f.status.value,
        "bbl_article_ref": f.bbl_article_ref or "",
        "assignee": _display_name(f.assignee),
        "deadline_date": f.deadline_date.isoformat() if f.deadline_date else "",
        "created_by": _display_name(f.created_by),
        "created_at": f.created_at.isoformat() if f.created_at else "",
        "updated_at": f.updated_at.isoformat() if f.updated_at else "",
        "element_reference": _finding_element_reference(f),
        "photo_count": str(len(f.photo_ids or [])),
        "resolution_evidence_count": str(len(f.resolution_evidence_ids or [])),
        "resolution_note": f.resolution_note or "",
    }


@router.get("/export.csv", response_class=Response)
async def export_findings_csv(
    project_id: UUID,
    status_filter: FindingStatus | None = None,
    severity: FindingSeverity | None = None,
    assignee_user_id: UUID | None = None,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> Response:
    """Stream the project's findings (bevindingen) as CSV — one row per finding.

    Mirrors the compliance CSV exports (A17/A18). Honours the same filters as
    the list endpoint (status / severity / assignee) so the download matches
    what the user sees; soft-deleted rows are excluded. Read-gated like the
    list view — project-read access suffices.
    """
    project = await load_project_or_404(session, project_id)
    await require_project_read_access(session, project.id, user, active_org_id)

    stmt = (
        select(Finding)
        .where(Finding.project_id == project.id, Finding.deleted_at.is_(None))
        # assignee + created_by are not selectin by default — eager-load them so
        # the display-name columns don't trigger an async lazy-load.
        .options(selectinload(Finding.assignee), selectinload(Finding.created_by))
        .order_by(Finding.created_at.desc())
    )
    if status_filter is not None:
        stmt = stmt.where(Finding.status == status_filter)
    if severity is not None:
        stmt = stmt.where(Finding.severity == severity)
    if assignee_user_id is not None:
        stmt = stmt.where(Finding.assignee_user_id == assignee_user_id)
    findings = (await session.execute(stmt)).scalars().all()

    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=list(_FINDINGS_CSV_COLUMNS), extrasaction="ignore")
    writer.writeheader()
    for finding in findings:
        writer.writerow(_finding_csv_row(finding))

    filename = f"findings-{project_id}.csv"
    return Response(
        content=buf.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/{finding_id}", response_model=FindingRead)
async def get_finding(
    project_id: UUID,
    finding_id: UUID,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> Finding:
    project = await load_project_or_404(session, project_id)
    await require_project_read_access(session, project.id, user, active_org_id)
    return await _load_finding_or_404(session, project.id, finding_id)


def _snapshot_status(snapshot: dict[str, object] | None) -> str | None:
    if not snapshot:
        return None
    value = snapshot.get("status")
    return value if isinstance(value, str) else None


# Fields surfaced in the per-entry history diff. `status` is intentionally
# excluded — it is already carried by `from_status`/`to_status`.
_HISTORY_DIFF_FIELDS: tuple[str, ...] = (
    "title",
    "description",
    "severity",
    "bbl_article_ref",
    "assignee_user_id",
    "deadline_date",
    "resolution_note",
    "has_references",
    "photo_count",
    "resolution_evidence_count",
)


def _history_value(value: object) -> str | None:
    """Stringify a snapshot value for the history diff (None stays None)."""
    if value is None:
        return None
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


def _diff_snapshots(
    before: dict[str, object] | None, after: dict[str, object] | None
) -> list[FindingHistoryChange]:
    """Field-level diff of two finding snapshots for the history timeline.

    Emits one change per curated field whose value differs. `created`/`deleted`
    entries (one snapshot is None) carry no diff — the action verb stands alone.
    A field absent from *both* snapshots (older audit rows predate it, e.g.
    `photo_count`) is skipped; the two snapshots in one mutation always share
    the same keys, so a None->value false positive can't arise.
    """
    if not before or not after:
        return []
    changes: list[FindingHistoryChange] = []
    for field in _HISTORY_DIFF_FIELDS:
        if field not in before and field not in after:
            continue
        old = before.get(field)
        new = after.get(field)
        if old == new:
            continue
        changes.append(
            FindingHistoryChange(
                field=field,
                from_value=_history_value(old),
                to_value=_history_value(new),
            )
        )
    return changes


@router.get("/{finding_id}/history", response_model=list[FindingHistoryEntry])
async def get_finding_history(
    project_id: UUID,
    finding_id: UUID,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> list[FindingHistoryEntry]:
    """Chronological lifecycle timeline for one finding.

    Reads the per-tenant `audit_log` (search_path resolves it to the active
    org's schema) for every entry targeting this finding, oldest first. Gated
    on project-read like `get_finding` — any project member can see the
    history, so a contractor sees it without holding the `audit_log`
    permission. `from_status`/`to_status` come from each entry's before/after
    snapshot; the actor is resolved from `public.users`.
    """
    project = await load_project_or_404(session, project_id)
    await require_project_read_access(session, project.id, user, active_org_id)
    # 404 if the finding doesn't exist or belongs to a sibling project.
    await _load_finding_or_404(session, project.id, finding_id)

    # Select the AuditLog + User entities (not bare columns): `User.email` /
    # `User.id` come from the FastAPI-Users base typed as plain str/UUID, so
    # passing them to `select()` won't type-check — read them off the instance
    # instead. `actor` is None for entries whose author row was deleted.
    stmt = (
        select(AuditLog, User)
        .outerjoin(User, User.id == AuditLog.user_id)
        .where(
            AuditLog.resource_type == "finding",
            AuditLog.resource_id == str(finding_id),
        )
        .order_by(AuditLog.created_at.asc())
    )
    rows = (await session.execute(stmt)).all()

    return [
        FindingHistoryEntry(
            id=log.id,
            action=log.action,
            actor_user_id=log.user_id,
            actor_name=actor.full_name if actor else None,
            actor_email=actor.email if actor else None,
            from_status=_snapshot_status(log.before),
            to_status=_snapshot_status(log.after),
            changes=_diff_snapshots(log.before, log.after),
            created_at=log.created_at,
        )
        for log, actor in rows
    ]


@router.patch("/{finding_id}", response_model=FindingRead)
async def update_finding(
    project_id: UUID,
    finding_id: UUID,
    payload: FindingUpdate,
    request: Request,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> Finding:
    project = await load_project_or_404(session, project_id)
    membership = await require_membership(session, project.id, user.id)
    try:
        require_permission(membership.role, Resource.finding, Action.update)
    except HTTPException:
        await audit.log_permission_denied(
            role=membership.role.value,
            resource=Resource.finding.value,
            action=Action.update.value,
            actor_user_id=user.id,
            resource_id=finding_id,
            request=request,
        )
        raise
    require_project_writable(project)

    finding = await _load_finding_or_404(session, project.id, finding_id)
    before = _finding_snapshot(finding)
    previous_status = finding.status

    updates = payload.model_dump(exclude_unset=True)
    # Attachment id lists are normalized into link rows, not columns — pop them
    # out and replace the link set per kind (only for kinds the caller sent).
    has_photo = "photo_ids" in updates
    has_resolution_evidence = "resolution_evidence_ids" in updates
    has_reference = "reference_attachment_ids" in updates
    photo_ids = updates.pop("photo_ids", None)
    resolution_evidence_ids = updates.pop("resolution_evidence_ids", None)
    reference_attachment_ids = updates.pop("reference_attachment_ids", None)
    for field, value in updates.items():
        setattr(finding, field, value)
    if has_photo:
        replace_attachment_links(
            finding.attachment_links, FindingAttachment, kind="photo", ids=photo_ids
        )
    if has_resolution_evidence:
        replace_attachment_links(
            finding.attachment_links,
            FindingAttachment,
            kind="resolution_evidence",
            ids=resolution_evidence_ids,
        )
    if has_reference:
        replace_attachment_links(
            finding.attachment_links,
            FindingAttachment,
            kind="reference",
            ids=reference_attachment_ids,
        )

    # Validate a chosen assignee actually belongs to the project so an invalid
    # id surfaces as a clean 422 rather than an FK IntegrityError 500.
    if finding.assignee_user_id is not None and "assignee_user_id" in updates:
        assignee_membership = await get_membership(session, project.id, finding.assignee_user_id)
        if assignee_membership is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="ASSIGNEE_NOT_A_PROJECT_MEMBER",
            )

    # Lifecycle gating (#26/#27). A status change must follow the legal
    # transition map; same-status writes are no-ops and skip it.
    status_changed = finding.status is not previous_status
    if status_changed and finding.status not in _FINDING_TRANSITIONS[previous_status]:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="FINDING_ILLEGAL_TRANSITION",
        )

    resolving = status_changed and finding.status is FindingStatus.resolved
    verifying = status_changed and finding.status is FindingStatus.verified
    promoted = previous_status is FindingStatus.draft and finding.status is FindingStatus.open

    # Promotion rule: draft -> open requires both a deadline and an assignee.
    if finding.status is FindingStatus.open and (
        finding.deadline_date is None or finding.assignee_user_id is None
    ):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="FINDING_PROMOTE_REQUIRES_DEADLINE_ASSIGNEE",
        )

    # Evidence gate: marking a finding resolved requires a written note and at
    # least one evidence attachment — no silent close.
    if resolving and (
        not (finding.resolution_note or "").strip() or not finding.resolution_evidence_ids
    ):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="FINDING_RESOLVE_REQUIRES_EVIDENCE",
        )

    # Verification is the kwaliteitsborger's independent acceptance — only the
    # inspector role may move a finding into `verified`.
    if verifying and membership.role is not ProjectRole.inspector:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="FINDING_VERIFY_REQUIRES_INSPECTOR",
        )

    try:
        await session.flush()
    except IntegrityError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="ATTACHMENT_NOT_FOUND",
        ) from exc

    if promoted or resolving:
        # Finding notifications are project-scoped fan-outs (everyone in
        # the org sees the row). Pick the locale from the project's
        # jurisdiction default — there is no single recipient to key off.
        locale = resolve_org_locale(project.country)
        key = "notifications.finding_assigned" if promoted else "notifications.finding_resolved"
        await create_notification(
            session,
            event_type=(
                NotificationEventType.finding_created
                if promoted
                else NotificationEventType.finding_resolved
            ),
            title=t(f"{key}.title", locale),
            body=t(f"{key}.body", locale, title=finding.title),
            project_id=project.id,
        )

    if resolving:
        audit_action = "finding.resolved"
    elif verifying:
        audit_action = "finding.verified"
    elif promoted:
        audit_action = "finding.promoted"
    else:
        audit_action = "finding.updated"

    await audit.record(
        session,
        action=audit_action,
        resource_type="finding",
        resource_id=finding.id,
        before=before,
        after=_finding_snapshot(finding),
        actor_user_id=user.id,
        project_id=project.id,
        request=request,
    )
    # Re-fetch so the response carries the DB-side updated_at and the freshly
    # selectin-loaded attachment links.
    return await _load_finding_or_404(session, project.id, finding.id)


@router.delete("/{finding_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_finding(
    project_id: UUID,
    finding_id: UUID,
    request: Request,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> Response:
    project = await load_project_or_404(session, project_id)
    membership = await require_membership(session, project.id, user.id)
    try:
        require_permission(membership.role, Resource.finding, Action.delete)
    except HTTPException:
        await audit.log_permission_denied(
            role=membership.role.value,
            resource=Resource.finding.value,
            action=Action.delete.value,
            actor_user_id=user.id,
            resource_id=finding_id,
            request=request,
        )
        raise
    require_project_writable(project)

    finding = await _load_finding_or_404(session, project.id, finding_id)
    before = _finding_snapshot(finding)
    finding.soft_delete()
    await session.flush()
    await audit.record(
        session,
        action="finding.deleted",
        resource_type="finding",
        resource_id=finding_id,
        before=before,
        actor_user_id=user.id,
        project_id=project.id,
        request=request,
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
