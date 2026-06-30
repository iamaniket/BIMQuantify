"""Free-tier usage computation shared by the super-admin listing and the
self-serve account endpoint.

A "free user" is an ORG-LESS account whose content lives in the pooled
`public.free_*` tables keyed by `owner_user_id`. `compute_free_usage` rolls up a
user's data footprint (storage / projects / containers / snags) against the
quotas in `config.py`.

The computation is OWNER-keyed (the free quota model) and mirrors the
authoritative quota filters in `routers/pooled_documents.py` exactly: storage =
SUM of active (`deleted_at IS NULL`) file + attachment bytes per owner; container count =
active `pooled_documents` per owner. It runs ONE grouped query per metric (each
index-backed) so a multi-id request can't fan out cartesian-style across
`pooled_documents`, `pooled_project_files`, and `pooled_findings`.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import func, select

from bimdossier_api.models.free_attachment import PooledAttachment
from bimdossier_api.models.free_document import PooledDocument
from bimdossier_api.models.free_finding import PooledFinding
from bimdossier_api.models.free_project import PooledProject
from bimdossier_api.models.free_project_file import PooledProjectFile
from bimdossier_api.models.free_project_member import PooledProjectMember
from bimdossier_api.schemas.admin import FreeUserUsage

if TYPE_CHECKING:
    from datetime import datetime
    from uuid import UUID

    from sqlalchemy.ext.asyncio import AsyncSession

    from bimdossier_api.config import Settings
    from bimdossier_api.free_limits import FreeLimits


def _max_dt(*values: datetime | None) -> datetime | None:
    """Latest of the given timestamps, ignoring None (None if all are None)."""
    present = [v for v in values if v is not None]
    return max(present) if present else None


async def compute_free_usage(
    session: AsyncSession,
    user_ids: list[UUID],
    settings: Settings,
    limits_by_user: dict[UUID, FreeLimits] | None = None,
) -> dict[UUID, FreeUserUsage]:
    """Per-user free-tier usage for the given ids, computed with one grouped
    query per metric (no cross-relation fan-out). Returns a `FreeUserUsage` for
    every requested id (zeros for users with no free content). Mirrors the
    quota filters in `pooled_documents.py` (active rows only).

    Caps default to the global env settings; pass `limits_by_user`
    (`free_limits.resolve_free_limits_batch`) to surface a user's EFFECTIVE caps
    (per-admin override ?? default) so the UI shows the real thresholds."""
    if not user_ids:
        return {}

    storage: dict[UUID, int] = {}
    documents: dict[UUID, int] = {}
    projects: dict[UUID, int] = {}
    first_activity: dict[UUID, datetime | None] = {}
    snags: dict[UUID, int] = {}
    member_of: dict[UUID, int] = {}
    # Per-source "last touched" timestamps, combined into `last_activity_at`
    # below. Each is the MAX of an existing grouped query (no extra round-trip).
    file_activity: dict[UUID, datetime | None] = {}
    doc_viewed: dict[UUID, datetime | None] = {}
    doc_activity: dict[UUID, datetime | None] = {}
    proj_activity: dict[UUID, datetime | None] = {}
    snag_activity: dict[UUID, datetime | None] = {}

    # Storage = SUM of active file bytes per owner (deleted versions excluded);
    # also the latest file edit (new-version upload bumps `updated_at`).
    for uid, total, last_edit in (
        await session.execute(
            select(
                PooledProjectFile.owner_user_id,
                func.coalesce(func.sum(PooledProjectFile.size_bytes), 0),
                func.max(PooledProjectFile.updated_at),
            )
            .where(
                PooledProjectFile.owner_user_id.in_(user_ids),
                PooledProjectFile.deleted_at.is_(None),
            )
            .group_by(PooledProjectFile.owner_user_id)
        )
    ).all():
        storage[uid] = int(total or 0)
        file_activity[uid] = last_edit

    # Attachment (photo/evidence) bytes count toward the storage footprint too
    # (FSL-1), so the cap and the displayed usage stay consistent with the gate.
    for uid, total in (
        await session.execute(
            select(
                PooledAttachment.owner_user_id,
                func.coalesce(func.sum(PooledAttachment.size_bytes), 0),
            )
            .where(
                PooledAttachment.owner_user_id.in_(user_ids),
                PooledAttachment.deleted_at.is_(None),
            )
            .group_by(PooledAttachment.owner_user_id)
        )
    ).all():
        storage[uid] = storage.get(uid, 0) + int(total or 0)

    # Containers = active pooled_documents per owner + last view + last edit.
    for uid, count, last_viewed, last_edit in (
        await session.execute(
            select(
                PooledDocument.owner_user_id,
                func.count(PooledDocument.id),
                func.max(PooledDocument.last_viewed_at),
                func.max(PooledDocument.updated_at),
            )
            .where(
                PooledDocument.owner_user_id.in_(user_ids),
                PooledDocument.deleted_at.is_(None),
            )
            .group_by(PooledDocument.owner_user_id)
        )
    ).all():
        documents[uid] = count
        doc_viewed[uid] = last_viewed
        doc_activity[uid] = last_edit

    for uid, count, first_created, last_edit in (
        await session.execute(
            select(
                PooledProject.owner_user_id,
                func.count(PooledProject.id),
                func.min(PooledProject.created_at),
                func.max(PooledProject.updated_at),
            )
            .where(PooledProject.owner_user_id.in_(user_ids))
            .group_by(PooledProject.owner_user_id)
        )
    ).all():
        projects[uid] = count
        first_activity[uid] = first_created
        proj_activity[uid] = last_edit

    for uid, count, last_edit in (
        await session.execute(
            select(
                PooledFinding.owner_user_id,
                func.count(PooledFinding.id),
                func.max(PooledFinding.updated_at),
            )
            .where(PooledFinding.owner_user_id.in_(user_ids))
            .group_by(PooledFinding.owner_user_id)
        )
    ).all():
        snags[uid] = count
        snag_activity[uid] = last_edit

    for uid, count in (
        await session.execute(
            select(PooledProjectMember.user_id, func.count())
            .where(PooledProjectMember.user_id.in_(user_ids))
            .group_by(PooledProjectMember.user_id)
        )
    ).all():
        member_of[uid] = count

    limits_map = limits_by_user or {}

    def _cap(uid: UUID, attr: str, default: int) -> int:
        lim = limits_map.get(uid)
        return getattr(lim, attr) if lim is not None else default

    return {
        uid: FreeUserUsage(
            storage_bytes_used=storage.get(uid, 0),
            storage_bytes_cap=_cap(uid, "storage_max_bytes", settings.free_storage_max_bytes),
            project_count=projects.get(uid, 0),
            project_cap=_cap(uid, "max_projects", settings.free_max_projects_per_user),
            document_count=documents.get(uid, 0),
            document_cap=_cap(uid, "max_documents", settings.free_max_documents_per_user),
            member_cap=_cap(
                uid, "max_members_per_project", settings.free_max_members_per_project
            ),
            snag_count=snags.get(uid, 0),
            member_of_count=member_of.get(uid, 0),
            last_activity_at=_max_dt(
                file_activity.get(uid),
                doc_viewed.get(uid),
                doc_activity.get(uid),
                proj_activity.get(uid),
                snag_activity.get(uid),
            ),
            first_activity_at=first_activity.get(uid),
        )
        for uid in user_ids
    }
