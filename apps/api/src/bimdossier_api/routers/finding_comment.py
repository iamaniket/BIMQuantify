"""Finding discussion comments — flat, chronological thread per finding.

A sibling of the BCF comment endpoints (``routers/bcf/comments.py``), gated on
the ``Resource.finding`` permission matrix (no new ``Resource`` value, so the
matrix and the portal ``can()`` are untouched). Reuses the project-scoped access
factories in ``access.py`` instead of hand-copying the membership/permission
block.

@mentions: the composer embeds ``@[Display Name](user_id)`` tokens in the
comment text. On write the server parses those ids, keeps only the ones that are
project members (the security boundary — you can't notify or probe membership of
an outsider), records them in ``finding_comment_mentions``, and emits a
*targeted* ``finding_mentioned`` notification to each newly-mentioned member
(never the author, never an already-mentioned member on edit).
"""

import re
from collections import defaultdict
from datetime import UTC, datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from bimdossier_api import audit
from bimdossier_api.access import (
    ResourceAccess,
    load_project_or_404,
    require_membership,
    require_project_view,
    require_project_writable,
    require_resource,
)
from bimdossier_api.auth.fastapi_users import current_verified_user
from bimdossier_api.auth.permissions import Action, Resource, require_permission
from bimdossier_api.i18n import resolve_org_locale, t
from bimdossier_api.models.finding_comment import FindingComment, FindingCommentMention
from bimdossier_api.models.notification import NotificationEventType
from bimdossier_api.models.project import Project
from bimdossier_api.models.project_member import ProjectMember
from bimdossier_api.models.user import User
from bimdossier_api.notifications.service import (
    create_notification,
    publish_notification,
)
from bimdossier_api.routers.bcf._shared import _user_display_name
from bimdossier_api.routers.finding import _load_finding_or_404
from bimdossier_api.schemas.finding_comment import (
    FindingCommentCreate,
    FindingCommentRead,
    FindingCommentUpdate,
    MentionedUser,
)
from bimdossier_api.tenancy import get_tenant_session, require_active_organization

router = APIRouter(
    prefix="/projects/{project_id}/findings/{finding_id}/comments",
    tags=["finding-comments"],
)

# `@[Display Name](user_id)` — a mention token the composer inserts. The display
# name is free text (no `]`); the captured group is a canonical UUID.
_MENTION_RE = re.compile(r"@\[[^\]]+\]\(([0-9a-fA-F-]{36})\)")


def _extract_mention_ids(text_value: str) -> set[UUID]:
    """Parse the unique, well-formed user ids out of the mention tokens."""
    ids: set[UUID] = set()
    for raw in _MENTION_RE.findall(text_value):
        try:
            ids.add(UUID(raw))
        except ValueError:
            continue
    return ids


async def _resolve_mention_targets(
    session: AsyncSession, project_id: UUID, candidate_ids: set[UUID]
) -> list[tuple[UUID, str | None]]:
    """Keep only the candidate ids that are members of this project, with their
    display names. Non-members are dropped — the mention security boundary."""
    if not candidate_ids:
        return []
    # Select the User entity (not bare `User.email`/`full_name`): the FastAPI-
    # Users base types those as plain str, which won't satisfy select()'s typed
    # overloads — read them off the instance, like get_finding_history does.
    rows = (
        await session.execute(
            select(ProjectMember.user_id, User)
            .join(User, ProjectMember.user_id == User.id)
            .where(
                ProjectMember.project_id == project_id,
                ProjectMember.user_id.in_(candidate_ids),
            )
        )
    ).all()
    return [(uid, member.full_name or member.email) for uid, member in rows]


async def _sync_mentions(
    session: AsyncSession,
    *,
    comment_id: UUID,
    project_id: UUID,
    raw_ids: set[UUID],
    author_user_id: UUID,
) -> tuple[set[UUID], list[MentionedUser]]:
    """Reconcile a comment's mention link rows to the validated target set.

    Returns ``(notify_ids, mentions)`` where ``notify_ids`` is the set of
    *newly added* members to ping (excluding the author) and ``mentions`` is the
    full current target list for the response. Idempotent on edits — only the
    delta is added/removed and only genuinely-new mentions are notified.
    """
    targets = await _resolve_mention_targets(session, project_id, raw_ids)
    valid_ids = {uid for uid, _ in targets}

    existing = set(
        (
            await session.execute(
                select(FindingCommentMention.user_id).where(
                    FindingCommentMention.comment_id == comment_id
                )
            )
        )
        .scalars()
        .all()
    )
    to_add = valid_ids - existing
    to_remove = existing - valid_ids

    if to_add:
        # ON CONFLICT DO NOTHING (M-con4): two writers that both read an empty
        # `existing` and both compute the same `to_add` would otherwise collide
        # on the (comment_id, user_id) primary key and 500 one of them. The
        # composite PK makes the insert naturally idempotent under conflict.
        # (Today the always-dirty `modified_date` UPDATE on the comment row
        # serializes concurrent edits of one comment, masking this race — this
        # is defence-in-depth so a future refactor of that path can't unmask it.)
        await session.execute(
            pg_insert(FindingCommentMention)
            .values([{"comment_id": comment_id, "user_id": uid} for uid in to_add])
            .on_conflict_do_nothing(index_elements=["comment_id", "user_id"])
        )
    if to_remove:
        await session.execute(
            delete(FindingCommentMention).where(
                FindingCommentMention.comment_id == comment_id,
                FindingCommentMention.user_id.in_(to_remove),
            )
        )
    await session.flush()

    mentions = [MentionedUser(user_id=uid, name=name) for uid, name in targets]
    return to_add - {author_user_id}, mentions


async def _notify_mentions(
    session: AsyncSession,
    *,
    project: Project,
    organization_id: UUID,
    finding_title: str,
    notify_ids: set[UUID],
) -> None:
    """Emit one targeted `finding_mentioned` notification per newly-mentioned
    member. Project-scoped locale (no single recipient locale primitive)."""
    if not notify_ids:
        return
    locale = resolve_org_locale(project.country)
    title = t("notifications.finding_mentioned.title", locale)
    body = t("notifications.finding_mentioned.body", locale, title=finding_title)
    for uid in notify_ids:
        notification = await create_notification(
            session,
            event_type=NotificationEventType.finding_mentioned,
            title=title,
            body=body,
            project_id=project.id,
            recipient_user_id=uid,
        )
        # Publish on write (M-en1) so the @mentioned member's live stream pings
        # immediately, not only on a later refetch. recipient_user_id scopes the
        # manager fan-out to that user's sockets. Best-effort (swallows Redis errs).
        await publish_notification(notification, organization_id=organization_id)


async def _load_comment_or_404(
    session: AsyncSession, finding_id: UUID, comment_id: UUID
) -> FindingComment:
    """Load a live (non-deleted) comment on the given finding, or 404."""
    comment = (
        await session.execute(
            select(FindingComment).where(
                FindingComment.id == comment_id,
                FindingComment.finding_id == finding_id,
                FindingComment.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if comment is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="FINDING_COMMENT_NOT_FOUND"
        )
    return comment


def _comment_to_read(
    comment: FindingComment,
    *,
    actor_name: str | None,
    actor_email: str | None,
    mentions: list[MentionedUser],
) -> FindingCommentRead:
    return FindingCommentRead(
        id=comment.id,
        finding_id=comment.finding_id,
        comment_text=comment.comment_text,
        author=comment.author,
        date=comment.date,
        modified_author=comment.modified_author,
        modified_date=comment.modified_date,
        created_by_user_id=comment.created_by_user_id,
        actor_name=actor_name,
        actor_email=actor_email,
        mentions=mentions,
        created_at=comment.created_at,
        updated_at=comment.updated_at,
    )


# ---------------------------------------------------------------------------
# CRUD
# ---------------------------------------------------------------------------


@router.get("", response_model=list[FindingCommentRead])
async def list_comments(
    finding_id: UUID,
    access: ResourceAccess = Depends(require_project_view()),
    session: AsyncSession = Depends(get_tenant_session),
) -> list[FindingCommentRead]:
    """Chronological discussion thread for one finding (oldest first).

    Read-gated like the finding history — any project member (viewer, client,
    inspector, contractor) sees the thread. Deleted comments are hidden."""
    project = access.project
    await _load_finding_or_404(session, project.id, finding_id)

    rows = (
        await session.execute(
            select(FindingComment, User)
            .outerjoin(User, FindingComment.created_by_user_id == User.id)
            .where(
                FindingComment.finding_id == finding_id,
                FindingComment.deleted_at.is_(None),
            )
            .order_by(FindingComment.date.asc())
        )
    ).all()

    comment_ids = [comment.id for comment, _ in rows]
    mentions_by_comment: dict[UUID, list[MentionedUser]] = defaultdict(list)
    if comment_ids:
        mention_rows = (
            await session.execute(
                select(FindingCommentMention.comment_id, User)
                .join(User, FindingCommentMention.user_id == User.id)
                .where(FindingCommentMention.comment_id.in_(comment_ids))
            )
        ).all()
        for cid, member in mention_rows:
            mentions_by_comment[cid].append(
                MentionedUser(user_id=member.id, name=member.full_name or member.email)
            )

    return [
        _comment_to_read(
            comment,
            actor_name=actor.full_name if actor else None,
            actor_email=actor.email if actor else None,
            mentions=mentions_by_comment.get(comment.id, []),
        )
        for comment, actor in rows
    ]


@router.post("", response_model=FindingCommentRead, status_code=status.HTTP_201_CREATED)
async def create_comment(
    finding_id: UUID,
    payload: FindingCommentCreate,
    request: Request,
    access: ResourceAccess = Depends(require_resource(Resource.finding, Action.create)),
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> FindingCommentRead:
    project = access.project
    finding = await _load_finding_or_404(session, project.id, finding_id)

    now = datetime.now(UTC)
    comment = FindingComment(
        finding_id=finding.id,
        comment_text=payload.text.strip(),
        author=_user_display_name(user),
        date=now,
        created_by_user_id=user.id,
    )
    session.add(comment)
    await session.flush()
    # Repopulate server-default timestamps before they're read into the
    # response (async ORM can't lazily refresh expired attrs — MissingGreenlet).
    await session.refresh(comment)

    notify_ids, mentions = await _sync_mentions(
        session,
        comment_id=comment.id,
        project_id=project.id,
        raw_ids=_extract_mention_ids(comment.comment_text),
        author_user_id=user.id,
    )

    await audit.record(
        session,
        action="finding_comment.created",
        resource_type="finding_comment",
        resource_id=comment.id,
        after={"finding_id": str(finding.id), "comment_text": comment.comment_text[:500]},
        actor_user_id=user.id,
        project_id=project.id,
        request=request,
    )
    await _notify_mentions(
        session,
        project=project,
        organization_id=active_org_id,
        finding_title=finding.title,
        notify_ids=notify_ids,
    )

    return _comment_to_read(
        comment,
        actor_name=user.full_name,
        actor_email=user.email,
        mentions=mentions,
    )


@router.patch("/{comment_id}", response_model=FindingCommentRead)
async def update_comment(
    finding_id: UUID,
    comment_id: UUID,
    payload: FindingCommentUpdate,
    request: Request,
    access: ResourceAccess = Depends(require_resource(Resource.finding, Action.update)),
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> FindingCommentRead:
    project = access.project
    finding = await _load_finding_or_404(session, project.id, finding_id)
    comment = await _load_comment_or_404(session, finding_id, comment_id)

    # A comment is an attributed statement of record — only its author rewords
    # it (even an owner can't edit someone else's).
    if comment.created_by_user_id != user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="FINDING_COMMENT_NOT_AUTHOR"
        )

    before_text = comment.comment_text
    now = datetime.now(UTC)
    comment.comment_text = payload.text.strip()
    comment.modified_author = _user_display_name(user)
    comment.modified_date = now
    await session.flush()
    # `updated_at` (onupdate) is expired by the UPDATE — refresh before reading.
    await session.refresh(comment)

    notify_ids, mentions = await _sync_mentions(
        session,
        comment_id=comment.id,
        project_id=project.id,
        raw_ids=_extract_mention_ids(comment.comment_text),
        author_user_id=user.id,
    )

    await audit.record(
        session,
        action="finding_comment.updated",
        resource_type="finding_comment",
        resource_id=comment.id,
        before={"comment_text": before_text[:500]},
        after={"comment_text": comment.comment_text[:500]},
        actor_user_id=user.id,
        project_id=project.id,
        request=request,
    )
    # Pull in only members newly mentioned by this edit.
    await _notify_mentions(
        session,
        project=project,
        organization_id=active_org_id,
        finding_title=finding.title,
        notify_ids=notify_ids,
    )

    return _comment_to_read(
        comment,
        actor_name=user.full_name,
        actor_email=user.email,
        mentions=mentions,
    )


@router.delete("/{comment_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_comment(
    project_id: UUID,
    finding_id: UUID,
    comment_id: UUID,
    request: Request,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> Response:
    # Custom gate: the author retracts their own comment; an owner/editor
    # (Resource.finding delete) moderates anyone's. Can't use require_resource —
    # it would demand the delete permission for the author too.
    project = await load_project_or_404(session, project_id)
    membership = await require_membership(session, project.id, user.id)
    require_project_writable(project)
    await _load_finding_or_404(session, project.id, finding_id)
    comment = await _load_comment_or_404(session, finding_id, comment_id)

    if comment.created_by_user_id != user.id:
        try:
            require_permission(membership.role, Resource.finding, Action.delete)
        except HTTPException:
            await audit.log_permission_denied(
                role=membership.role.value,
                resource=Resource.finding.value,
                action=Action.delete.value,
                actor_user_id=user.id,
                resource_id=comment_id,
                request=request,
            )
            raise

    comment.soft_delete()
    await session.flush()
    await audit.record(
        session,
        action="finding_comment.deleted",
        resource_type="finding_comment",
        resource_id=comment.id,
        before={"finding_id": str(comment.finding_id), "comment_text": comment.comment_text[:500]},
        actor_user_id=user.id,
        project_id=project.id,
        request=request,
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


__all__ = ["router"]
