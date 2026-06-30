"""Super-admin endpoints for the pooled FREE tier.

A "free user" is an ORG-LESS account (no non-removed `organization_members`
row); their content lives in the pooled `public.free_*` tables keyed by
`owner_user_id`. These endpoints let a platform super-admin see every free
account, how much data each has consumed (vs the quotas), and drill into one.

Like the rest of `/admin/*`, everything here runs on the SUPERUSER session
(`get_async_session`, RLS-bypassing): the listing aggregates across *all* free
users, so it cannot use a `bim_app` free session (which RLS-scopes to one user).

The free tier mirrors the paid Document → ProjectFile stack: a `PooledDocument`
(container) holds versioned `PooledProjectFile` rows. Usage mirrors the
authoritative quota in `routers/pooled_documents.py` exactly — storage = SUM of
active (`deleted_at IS NULL`) file bytes per owner; container count = active
`pooled_documents` per owner (capped by `free_max_documents_per_user`).

The list query is deliberately TWO-STEP to avoid cartesian fan-out: page the
org-less users first, then aggregate only that page's ids with one grouped
query per metric (each index-backed). A single multi-join `SUM`/`COUNT` over
`pooled_documents` x `pooled_project_files` x `pooled_findings` would multiply the totals.

Suspend/reactivate, delete (anonymize), impersonate, and account-recovery reuse
existing endpoints (`/admin/users/{id}/(de)activate`, `DELETE /users/{id}`,
`/admin/impersonate/{id}`, `/admin/users/{id}/send-password-reset` etc.).
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from redis.asyncio import Redis
from sqlalchemy import Select, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from bimdossier_api.auth import lockout
from bimdossier_api.auth.dependencies import require_superuser
from bimdossier_api.cache import get_redis_dep
from bimdossier_api.config import get_settings
from bimdossier_api.db import get_async_session
from bimdossier_api.free_limits import (
    FreeLimits,
    resolve_free_limits,
    resolve_free_limits_batch,
)
from bimdossier_api.free_usage import compute_free_usage
from bimdossier_api.models.free_document import PooledDocument
from bimdossier_api.models.free_finding import PooledFinding
from bimdossier_api.models.free_project import PooledProject
from bimdossier_api.models.free_project_file import PooledProjectFile
from bimdossier_api.models.free_project_member import PooledProjectMember
from bimdossier_api.models.free_user_limits import FreeUserLimits
from bimdossier_api.models.organization_member import (
    OrganizationMember,
    OrganizationMemberStatus,
)
from bimdossier_api.models.user import User
from bimdossier_api.pagination import (
    SortParams,
    apply_sort,
    count_query,
    set_total_count,
    sort_params,
)
from bimdossier_api.schemas.admin import (
    AdminFreeUserRead,
    AdminUserRead,
    FreeUserDetail,
    FreeUserDocumentRow,
    FreeUserLimitsRead,
    FreeUserLimitsUpdate,
    FreeUserProjectRow,
    FreeUserSharedRow,
    FreeUserSnagRow,
    FreeUserUsage,
)

router = APIRouter(prefix="/admin", tags=["admin"])

# Cap on how many of a user's snags the drill-down lists (most recent first).
_DETAIL_SNAG_LIMIT = 100


def _free_users_base(q: str | None) -> Select[Any]:
    """SELECT of org-less, non-anonymized users, optionally name/email filtered.

    Org-less = NOT EXISTS a non-removed `organization_members` row. A user whose
    only membership is `removed` is still free (and listed).
    """
    membership = (
        select(OrganizationMember.id)
        .where(
            OrganizationMember.user_id == User.id,
            OrganizationMember.status != OrganizationMemberStatus.removed,
        )
        .exists()
    )
    base = select(User).where(~membership, User.anonymized_at.is_(None))
    if q:
        like = f"%{q.lower()}%"
        base = base.where(
            or_(func.lower(User.email).like(like), func.lower(User.full_name).like(like))
        )
    return base


def _limits_read(limits: FreeLimits) -> FreeUserLimitsRead:
    """Flatten the `FreeLimits` dataclass into the API response model (effective
    caps + trial state + raw overrides + env defaults for the edit form)."""
    return FreeUserLimitsRead(
        max_projects=limits.max_projects,
        max_members_per_project=limits.max_members_per_project,
        max_documents=limits.max_documents,
        storage_max_bytes=limits.storage_max_bytes,
        account_max_age_days=limits.account_max_age_days,
        expiry_exempt=limits.expiry_exempt,
        account_expires_at=limits.account_expires_at,
        days_remaining=limits.days_remaining,
        expired=limits.is_expired,
        override_max_projects=limits.override_max_projects,
        override_max_members_per_project=limits.override_max_members_per_project,
        override_max_documents=limits.override_max_documents,
        override_storage_max_bytes=limits.override_storage_max_bytes,
        override_account_max_age_days=limits.override_account_max_age_days,
        default_max_projects=limits.default_max_projects,
        default_max_members_per_project=limits.default_max_members_per_project,
        default_max_documents=limits.default_max_documents,
        default_storage_max_bytes=limits.default_storage_max_bytes,
        default_account_max_age_days=limits.default_account_max_age_days,
    )


def _to_free_read(
    user: User, usage: FreeUserUsage, limits: FreeLimits, *, locked: bool
) -> AdminFreeUserRead:
    base = AdminUserRead.model_validate(user, from_attributes=True)
    return AdminFreeUserRead(
        **base.model_dump(), usage=usage, limits=_limits_read(limits)
    ).model_copy(update={"locked": locked})


@router.get("/users/free", response_model=list[AdminFreeUserRead])
async def list_free_users(
    response: Response,
    requester: User = Depends(require_superuser),
    session: AsyncSession = Depends(get_async_session),
    redis: Redis = Depends(get_redis_dep),
    q: str | None = None,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    sort: SortParams = Depends(sort_params),
) -> list[AdminFreeUserRead]:
    base = _free_users_base(q)
    set_total_count(response, await count_query(session, base))
    stmt = (
        apply_sort(
            base,
            sort,
            {
                "email": User.email,
                "full_name": User.full_name,
                "is_active": User.is_active,
                "is_verified": User.is_verified,
                "created_at": User.created_at,
            },
            default="email",
            default_dir="asc",
            tiebreaker=User.id,
        )
        .limit(limit)
        .offset(offset)
    )
    users = list((await session.execute(stmt)).scalars())
    settings = get_settings()
    limits_map = await resolve_free_limits_batch(users, session)
    usage = await compute_free_usage(
        session, [u.id for u in users], settings, limits_map
    )
    locked = await lockout.locked_map(redis, [u.email for u in users])
    return [
        _to_free_read(
            u, usage[u.id], limits_map[u.id], locked=locked.get(u.email, False)
        )
        for u in users
    ]


@router.get("/users/free/{user_id}", response_model=FreeUserDetail)
async def get_free_user_detail(
    user_id: UUID,
    requester: User = Depends(require_superuser),
    session: AsyncSession = Depends(get_async_session),
    redis: Redis = Depends(get_redis_dep),
) -> FreeUserDetail:
    user = await session.get(User, user_id)
    if user is None or user.anonymized_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="USER_NOT_FOUND")
    # Must be org-less to count as a free account.
    has_org = await session.scalar(
        select(OrganizationMember.id)
        .where(
            OrganizationMember.user_id == user_id,
            OrganizationMember.status != OrganizationMemberStatus.removed,
        )
        .limit(1)
    )
    if has_org is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="USER_NOT_FOUND")

    settings = get_settings()
    limits = await resolve_free_limits(user, session)
    usage = (
        await compute_free_usage(session, [user_id], settings, {user_id: limits})
    )[user_id]
    locked = (await lockout.locked_map(redis, [user.email])).get(user.email, False)
    read = _to_free_read(user, usage, limits, locked=locked)

    owned = list(
        (
            await session.execute(
                select(PooledProject)
                .where(PooledProject.owner_user_id == user_id)
                .order_by(PooledProject.created_at.desc())
            )
        ).scalars()
    )
    proj_ids = [p.id for p in owned]

    # Per-project rollups (active rows only), each its own grouped query.
    doc_count_by_project: dict[UUID, int] = {}
    snag_count_by_project: dict[UUID, int] = {}
    storage_by_project: dict[UUID, int] = {}
    if proj_ids:
        for pid, count in (
            await session.execute(
                select(PooledDocument.pooled_project_id, func.count(PooledDocument.id))
                .where(
                    PooledDocument.owner_user_id == user_id,
                    PooledDocument.pooled_project_id.in_(proj_ids),
                    PooledDocument.deleted_at.is_(None),
                )
                .group_by(PooledDocument.pooled_project_id)
            )
        ).all():
            doc_count_by_project[pid] = count
        for pid, count in (
            await session.execute(
                select(PooledDocument.pooled_project_id, func.count(PooledFinding.id))
                .join(PooledFinding, PooledFinding.pooled_document_id == PooledDocument.id)
                .where(
                    PooledFinding.owner_user_id == user_id,
                    PooledDocument.pooled_project_id.in_(proj_ids),
                )
                .group_by(PooledDocument.pooled_project_id)
            )
        ).all():
            snag_count_by_project[pid] = count
        for pid, storage in (
            await session.execute(
                select(
                    PooledDocument.pooled_project_id,
                    func.coalesce(func.sum(PooledProjectFile.size_bytes), 0),
                )
                .join(PooledProjectFile, PooledProjectFile.pooled_document_id == PooledDocument.id)
                .where(
                    PooledProjectFile.owner_user_id == user_id,
                    PooledProjectFile.deleted_at.is_(None),
                    PooledDocument.pooled_project_id.in_(proj_ids),
                )
                .group_by(PooledDocument.pooled_project_id)
            )
        ).all():
            storage_by_project[pid] = int(storage or 0)

    projects = [
        FreeUserProjectRow(
            id=p.id,
            name=p.name,
            created_at=p.created_at,
            document_count=doc_count_by_project.get(p.id, 0),
            snag_count=snag_count_by_project.get(p.id, 0),
            storage_bytes=storage_by_project.get(p.id, 0),
        )
        for p in owned
    ]

    # Owned containers + per-container file count / byte rollup (active rows).
    documents = list(
        (
            await session.execute(
                select(PooledDocument)
                .where(
                    PooledDocument.owner_user_id == user_id,
                    PooledDocument.deleted_at.is_(None),
                )
                .order_by(PooledDocument.created_at.desc())
            )
        ).scalars()
    )
    doc_ids = [d.id for d in documents]
    file_rollup: dict[UUID, tuple[int, int]] = {}
    if doc_ids:
        for did, count, storage in (
            await session.execute(
                select(
                    PooledProjectFile.pooled_document_id,
                    func.count(PooledProjectFile.id),
                    func.coalesce(func.sum(PooledProjectFile.size_bytes), 0),
                )
                .where(
                    PooledProjectFile.pooled_document_id.in_(doc_ids),
                    PooledProjectFile.deleted_at.is_(None),
                )
                .group_by(PooledProjectFile.pooled_document_id)
            )
        ).all():
            file_rollup[did] = (count, int(storage or 0))

    document_rows = [
        FreeUserDocumentRow(
            id=d.id,
            name=d.name,
            status=d.status,
            discipline=d.discipline,
            file_count=file_rollup.get(d.id, (0, 0))[0],
            size_bytes=file_rollup.get(d.id, (0, 0))[1],
            last_viewed_at=d.last_viewed_at,
            pooled_project_id=d.pooled_project_id,
        )
        for d in documents
    ]

    snags = list(
        (
            await session.execute(
                select(PooledFinding)
                .where(PooledFinding.owner_user_id == user_id)
                .order_by(PooledFinding.created_at.desc())
                .limit(_DETAIL_SNAG_LIMIT)
            )
        ).scalars()
    )
    shared = (
        await session.execute(
            select(
                PooledProject.id,
                PooledProject.name,
                User.email,
                PooledProjectMember.role,
            )
            .join(PooledProjectMember, PooledProjectMember.pooled_project_id == PooledProject.id)
            .join(User, User.id == PooledProject.owner_user_id)
            .where(PooledProjectMember.user_id == user_id)
            .order_by(PooledProject.created_at.desc())
        )
    ).all()

    return FreeUserDetail(
        user=read,
        projects=projects,
        documents=document_rows,
        snags=[FreeUserSnagRow.model_validate(s, from_attributes=True) for s in snags],
        shared_projects=[
            FreeUserSharedRow(
                pooled_project_id=pid, name=name, owner_email=email, role=role
            )
            for pid, name, email, role in shared
        ],
    )


@router.patch("/users/free/{user_id}/limits", response_model=AdminFreeUserRead)
async def update_free_user_limits(
    user_id: UUID,
    payload: FreeUserLimitsUpdate,
    requester: User = Depends(require_superuser),
    session: AsyncSession = Depends(get_async_session),
    redis: Redis = Depends(get_redis_dep),
) -> AdminFreeUserRead:
    """Set a free user's per-user limit overrides + trial exemption (full-replace).

    A null numeric field CLEARS the override (the account falls back to the env
    default); a positive int overrides it. `expiry_exempt=true` makes the account
    permanently free. Returns the refreshed free-user row so the panel updates in
    place. Super-admin only; 404 USER_NOT_FOUND if the target isn't a live
    org-less account (mirrors the detail guard)."""
    user = await session.get(User, user_id)
    if user is None or user.anonymized_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="USER_NOT_FOUND")
    has_org = await session.scalar(
        select(OrganizationMember.id)
        .where(
            OrganizationMember.user_id == user_id,
            OrganizationMember.status != OrganizationMemberStatus.removed,
        )
        .limit(1)
    )
    if has_org is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="USER_NOT_FOUND")

    row = await session.get(FreeUserLimits, user_id)
    if row is None:
        row = FreeUserLimits(user_id=user_id)
        session.add(row)
    row.max_projects = payload.max_projects
    row.max_members_per_project = payload.max_members_per_project
    row.max_documents = payload.max_documents
    row.storage_max_bytes = payload.storage_max_bytes
    row.account_max_age_days = payload.account_max_age_days
    row.expiry_exempt = payload.expiry_exempt
    row.updated_by_user_id = requester.id
    await session.flush()

    settings = get_settings()
    limits = await resolve_free_limits(user, session)
    usage = (
        await compute_free_usage(session, [user_id], settings, {user_id: limits})
    )[user_id]
    locked = (await lockout.locked_map(redis, [user.email])).get(user.email, False)
    read = _to_free_read(user, usage, limits, locked=locked)
    await session.commit()
    return read
