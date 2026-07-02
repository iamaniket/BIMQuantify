"""Effective free-tier limits + trial-window resolution.

The single source of truth for "what are THIS user's free caps, and is their
trial over?". It folds the global env defaults (`config.Settings.free_*`) with the
optional per-user overrides in `public.free_user_limits`, and derives the trial
state from `users.created_at`.

`free_user_limits` is control-plane data with no `bim_app` grant (see the model
docstring), so the resolver reads it on a SUPERUSER session: callers that already
hold one (the admin endpoints) pass it in; callers in a pooled free-session
context (the enforcement sites / expiry gate) let `resolve_free_limits` open its
own short superuser probe — the same pattern as
`free_access.user_has_org_membership`.

This module is pure data (no FastAPI): the HTTP gates that raise 403 live in
`routers/free_access.py`.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING

from sqlalchemy import select

from bimdossier_api.config import Settings, get_settings
from bimdossier_api.db import get_session_maker
from bimdossier_api.models.free_user_limits import FreeUserLimits

if TYPE_CHECKING:
    from uuid import UUID

    from sqlalchemy.ext.asyncio import AsyncSession

    from bimdossier_api.models.user import User


@dataclass(frozen=True)
class FreeLimits:
    """A free user's effective caps + trial state, plus the raw overrides and
    env defaults the admin edit form needs."""

    # Effective (override ?? default) caps.
    max_projects: int
    max_members_per_project: int
    max_documents: int
    storage_max_bytes: int
    max_findings: int
    account_max_age_days: int
    expiry_exempt: bool

    # Trial state, anchored on `users.created_at`.
    account_created_at: datetime
    account_expires_at: datetime | None  # None when exempt (never expires)
    is_expired: bool
    days_remaining: int | None  # None when exempt; else >=0 (0 once expired)

    # Raw per-user overrides (None = falling back to the default) — lets the admin
    # form show which knobs are customised and pre-fill them.
    override_max_projects: int | None
    override_max_members_per_project: int | None
    override_max_documents: int | None
    override_storage_max_bytes: int | None
    override_max_findings: int | None
    override_account_max_age_days: int | None

    # Global env defaults (so the form can render "default: N" next to each input).
    default_max_projects: int
    default_max_members_per_project: int
    default_max_documents: int
    default_storage_max_bytes: int
    default_max_findings: int
    default_account_max_age_days: int


def _utcnow() -> datetime:
    return datetime.now(UTC)


def _build_limits(
    user: User, row: FreeUserLimits | None, settings: Settings, now: datetime
) -> FreeLimits:
    o_projects = row.max_projects if row is not None else None
    o_members = row.max_members_per_project if row is not None else None
    o_documents = row.max_documents if row is not None else None
    o_storage = row.storage_max_bytes if row is not None else None
    o_findings = row.max_findings if row is not None else None
    o_age = row.account_max_age_days if row is not None else None
    exempt = bool(row.expiry_exempt) if row is not None else False

    age_days = o_age if o_age is not None else settings.free_account_max_age_days
    created = user.created_at
    # `users.created_at` is `timezone=True`, but a row materialised in some test
    # paths can be naive — normalise so the comparison never raises.
    if created.tzinfo is None:
        created = created.replace(tzinfo=UTC)

    if exempt:
        expires_at: datetime | None = None
        is_expired = False
        days_remaining: int | None = None
    else:
        expires_at = created + timedelta(days=age_days)
        is_expired = now >= expires_at
        remaining = expires_at - now
        days_remaining = max(0, math.ceil(remaining.total_seconds() / 86400))

    return FreeLimits(
        max_projects=o_projects
        if o_projects is not None
        else settings.free_max_projects_per_user,
        max_members_per_project=o_members
        if o_members is not None
        else settings.free_max_members_per_project,
        max_documents=o_documents
        if o_documents is not None
        else settings.free_max_documents_per_user,
        storage_max_bytes=o_storage
        if o_storage is not None
        else settings.free_storage_max_bytes,
        max_findings=o_findings
        if o_findings is not None
        else settings.free_max_findings_per_user,
        account_max_age_days=age_days,
        expiry_exempt=exempt,
        account_created_at=created,
        account_expires_at=expires_at,
        is_expired=is_expired,
        days_remaining=days_remaining,
        override_max_projects=o_projects,
        override_max_members_per_project=o_members,
        override_max_documents=o_documents,
        override_storage_max_bytes=o_storage,
        override_max_findings=o_findings,
        override_account_max_age_days=o_age,
        default_max_projects=settings.free_max_projects_per_user,
        default_max_members_per_project=settings.free_max_members_per_project,
        default_max_documents=settings.free_max_documents_per_user,
        default_storage_max_bytes=settings.free_storage_max_bytes,
        default_max_findings=settings.free_max_findings_per_user,
        default_account_max_age_days=settings.free_account_max_age_days,
    )


async def resolve_free_limits(
    user: User, session: AsyncSession | None = None
) -> FreeLimits:
    """Effective limits + trial state for one user.

    Pass a SUPERUSER `session` to reuse it (admin paths); omit it in a pooled
    free-session context and the resolver opens its own short superuser probe
    (the `free_user_limits` table has no `bim_app` grant)."""
    settings = get_settings()
    if session is not None:
        row = await session.get(FreeUserLimits, user.id)
    else:
        async with get_session_maker()() as probe, probe.begin():
            row = await probe.get(FreeUserLimits, user.id)
    return _build_limits(user, row, settings, _utcnow())


async def resolve_owner_finding_cap(
    session: AsyncSession, owner_id: UUID, settings: Settings
) -> int:
    """Effective LIFETIME findings cap for a project OWNER (override ?? default).

    The cap belongs to the owner, not the caller — a member filing a snag spends
    the owner's quota. `session` MUST be a superuser probe (`free_user_limits`
    has no `bim_app` grant); a PK get keyed on the owner satisfies the
    owner-predicate hard rule for superuser pooled probes."""
    row = await session.get(FreeUserLimits, owner_id)
    if row is not None and row.max_findings is not None:
        return row.max_findings
    return settings.free_max_findings_per_user


async def resolve_free_limits_batch(
    users: list[User], session: AsyncSession
) -> dict[UUID, FreeLimits]:
    """Effective limits for many users in one query. `session` MUST be a
    superuser session (the admin listing already holds one)."""
    settings = get_settings()
    now = _utcnow()
    rows: dict[UUID, FreeUserLimits] = {}
    ids = [u.id for u in users]
    if ids:
        for row in (
            await session.scalars(
                select(FreeUserLimits).where(FreeUserLimits.user_id.in_(ids))
            )
        ).all():
            rows[row.user_id] = row
    return {u.id: _build_limits(u, rows.get(u.id), settings, now) for u in users}
