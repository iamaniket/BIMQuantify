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
import json
import zipfile
from collections.abc import AsyncIterator
from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, UploadFile, status
from fastapi.responses import StreamingResponse
from sqlalchemy import Select, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from bimdossier_api import audit
from bimdossier_api.access import (
    get_membership,
    load_project_or_404,
    require_membership,
    require_project_read_access,
    require_project_writable,
)
from bimdossier_api.attachment_links import replace_attachment_links
from bimdossier_api.auth.fastapi_users import current_verified_user
from bimdossier_api.auth.permissions import Action, Resource, require_permission
from bimdossier_api.bcf.findings import finding_to_parsed_topic, parsed_topic_to_finding_fields
from bimdossier_api.bcf.generator import generate_bcf_archive
from bimdossier_api.bcf.parser import BcfArchiveTooLargeError, parse_bcf_archive
from bimdossier_api.bcf.types import ParsedBcf, ParsedComment, Vec3
from bimdossier_api.config import get_settings
from bimdossier_api.content_disposition import safe_content_disposition
from bimdossier_api.finding_custom_values import build_custom_values
from bimdossier_api.i18n import resolve_org_locale, resolve_user_locale, t
from bimdossier_api.idempotency import idempotency_key_header, is_idempotency_conflict
from bimdossier_api.instruments import build_bundle_manifest
from bimdossier_api.models.audit_log import AuditLog
from bimdossier_api.models.finding import Finding, FindingSeverity, FindingStatus
from bimdossier_api.models.finding_attachment import FindingAttachment
from bimdossier_api.models.finding_comment import FindingComment
from bimdossier_api.models.notification import NotificationEventType
from bimdossier_api.models.org_template import OrgTemplate
from bimdossier_api.models.project_file import FileType, ProjectFile, ProjectFileRole
from bimdossier_api.models.project_member import ProjectRole
from bimdossier_api.models.user import User
from bimdossier_api.notifications.service import (
    create_notification,
    publish_notification,
)
from bimdossier_api.pdf_pages import find_or_create_pdf_page
from bimdossier_api.schemas.finding import (
    FindingBcfExportRequest,
    FindingBulkItemResult,
    FindingBulkOp,
    FindingBulkRequest,
    FindingBulkResult,
    FindingCreate,
    FindingDuplicateCandidate,
    FindingExport,
    FindingHistoryChange,
    FindingHistoryEntry,
    FindingMarkDuplicate,
    FindingRead,
    FindingReopen,
    FindingUpdate,
)
from bimdossier_api.tenancy import (
    get_tenant_session,
    open_tenant_session,
    require_active_organization,
)

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
        "linked_document_id": str(finding.linked_document_id) if finding.linked_document_id else None,
        "linked_file_id": str(finding.linked_file_id) if finding.linked_file_id else None,
        "linked_element_global_id": finding.linked_element_global_id,
        "linked_file_type": finding.linked_file_type,
        "anchor_x": finding.anchor_x,
        "anchor_y": finding.anchor_y,
        "anchor_z": finding.anchor_z,
        "anchor_page": finding.anchor_page,
        "resolution_note": finding.resolution_note,
        "duplicate_of_finding_id": (
            str(finding.duplicate_of_finding_id) if finding.duplicate_of_finding_id else None
        ),
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


async def _resolve_anchor_page_id(
    session: AsyncSession,
    *,
    linked_file_id: UUID | None,
    linked_file_type: str | None,
    anchor_page: int | None,
) -> UUID | None:
    """Best-effort normalization of a PDF page anchor to a logical ``pdf_pages`` id.

    Only a ``model_source`` PDF (which carries a ``document_id``) gets a page id;
    attachment-PDF and non-PDF anchors return None and rely on the 1-indexed
    ``anchor_page`` (which stays authoritative). ``anchor_page`` is already
    1-indexed, matching ``PdfPage.page_number``. Additive — never raises.
    """
    if linked_file_type != "pdf" or linked_file_id is None or anchor_page is None:
        return None
    file = (
        await session.execute(
            select(ProjectFile).where(
                ProjectFile.id == linked_file_id,
                ProjectFile.role == ProjectFileRole.model_source,
                ProjectFile.file_type == FileType.pdf,
            )
        )
    ).scalar_one_or_none()
    if file is None or file.document_id is None:
        return None
    page = await find_or_create_pdf_page(session, file.document_id, anchor_page)
    return page.id


@router.post("", response_model=FindingRead, status_code=status.HTTP_201_CREATED)
async def create_finding(
    project_id: UUID,
    payload: FindingCreate,
    request: Request,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
    idempotency_key: str | None = Depends(idempotency_key_header),
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

    # Idempotent replay (offline mobile outbox): if this creator already used
    # this key, return the original finding instead of inserting a duplicate.
    if idempotency_key is not None:
        prior = (
            await session.execute(
                select(Finding).where(
                    Finding.project_id == project.id,
                    Finding.created_by_user_id == user.id,
                    Finding.idempotency_key == idempotency_key,
                    Finding.deleted_at.is_(None),
                )
            )
        ).scalar_one_or_none()
        if prior is not None:
            return prior

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
        idempotency_key=idempotency_key,
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
    # Normalize a PDF page anchor to the logical pdf_pages row (model_source PDFs
    # only; NULL otherwise). Additive — anchor_page stays authoritative.
    finding.anchor_page_id = await _resolve_anchor_page_id(
        session,
        linked_file_id=payload.linked_file_id,
        linked_file_type=payload.linked_file_type,
        anchor_page=payload.anchor_page,
    )
    session.add(finding)
    try:
        await session.flush()
    except IntegrityError as exc:
        # Concurrent replay lost the race to insert the same idempotency key —
        # the partial-unique index is the backstop. 409 is retryable; the
        # client's next attempt hits the pre-check above and gets the row.
        if idempotency_key is not None and is_idempotency_conflict(exc):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="IDEMPOTENCY_KEY_CONFLICT",
            ) from exc
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


# Statuses that count as still-actionable for the "overdue" smart view — a
# resolved/verified finding past its deadline is not overdue, it's done.
_OVERDUE_OPEN_STATUSES: frozenset[FindingStatus] = frozenset(
    {FindingStatus.draft, FindingStatus.open, FindingStatus.in_progress}
)


@router.get("", response_model=list[FindingRead])
async def list_findings(
    project_id: UUID,
    response: Response,
    status_filter: FindingStatus | None = None,
    statuses: list[FindingStatus] | None = Query(default=None),
    severity: FindingSeverity | None = None,
    assignee_user_id: UUID | None = None,
    mine: bool = False,
    overdue: bool = False,
    linked_document_id: UUID | None = None,
    linked_file_id: UUID | None = None,
    linked_element_global_id: str | None = Query(default=None, max_length=255),
    unlinked: bool = False,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> list[Finding]:
    """List a project's findings.

    Smart-view filters (power-user "my open overdue points" on login):
    `mine=true` scopes to the caller as assignee, `overdue=true` to findings
    past their deadline that are still actionable, and `statuses=` accepts a
    multi-value status set (the single `status_filter` is kept for back-compat;
    both compose with AND).
    """
    project = await load_project_or_404(session, project_id)
    await require_project_read_access(session, project.id, user, active_org_id)

    stmt = select(Finding).where(Finding.project_id == project.id, Finding.deleted_at.is_(None))
    if status_filter is not None:
        stmt = stmt.where(Finding.status == status_filter)
    if statuses:
        stmt = stmt.where(Finding.status.in_(statuses))
    if severity is not None:
        stmt = stmt.where(Finding.severity == severity)
    # `mine` keys off the authenticated caller; an explicit assignee_user_id can
    # still be passed (e.g. a lead inspecting one teammate's queue). Both AND.
    if mine:
        stmt = stmt.where(Finding.assignee_user_id == user.id)
    if assignee_user_id is not None:
        stmt = stmt.where(Finding.assignee_user_id == assignee_user_id)
    if overdue:
        stmt = stmt.where(
            Finding.deadline_date.is_not(None),
            Finding.deadline_date < date.today(),
            Finding.status.in_(_OVERDUE_OPEN_STATUSES),
        )
    # Version-independent identity: model + GlobalId. This is what the viewer
    # element panel queries so a finding follows the element across versions.
    if linked_document_id is not None:
        stmt = stmt.where(Finding.linked_document_id == linked_document_id)
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

# Rows pulled (and eager-loads run) per server-side-cursor batch while streaming
# the CSV — bounds peak memory regardless of how many findings the project has.
_CSV_STREAM_BATCH = 500


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


def _findings_export_base(
    project_id: UUID,
    status_filter: FindingStatus | None,
    severity: FindingSeverity | None,
    assignee_user_id: UUID | None,
) -> Select[tuple[Finding]]:
    """The filtered `select(Finding)` shared by every export format (CSV/XLSX/JSON).
    Honours the same filters as the list endpoint; soft-deleted rows excluded."""
    base = select(Finding).where(Finding.project_id == project_id, Finding.deleted_at.is_(None))
    if status_filter is not None:
        base = base.where(Finding.status == status_filter)
    if severity is not None:
        base = base.where(Finding.severity == severity)
    if assignee_user_id is not None:
        base = base.where(Finding.assignee_user_id == assignee_user_id)
    return base


async def _audit_findings_export(
    session: AsyncSession,
    *,
    project_id: UUID,
    fmt: str,
    total: int,
    status_filter: FindingStatus | None,
    severity: FindingSeverity | None,
    assignee_user_id: UUID | None,
    request: Request,
    user: User,
) -> None:
    """Forensic trail for a bulk findings dump (count + format + filters + actor +
    IP), never the rows themselves. Commits with the request's tenant session."""
    await audit.record(
        session,
        action="finding.exported",
        resource_type="finding",
        actor_user_id=user.id,
        project_id=project_id,
        request=request,
        after={
            "format": fmt,
            "count": total,
            "filters": {
                "status": status_filter.value if status_filter is not None else None,
                "severity": severity.value if severity is not None else None,
                "assignee_user_id": str(assignee_user_id) if assignee_user_id else None,
            },
        },
    )


@router.get("/export.csv", response_class=Response)
async def export_findings_csv(
    project_id: UUID,
    request: Request,
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

    base = _findings_export_base(project.id, status_filter, severity, assignee_user_id)

    # Bulk PII/data export — leave a forensic trail (count + filters + actor +
    # IP). Read endpoints don't normally audit, but a full-project CSV dump is
    # an exfiltration surface, so this one row is the only record it happened.
    # Count via SQL (not len(rows)) so the audit row commits with this request's
    # tenant session and we never have to buffer the result set to size it.
    # Tenant session → lands in the active org's schema and commits with the
    # wrapping `session.begin()`; only metadata is stored, never the rows.
    total = (await session.scalar(select(func.count()).select_from(base.subquery()))) or 0
    await _audit_findings_export(
        session,
        project_id=project.id,
        fmt="csv",
        total=total,
        status_filter=status_filter,
        severity=severity,
        assignee_user_id=assignee_user_id,
        request=request,
        user=user,
    )

    # The CSV is streamed: a StreamingResponse body is produced AFTER the
    # request-scoped `session` (and its transaction) has closed, so the generator
    # must NOT borrow it — it opens its own short tenant session (same pattern as
    # the compliance check). `yield_per` drives a server-side cursor so only
    # `_CSV_STREAM_BATCH` rows (plus their eager-loaded assignee/creator) sit in
    # memory at once, no matter how many findings the project has.
    schema: str = request.state.active_schema
    stream_stmt = (
        base
        # assignee + created_by aren't selectin by default — eager-load them so
        # the display-name columns don't trigger an async lazy-load mid-stream.
        .options(selectinload(Finding.assignee), selectinload(Finding.created_by))
        .order_by(Finding.created_at.desc())
        .execution_options(yield_per=_CSV_STREAM_BATCH)
    )

    def _csv_line(row: dict[str, str]) -> bytes:
        line = io.StringIO()
        writer = csv.DictWriter(
            line, fieldnames=list(_FINDINGS_CSV_COLUMNS), extrasaction="ignore"
        )
        writer.writerow(row)
        return line.getvalue().encode("utf-8")

    async def _iter_csv() -> AsyncIterator[bytes]:
        header = io.StringIO()
        csv.DictWriter(
            header, fieldnames=list(_FINDINGS_CSV_COLUMNS), extrasaction="ignore"
        ).writeheader()
        yield header.getvalue().encode("utf-8")
        async with open_tenant_session(schema, active_org_id, user.id) as stream_session:
            result = await stream_session.stream(stream_stmt)
            async for finding in result.scalars():
                yield _csv_line(_finding_csv_row(finding))

    filename = f"findings-{project_id}.csv"
    return StreamingResponse(
        _iter_csv(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


_XLSX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


@router.get("/export.xlsx", response_class=Response)
async def export_findings_xlsx(
    project_id: UUID,
    request: Request,
    status_filter: FindingStatus | None = None,
    severity: FindingSeverity | None = None,
    assignee_user_id: UUID | None = None,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> Response:
    """The findings export as a single-sheet .xlsx (NL contractors live in Excel).

    Same columns + filters + audit trail as the CSV. The workbook is built with
    openpyxl's write-only mode (streams cells to a temp file) so memory stays
    bounded; it's returned as one body since xlsx is a zip and can't be chunked.
    """
    from openpyxl import Workbook  # type: ignore[import-untyped]  # local import, app cold path

    project = await load_project_or_404(session, project_id)
    await require_project_read_access(session, project.id, user, active_org_id)
    base = _findings_export_base(project.id, status_filter, severity, assignee_user_id)

    stmt = (
        base.options(selectinload(Finding.assignee), selectinload(Finding.created_by))
        .order_by(Finding.created_at.desc())
        .execution_options(yield_per=_CSV_STREAM_BATCH)
    )
    wb = Workbook(write_only=True)
    ws = wb.create_sheet("Findings")
    ws.append(list(_FINDINGS_CSV_COLUMNS))
    total = 0
    result = await session.stream(stmt)
    async for finding in result.scalars():
        row = _finding_csv_row(finding)
        ws.append([row[c] for c in _FINDINGS_CSV_COLUMNS])
        total += 1

    await _audit_findings_export(
        session,
        project_id=project.id,
        fmt="xlsx",
        total=total,
        status_filter=status_filter,
        severity=severity,
        assignee_user_id=assignee_user_id,
        request=request,
        user=user,
    )

    buf = io.BytesIO()
    wb.save(buf)
    filename = f"findings-{project_id}.xlsx"
    return Response(
        content=buf.getvalue(),
        media_type=_XLSX_MEDIA_TYPE,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/export.json", response_model=FindingExport)
async def export_findings_json(
    project_id: UUID,
    request: Request,
    status_filter: FindingStatus | None = None,
    severity: FindingSeverity | None = None,
    assignee_user_id: UUID | None = None,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> FindingExport:
    """Re-importable JSON export — a superset of the CSV carrying anchors, photo/
    evidence/reference ids and custom values. The data-portability + GDPR story,
    and the findings half of the instrument export bundle."""
    project = await load_project_or_404(session, project_id)
    await require_project_read_access(session, project.id, user, active_org_id)
    base = _findings_export_base(project.id, status_filter, severity, assignee_user_id)

    findings = list(
        (await session.execute(base.order_by(Finding.created_at.desc()))).scalars().all()
    )
    await _audit_findings_export(
        session,
        project_id=project.id,
        fmt="json",
        total=len(findings),
        status_filter=status_filter,
        severity=severity,
        assignee_user_id=assignee_user_id,
        request=request,
        user=user,
    )
    return FindingExport(
        project_id=project.id,
        count=len(findings),
        findings=[FindingRead.model_validate(f) for f in findings],
    )


# BCF 2.1 is the most universally re-attachable format across Solibri / BIMcollab
# / Navisworks, so finding↔BCF round-trips on 2.1 for the widest tool reach.
_FINDING_BCF_VERSION = "2.1"


async def _load_findings_for_export(
    session: AsyncSession, project_id: UUID, finding_ids: list[UUID] | None
) -> list[Finding]:
    stmt = (
        select(Finding)
        .where(Finding.project_id == project_id, Finding.deleted_at.is_(None))
        .options(selectinload(Finding.assignee), selectinload(Finding.created_by))
        .order_by(Finding.created_at.asc())
    )
    if finding_ids:
        stmt = stmt.where(Finding.id.in_(finding_ids))
    return list((await session.execute(stmt)).scalars().all())


async def _findings_to_bcf_bytes(session: AsyncSession, findings: list[Finding]) -> bytes:
    """Map findings → BCF topics (element GlobalId in the viewpoint selection so the
    issue re-attaches in BIMcollab/Solibri) and serialize a BCF 2.1 archive."""
    comments_by_finding: dict[UUID, list[ParsedComment]] = {}
    if findings:
        comment_rows = (
            (
                await session.execute(
                    select(FindingComment)
                    .where(
                        FindingComment.finding_id.in_([f.id for f in findings]),
                        FindingComment.deleted_at.is_(None),
                    )
                    .order_by(FindingComment.date.asc())
                )
            )
            .scalars()
            .all()
        )
        for c in comment_rows:
            comments_by_finding.setdefault(c.finding_id, []).append(
                ParsedComment(
                    guid=str(c.id),
                    text=c.comment_text,
                    author=c.author,
                    date=c.date,
                    modified_author=c.modified_author,
                    modified_date=c.modified_date,
                )
            )

    topics = []
    for f in findings:
        anchor = (
            Vec3(f.anchor_x, f.anchor_y, f.anchor_z)
            if f.linked_file_type == "ifc"
            and f.anchor_x is not None
            and f.anchor_y is not None
            and f.anchor_z is not None
            else None
        )
        topics.append(
            finding_to_parsed_topic(
                finding_id=str(f.id),
                title=f.title,
                description=f.description,
                status=f.status,
                severity=f.severity,
                created_at=f.created_at,
                bbl_article_ref=f.bbl_article_ref,
                deadline_date=f.deadline_date.isoformat() if f.deadline_date else None,
                assignee_email=f.assignee.email if f.assignee else None,
                creator_email=f.created_by.email if f.created_by else None,
                linked_element_global_id=f.linked_element_global_id,
                anchor=anchor,
                comments=comments_by_finding.get(f.id, []),
            )
        )
    return generate_bcf_archive(ParsedBcf(version=_FINDING_BCF_VERSION, topics=topics))


@router.post("/bcf-export", response_class=Response)
async def export_findings_bcf(
    project_id: UUID,
    payload: FindingBcfExportRequest,
    request: Request,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> Response:
    """Export findings as a BCF archive so they re-open on the right element in
    the architect's authoring tool (BIMcollab / Solibri / Navisworks).

    Each finding becomes a BCF topic whose viewpoint *selects* the IFC element by
    GlobalId — the payload those tools read to re-attach the issue to the exact
    component. The discussion thread maps to BCF comments. Omit `finding_ids` to
    export the whole project.
    """
    project = await load_project_or_404(session, project_id)
    await require_project_read_access(session, project.id, user, active_org_id)

    findings = await _load_findings_for_export(session, project.id, payload.finding_ids)
    archive = await _findings_to_bcf_bytes(session, findings)
    await audit.record(
        session,
        action="finding.exported",
        resource_type="finding",
        actor_user_id=user.id,
        project_id=project.id,
        request=request,
        after={"format": "bcf", "count": len(findings)},
    )
    filename = f"findings-{project_id}.bcfzip"
    return Response(
        content=archive,
        media_type="application/zip",
        headers={"Content-Disposition": safe_content_disposition(filename)},
    )


@router.post("/instrument-export", response_class=Response)
async def export_instrument_bundle(
    project_id: UUID,
    request: Request,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> Response:
    """The manual Wkb-instrument hand-off bundle (v0 of the KiK/WKI bridge).

    With no live instrument API yet, this packages the project's findings as
    BCF + JSON plus a `manifest.json` documenting the neutral schema, so the
    kwaliteitsborger imports our evidence into their admitted instrument by hand
    instead of re-keying it. The seam (`instruments/`) becomes a live push the
    day a partnership lands.
    """
    project = await load_project_or_404(session, project_id)
    await require_project_read_access(session, project.id, user, active_org_id)

    findings = await _load_findings_for_export(session, project.id, None)
    bcf_bytes = await _findings_to_bcf_bytes(session, findings)
    export = FindingExport(
        project_id=project.id,
        count=len(findings),
        findings=[FindingRead.model_validate(f) for f in findings],
    )
    json_bytes = export.model_dump_json(indent=2).encode("utf-8")

    bcf_name = "findings.bcfzip"
    json_name = "findings.json"
    manifest = build_bundle_manifest(
        project_id=str(project.id),
        project_name=project.name,
        country=project.country,
        instrument_ref=project.instrument_ref,
        finding_count=len(findings),
        bcf_filename=bcf_name,
        json_filename=json_name,
    )
    manifest_bytes = json.dumps(manifest, indent=2).encode("utf-8")

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("manifest.json", manifest_bytes)
        zf.writestr(bcf_name, bcf_bytes)
        zf.writestr(json_name, json_bytes)

    await audit.record(
        session,
        action="finding.exported",
        resource_type="finding",
        actor_user_id=user.id,
        project_id=project.id,
        request=request,
        after={"format": "instrument_bundle", "count": len(findings),
               "instrument": project.instrument_ref},
    )
    filename = f"wkb-evidence-{project_id}.zip"
    return Response(
        content=buf.getvalue(),
        media_type="application/zip",
        headers={"Content-Disposition": safe_content_disposition(filename)},
    )


@router.post("/bcf-import", response_model=list[FindingRead], status_code=status.HTTP_201_CREATED)
async def import_findings_from_bcf(
    project_id: UUID,
    file: UploadFile,
    request: Request,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> list[Finding]:
    """Import a BCF archive as DRAFT findings (coordination issues → snags).

    Each BCF topic becomes a draft finding re-anchored to its element GlobalId
    (read from the topic's viewpoint selection). Imported findings always start
    as `draft` — a human triages before promotion; we never trust an inbound BCF
    to set our lifecycle. Reuses the hardened `parse_bcf_archive` (zip-bomb guards).
    """
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

    max_bytes = get_settings().bcf_import_max_bytes
    data = await file.read(max_bytes + 1)
    if len(data) > max_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="BCF_ARCHIVE_TOO_LARGE",
        )
    try:
        parsed = parse_bcf_archive(data)
    except BcfArchiveTooLargeError as exc:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="BCF_ARCHIVE_TOO_LARGE",
        ) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="INVALID_BCF_ARCHIVE",
        ) from exc

    created: list[Finding] = []
    for topic in parsed.topics:
        fields = parsed_topic_to_finding_fields(topic)
        finding = Finding(
            project_id=project.id,
            created_by_user_id=user.id,
            status=FindingStatus.draft,
            **fields,
        )
        session.add(finding)
        await session.flush()
        loaded = await _load_finding_or_404(session, project.id, finding.id)
        await audit.record(
            session,
            action="finding.created",
            resource_type="finding",
            resource_id=loaded.id,
            after=_finding_snapshot(loaded),
            actor_user_id=user.id,
            project_id=project.id,
            request=request,
        )
        created.append(loaded)

    return created


@router.get("/duplicate-candidates", response_model=list[FindingDuplicateCandidate])
async def list_duplicate_candidates(
    project_id: UUID,
    linked_document_id: UUID = Query(...),
    linked_element_global_id: str = Query(..., max_length=255),
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> list[Finding]:
    """Still-open findings already anchored to the same (document, element).

    The viewer queries this when the user starts a new finding on an element so
    it can warn "an open finding already exists here" before a duplicate is
    created. Terminal (resolved/verified) and soft-deleted rows are excluded —
    only actionable findings count as a clash. Backed by ix_findings_linked_element.
    """
    project = await load_project_or_404(session, project_id)
    await require_project_read_access(session, project.id, user, active_org_id)
    stmt = (
        select(Finding)
        .where(
            Finding.project_id == project.id,
            Finding.deleted_at.is_(None),
            Finding.linked_document_id == linked_document_id,
            Finding.linked_element_global_id == linked_element_global_id,
            Finding.status.not_in([FindingStatus.resolved, FindingStatus.verified]),
        )
        .order_by(Finding.created_at.desc())
    )
    return list((await session.execute(stmt)).scalars().all())


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
    # Re-normalize the PDF page-id anchor when any anchor field changed (covers
    # re-anchoring and unlinking; resolves to None when it's no longer a
    # model_source PDF anchor).
    if {"linked_file_id", "linked_file_type", "anchor_page"} & updates.keys():
        finding.anchor_page_id = await _resolve_anchor_page_id(
            session,
            linked_file_id=finding.linked_file_id,
            linked_file_type=finding.linked_file_type,
            anchor_page=finding.anchor_page,
        )
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

    if promoted:
        # Assignment notification → the assignee alone (recipient_user_id), not an
        # org-wide fan-out: the "assigned" wording only makes sense for the one
        # person it was assigned to. With a single recipient we can key the locale
        # off their own preference (resolve_user_locale) rather than the project
        # default, so an English assignee on an NL project gets an English push.
        # assignee_user_id is guaranteed non-None here (the promotion gate above
        # rejects open-without-assignee); the fallback is purely defensive.
        assignee = await session.get(User, finding.assignee_user_id)
        locale = resolve_user_locale(assignee) if assignee else resolve_org_locale(project.country)
        notification = await create_notification(
            session,
            event_type=NotificationEventType.finding_created,
            title=t("notifications.finding_assigned.title", locale),
            body=t("notifications.finding_assigned.body", locale, title=finding.title),
            project_id=project.id,
            recipient_user_id=finding.assignee_user_id,
        )
        # Publish on write (M-en1) so the assignee's live notification stream gets
        # the ping immediately, not only on a later refetch. The row carries a
        # recipient_user_id, so the manager routes it to that user's sockets only.
        # publish_notification is best-effort (it swallows Redis errors internally).
        await publish_notification(notification, organization_id=active_org_id)
    elif resolving:
        # Resolution is relevant to the whole team (esp. the verifier) → org-wide
        # fan-out, localized to the project jurisdiction (no single recipient).
        locale = resolve_org_locale(project.country)
        notification = await create_notification(
            session,
            event_type=NotificationEventType.finding_resolved,
            title=t("notifications.finding_resolved.title", locale),
            body=t("notifications.finding_resolved.body", locale, title=finding.title),
            project_id=project.id,
        )
        # Publish on write (M-en1) — org-wide fan-out to every connected member.
        await publish_notification(notification, organization_id=active_org_id)

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


@router.post("/{finding_id}/mark-duplicate", response_model=FindingRead)
async def mark_finding_duplicate(
    project_id: UUID,
    finding_id: UUID,
    payload: FindingMarkDuplicate,
    request: Request,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> Finding:
    """Close a finding as a duplicate of another (keeps the dossier clean).

    Sets `duplicate_of_finding_id` and moves the duplicate to `resolved` with a
    synthetic note, deliberately bypassing the resolve evidence gate — the link
    is the evidence. A verified finding is terminal and cannot be re-closed; a
    finding can't be a duplicate of itself or of an already-duplicate (no chains).
    """
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
    if payload.duplicate_of_finding_id == finding_id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="FINDING_DUPLICATE_OF_SELF",
        )
    # 404 if the canonical target is missing or under a sibling project.
    target = await _load_finding_or_404(session, project.id, payload.duplicate_of_finding_id)
    if target.duplicate_of_finding_id is not None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="FINDING_DUPLICATE_TARGET_IS_DUPLICATE",
        )
    if finding.status is FindingStatus.verified:
        # Terminal — re-closing a verified finding as a duplicate is disallowed.
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="FINDING_ILLEGAL_TRANSITION",
        )

    before = _finding_snapshot(finding)
    finding.duplicate_of_finding_id = target.id
    finding.status = FindingStatus.resolved
    if not (finding.resolution_note or "").strip():
        locale = resolve_org_locale(project.country)
        finding.resolution_note = t("findings.duplicate_note", locale, id=str(target.id))
    await session.flush()
    await audit.record(
        session,
        action="finding.marked_duplicate",
        resource_type="finding",
        resource_id=finding.id,
        before=before,
        after=_finding_snapshot(finding),
        actor_user_id=user.id,
        project_id=project.id,
        request=request,
    )
    return await _load_finding_or_404(session, project.id, finding.id)


@router.post("/{finding_id}/reopen", response_model=FindingRead)
async def reopen_finding(
    project_id: UUID,
    finding_id: UUID,
    payload: FindingReopen,
    request: Request,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> Finding:
    """Re-open a verified finding whose defect re-emerged after sign-off.

    `verified` stays terminal for the normal PATCH path; this is the only
    sanctioned revert. Inspector-only (the kwaliteitsborger owns acceptance, so
    they own un-acceptance) and only from `verified`. The mandatory reason
    replaces the now-invalid resolution note, so it surfaces in the history diff
    (`resolution_note`) while the audit `before` snapshot preserves the prior
    resolution. The finding lands in `in_progress` for re-work.
    """
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
    if membership.role is not ProjectRole.inspector:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="FINDING_REOPEN_REQUIRES_INSPECTOR",
        )
    if finding.status is not FindingStatus.verified:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="FINDING_ILLEGAL_TRANSITION",
        )

    before = _finding_snapshot(finding)
    finding.status = FindingStatus.in_progress
    finding.resolution_note = payload.reason.strip()
    await session.flush()
    await audit.record(
        session,
        action="finding.reopened",
        resource_type="finding",
        resource_id=finding.id,
        before=before,
        after=_finding_snapshot(finding),
        actor_user_id=user.id,
        project_id=project.id,
        request=request,
    )
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


async def _apply_bulk_finding_op(
    session: AsyncSession,
    project_id: UUID,
    membership_role: ProjectRole,
    finding: Finding,
    req: FindingBulkRequest,
) -> str:
    """Apply one bulk op to a single finding, reusing the single-finding gates.

    Mutates `finding` in place and returns the audit action verb. Raises the same
    domain `HTTPException`s as `update_finding` (illegal transition, promote /
    resolve / verify gates, non-member assignee) so the caller can isolate the
    failure to this row. Never flushes — the caller owns the savepoint.
    """
    if req.op is FindingBulkOp.delete:
        finding.soft_delete()
        return "finding.deleted"

    if req.op is FindingBulkOp.assign:
        if (
            req.assignee_user_id is not None
            and await get_membership(session, project_id, req.assignee_user_id) is None
        ):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="ASSIGNEE_NOT_A_PROJECT_MEMBER",
            )
        finding.assignee_user_id = req.assignee_user_id
        return "finding.updated"

    if req.op is FindingBulkOp.set_deadline:
        finding.deadline_date = req.deadline_date
        return "finding.updated"

    # op == set_status. A status change may piggy-back assignee + deadline so a
    # batch draft→open promotion satisfies the promote gate in one call.
    previous_status = finding.status
    if req.assignee_user_id is not None:
        if await get_membership(session, project_id, req.assignee_user_id) is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="ASSIGNEE_NOT_A_PROJECT_MEMBER",
            )
        finding.assignee_user_id = req.assignee_user_id
    if req.deadline_date is not None:
        finding.deadline_date = req.deadline_date

    new_status = req.status
    assert new_status is not None  # guaranteed by FindingBulkRequest validator
    status_changed = new_status is not previous_status
    if status_changed and new_status not in _FINDING_TRANSITIONS[previous_status]:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="FINDING_ILLEGAL_TRANSITION",
        )
    finding.status = new_status

    resolving = status_changed and new_status is FindingStatus.resolved
    verifying = status_changed and new_status is FindingStatus.verified
    promoted = previous_status is FindingStatus.draft and new_status is FindingStatus.open

    if new_status is FindingStatus.open and (
        finding.deadline_date is None or finding.assignee_user_id is None
    ):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="FINDING_PROMOTE_REQUIRES_DEADLINE_ASSIGNEE",
        )
    if resolving and (
        not (finding.resolution_note or "").strip() or not finding.resolution_evidence_ids
    ):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="FINDING_RESOLVE_REQUIRES_EVIDENCE",
        )
    if verifying and membership_role is not ProjectRole.inspector:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="FINDING_VERIFY_REQUIRES_INSPECTOR",
        )

    if resolving:
        return "finding.resolved"
    if verifying:
        return "finding.verified"
    if promoted:
        return "finding.promoted"
    return "finding.updated"


@router.post("/bulk", response_model=FindingBulkResult)
async def bulk_update_findings(
    project_id: UUID,
    payload: FindingBulkRequest,
    request: Request,
    response: Response,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> FindingBulkResult:
    """Apply one operation to many findings at once (coordinator triage).

    Each row runs in its own SAVEPOINT and reuses the single-finding gate logic,
    so an illegal transition (or a missing finding) fails just that row and the
    rest still commit — the response is a 207-style per-row result. One
    `audit.record` per successful row keeps each finding's history correct; a
    *single* coalesced notification fires when the batch resolved anything, so a
    50-row close-out doesn't flood the team feed.
    """
    project = await load_project_or_404(session, project_id)
    membership = await require_membership(session, project.id, user.id)
    action = Action.delete if payload.op is FindingBulkOp.delete else Action.update
    try:
        require_permission(membership.role, Resource.finding, action)
    except HTTPException:
        await audit.log_permission_denied(
            role=membership.role.value,
            resource=Resource.finding.value,
            action=action.value,
            actor_user_id=user.id,
            request=request,
        )
        raise
    require_project_writable(project)

    # De-dup so a repeated id can't re-touch (and re-flush) an in-memory row whose
    # savepoint was rolled back. Order preserved.
    seen: set[UUID] = set()
    finding_ids: list[UUID] = []
    for fid in payload.finding_ids:
        if fid not in seen:
            seen.add(fid)
            finding_ids.append(fid)

    results: list[FindingBulkItemResult] = []
    resolved_count = 0
    for finding_id in finding_ids:
        try:
            async with session.begin_nested():
                finding = await _load_finding_or_404(session, project.id, finding_id)
                before = _finding_snapshot(finding)
                audit_action = await _apply_bulk_finding_op(
                    session, project.id, membership.role, finding, payload
                )
                await session.flush()
                await audit.record(
                    session,
                    action=audit_action,
                    resource_type="finding",
                    resource_id=finding.id,
                    before=before,
                    after=None if audit_action == "finding.deleted" else _finding_snapshot(finding),
                    actor_user_id=user.id,
                    project_id=project.id,
                    request=request,
                )
            results.append(
                FindingBulkItemResult(finding_id=finding_id, status="ok", action=audit_action)
            )
            if audit_action == "finding.resolved":
                resolved_count += 1
        except HTTPException as exc:
            detail = exc.detail if isinstance(exc.detail, str) else "FINDING_BULK_ROW_FAILED"
            results.append(
                FindingBulkItemResult(finding_id=finding_id, status="error", error_code=detail)
            )

    # One coalesced, org-wide notification for the whole batch (M-en1 publish-on-write)
    # rather than one per resolved finding — closing 50 points shouldn't ping 50 times.
    if resolved_count > 0:
        locale = resolve_org_locale(project.country)
        notification = await create_notification(
            session,
            event_type=NotificationEventType.finding_resolved,
            title=t("notifications.findings_bulk_resolved.title", locale),
            body=t("notifications.findings_bulk_resolved.body", locale, count=resolved_count),
            project_id=project.id,
        )
        await publish_notification(notification, organization_id=active_org_id)

    failed = sum(1 for r in results if r.status == "error")
    if failed:
        response.status_code = status.HTTP_207_MULTI_STATUS
    return FindingBulkResult(results=results, succeeded=len(results) - failed, failed=failed)
