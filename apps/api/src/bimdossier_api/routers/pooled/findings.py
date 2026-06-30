from uuid import UUID

from fastapi import Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from bimdossier_api.auth.fastapi_users import current_verified_user
from bimdossier_api.models.pooled_document import PooledDocument
from bimdossier_api.models.pooled_finding import (
    POOLED_FINDING_SEVERITIES,
    POOLED_FINDING_STATUSES,
    PooledFinding,
)
from bimdossier_api.models.user import User
from bimdossier_api.routers.free_access import (
    assert_assignee_is_participant,
    assert_free_account_not_expired,
    require_pooled_write_role,
    resolve_pooled_document_role,
)
from bimdossier_api.routers.pooled._shared import (
    PooledFindingCreate,
    PooledFindingUpdate,
    _attach_links_to_snag,
    _load_accessible_document_by_id_or_404,
    _load_accessible_snag_or_404,
    router,
)
from bimdossier_api.routers.pooled_projects import _pooled_finding_to_finding
from bimdossier_api.schemas.finding import FindingRead
from bimdossier_api.tenancy import get_pooled_session


@router.post(
    "/documents/{document_id}/findings",
    response_model=FindingRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_pooled_finding(
    document_id: UUID,
    payload: PooledFindingCreate,
    user: User = Depends(current_verified_user),
    session: AsyncSession = Depends(get_pooled_session),
) -> FindingRead:
    if payload.severity not in POOLED_FINDING_SEVERITIES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="VALIDATION_ERROR"
        )
    document = await _load_accessible_document_by_id_or_404(session, document_id)
    require_pooled_write_role(await resolve_pooled_document_role(session, document, user.id))
    await assert_free_account_not_expired(user)
    if payload.assigned_to_user_id is not None:
        await assert_assignee_is_participant(
            document.pooled_project_id, payload.assigned_to_user_id
        )
    snag = PooledFinding(
        pooled_document_id=document_id,
        linked_file_id=payload.linked_file_id,
        # owner_user_id stays = the project owner (the RLS/quota key) even when a
        # member files the snag; created_by_user_id records the real author.
        owner_user_id=document.owner_user_id,
        created_by_user_id=user.id,
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
        assigned_to_user_id=payload.assigned_to_user_id,
        deadline_date=payload.deadline_date,
    )
    session.add(snag)
    await session.flush()  # assign snag.id before linking attachments
    if payload.photo_ids:
        await _attach_links_to_snag(session, snag, document, payload.photo_ids, "photo")
        await session.flush()
    # Eager-load the links so `photo_ids` reads them in-memory (no async lazy-load).
    await session.refresh(snag, attribute_names=["attachment_links"])
    return _pooled_finding_to_finding(snag, document.pooled_project_id, include_photos=True)


@router.get("/documents/{document_id}/findings", response_model=list[FindingRead])
async def list_pooled_findings(
    document_id: UUID,
    user: User = Depends(current_verified_user),
    session: AsyncSession = Depends(get_pooled_session),
) -> list[FindingRead]:
    document = await _load_accessible_document_by_id_or_404(session, document_id)
    rows = (
        (
            await session.execute(
                select(PooledFinding)
                .where(PooledFinding.pooled_document_id == document_id)
                .options(selectinload(PooledFinding.attachment_links))
                .order_by(PooledFinding.created_at.asc())
            )
        )
        .scalars()
        .all()
    )
    return [
        _pooled_finding_to_finding(s, document.pooled_project_id, include_photos=True) for s in rows
    ]


@router.get("/findings/{finding_id}", response_model=FindingRead)
async def get_pooled_finding(
    finding_id: UUID,
    user: User = Depends(current_verified_user),
    session: AsyncSession = Depends(get_pooled_session),
) -> FindingRead:
    """Single free snag (mobile `useFinding` + offline 422-conflict refetch). RLS
    scopes visibility to participants; 404 otherwise."""
    snag = await _load_accessible_snag_or_404(session, finding_id)
    project_id = await session.scalar(
        select(PooledDocument.pooled_project_id).where(PooledDocument.id == snag.pooled_document_id)
    )
    if project_id is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="FREE_DOCUMENT_NOT_FOUND")
    return _pooled_finding_to_finding(snag, project_id, include_photos=True)


@router.patch("/findings/{finding_id}", response_model=FindingRead)
async def update_pooled_finding(
    finding_id: UUID,
    payload: PooledFindingUpdate,
    user: User = Depends(current_verified_user),
    session: AsyncSession = Depends(get_pooled_session),
) -> FindingRead:
    snag = await _load_accessible_snag_or_404(session, finding_id)
    document = await _load_accessible_document_by_id_or_404(session, snag.pooled_document_id)
    require_pooled_write_role(await resolve_pooled_document_role(session, document, user.id))
    await assert_free_account_not_expired(user)

    # exclude_unset distinguishes an OMITTED field (leave unchanged) from an
    # explicit null (clear the column), mirroring the paid update_finding.
    updates = payload.model_dump(exclude_unset=True)
    # Photo / resolution-evidence links are relationship side-effects, not column
    # setattrs (photo_ids is a read-only property) — pull them out and apply via
    # the link helper below. A present list APPENDS; it never clears.
    add_photo_ids = updates.pop("photo_ids", None)
    add_evidence_ids = updates.pop("resolution_evidence_ids", None)

    # Validate the String+CHECK enum columns by hand (paid uses real enums). A
    # present-but-null severity/status is ignored below — those are NOT NULL.
    if updates.get("severity") is not None and updates["severity"] not in POOLED_FINDING_SEVERITIES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="VALIDATION_ERROR"
        )
    if updates.get("status") is not None and updates["status"] not in POOLED_FINDING_STATUSES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="VALIDATION_ERROR"
        )
    # A non-null assignee must be a project participant (clean 422, not an FK
    # 500); an explicit null clears the assignment with no check.
    if updates.get("assigned_to_user_id") is not None:
        await assert_assignee_is_participant(
            document.pooled_project_id, updates["assigned_to_user_id"]
        )

    # title/severity/status are NOT NULL — guard against a stray explicit null;
    # assignee/deadline/note (nullable) clear when set to None.
    non_nullable = {"title", "severity", "status"}
    for field, value in updates.items():
        if value is None and field in non_nullable:
            continue
        setattr(snag, field, value)
    links_changed = bool(add_photo_ids) or bool(add_evidence_ids)
    if add_photo_ids:
        await _attach_links_to_snag(session, snag, document, add_photo_ids, "photo")
    if add_evidence_ids:
        await _attach_links_to_snag(
            session, snag, document, add_evidence_ids, "resolution_evidence"
        )
    await session.flush()
    # `updated_at` is onupdate-expired by the flush; the paid FindingRead shape
    # reads it (the old PooledFindingRead did not), so refresh it before serializing
    # or the read lazy-loads → MissingGreenlet. Reload attachment_links too when new
    # link rows were inserted, so photo_ids / resolution_evidence_ids reflect them.
    refresh_attrs = ["updated_at"]
    if links_changed:
        refresh_attrs.append("attachment_links")
    await session.refresh(snag, attribute_names=refresh_attrs)
    return _pooled_finding_to_finding(snag, document.pooled_project_id, include_photos=True)


@router.delete("/findings/{finding_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_pooled_finding(
    finding_id: UUID,
    user: User = Depends(current_verified_user),
    session: AsyncSession = Depends(get_pooled_session),
) -> None:
    snag = await _load_accessible_snag_or_404(session, finding_id)
    document = await _load_accessible_document_by_id_or_404(session, snag.pooled_document_id)
    require_pooled_write_role(await resolve_pooled_document_role(session, document, user.id))
    await session.delete(snag)
