"""Deadline notification settings endpoints.

Org-level defaults:
    GET  /deadline-notification-settings
    PATCH /deadline-notification-settings/{deadline_type}

Project-level overrides:
    GET    /projects/{project_id}/deadline-notification-settings
    PUT    /projects/{project_id}/deadline-notification-settings/{deadline_type}
    DELETE /projects/{project_id}/deadline-notification-settings/{deadline_type}
"""

from __future__ import annotations

from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from bimdossier_api.access import (
    is_org_admin,
    load_project_or_404,
    require_membership,
    require_project_read_access,
)
from bimdossier_api.auth.fastapi_users import current_verified_user
from bimdossier_api.auth.permissions import Action, Resource, require_permission
from bimdossier_api.deadlines.settings import (
    get_all_effective_settings,
    get_effective_settings,
)
from bimdossier_api.jurisdictions import get_deadline_rules
from bimdossier_api.models.deadline_notification_settings import (
    DeadlineNotificationSettings,
)
from bimdossier_api.models.user import User
from bimdossier_api.schemas.deadline_notification_settings import (
    DeadlineNotificationSettingsUpdate,
    EffectiveDeadlineNotificationSettings,
)
from bimdossier_api.tenancy import get_tenant_session, require_active_organization

# ---------------------------------------------------------------------------
# Org-level defaults
# ---------------------------------------------------------------------------

org_router = APIRouter(
    prefix="/deadline-notification-settings",
    tags=["deadline-notification-settings"],
)


async def _require_org_admin(session: AsyncSession, user: User, organization_id: UUID) -> None:
    """Raise 403 if the caller is neither a superuser nor an org admin."""
    if user.is_superuser:
        return
    if await is_org_admin(session, user.id, organization_id):
        return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="ORG_ADMIN_REQUIRED",
    )


def _country_for_org() -> str:
    """Default country for org-level settings.

    Org-level defaults are country-scoped by convention. For now the
    platform only supports NL, so we hardcode the country. When multi-
    country orgs become real, this will need to come from the org row or
    a query param.
    """
    return "NL"


@org_router.get("", response_model=list[EffectiveDeadlineNotificationSettings])
async def list_org_defaults(
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
    locale: str = Query("en", max_length=10),
) -> list[EffectiveDeadlineNotificationSettings]:
    """Return effective notification settings per deadline type (org scope).

    Falls back to jurisdiction defaults where no DB row exists.
    Requires org admin.
    """
    await _require_org_admin(session, user, active_org_id)
    country = _country_for_org()
    return await get_all_effective_settings(session, None, country, locale)


@org_router.patch(
    "/{deadline_type}",
    response_model=EffectiveDeadlineNotificationSettings,
)
async def update_org_default(
    deadline_type: str,
    payload: DeadlineNotificationSettingsUpdate,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
    locale: str = Query("en", max_length=10),
) -> EffectiveDeadlineNotificationSettings:
    """Create or update the org-default row for a deadline type."""
    await _require_org_admin(session, user, active_org_id)
    country = _country_for_org()

    # Validate the deadline_type is known.
    rules = get_deadline_rules(country)
    rule = next((r for r in rules if r.deadline_type == deadline_type), None)
    if rule is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="UNKNOWN_DEADLINE_TYPE",
        )

    # Load or create the org-default row (project_id IS NULL).
    existing = (
        await session.execute(
            select(DeadlineNotificationSettings).where(
                DeadlineNotificationSettings.project_id.is_(None),
                DeadlineNotificationSettings.deadline_type == deadline_type,
            )
        )
    ).scalar_one_or_none()

    if existing is None:
        existing = DeadlineNotificationSettings(
            id=uuid4(),
            project_id=None,
            deadline_type=deadline_type,
            reminder_days=list(rule.default_reminder_days),
            recipient_roles=list(rule.default_recipient_roles),
            enabled=True,
        )
        session.add(existing)

    # Apply partial updates.
    if payload.reminder_days is not None:
        existing.reminder_days = payload.reminder_days
    if payload.recipient_roles is not None:
        existing.recipient_roles = payload.recipient_roles
    if payload.enabled is not None:
        existing.enabled = payload.enabled

    await session.flush()

    # Return the effective view.
    effective = await get_effective_settings(session, None, deadline_type, country, locale)
    assert effective is not None
    return effective


# ---------------------------------------------------------------------------
# Project-level overrides
# ---------------------------------------------------------------------------

project_router = APIRouter(
    prefix="/projects/{project_id}/deadline-notification-settings",
    tags=["deadline-notification-settings"],
)


@project_router.get("", response_model=list[EffectiveDeadlineNotificationSettings])
async def list_project_settings(
    project_id: UUID,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
    locale: str = Query("en", max_length=10),
) -> list[EffectiveDeadlineNotificationSettings]:
    """Return effective settings per deadline type for a project.

    Merges: project override -> org default -> jurisdiction default.
    Requires project read access.
    """
    project = await load_project_or_404(session, project_id)
    await require_project_read_access(session, project.id, user, active_org_id)
    return await get_all_effective_settings(session, project.id, project.country, locale)


@project_router.put(
    "/{deadline_type}",
    response_model=EffectiveDeadlineNotificationSettings,
)
async def upsert_project_setting(
    project_id: UUID,
    deadline_type: str,
    payload: DeadlineNotificationSettingsUpdate,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
    locale: str = Query("en", max_length=10),
) -> EffectiveDeadlineNotificationSettings:
    """Create or replace a project-level override for a deadline type."""
    project = await load_project_or_404(session, project_id)
    membership = await require_membership(session, project.id, user.id)
    require_permission(membership.role, Resource.deadline, Action.update)

    rules = get_deadline_rules(project.country)
    rule = next((r for r in rules if r.deadline_type == deadline_type), None)
    if rule is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="UNKNOWN_DEADLINE_TYPE",
        )

    existing = (
        await session.execute(
            select(DeadlineNotificationSettings).where(
                DeadlineNotificationSettings.project_id == project.id,
                DeadlineNotificationSettings.deadline_type == deadline_type,
            )
        )
    ).scalar_one_or_none()

    if existing is None:
        # Start from jurisdiction defaults for any fields not in the payload.
        existing = DeadlineNotificationSettings(
            id=uuid4(),
            project_id=project.id,
            deadline_type=deadline_type,
            reminder_days=payload.reminder_days or list(rule.default_reminder_days),
            recipient_roles=payload.recipient_roles or list(rule.default_recipient_roles),
            enabled=payload.enabled if payload.enabled is not None else True,
        )
        session.add(existing)
    else:
        if payload.reminder_days is not None:
            existing.reminder_days = payload.reminder_days
        if payload.recipient_roles is not None:
            existing.recipient_roles = payload.recipient_roles
        if payload.enabled is not None:
            existing.enabled = payload.enabled

    await session.flush()

    effective = await get_effective_settings(
        session, project.id, deadline_type, project.country, locale
    )
    assert effective is not None
    return effective


@project_router.delete("/{deadline_type}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_project_setting(
    project_id: UUID,
    deadline_type: str,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> None:
    """Remove the project-level override, reverting to org/jurisdiction defaults."""
    project = await load_project_or_404(session, project_id)
    membership = await require_membership(session, project.id, user.id)
    require_permission(membership.role, Resource.deadline, Action.update)

    existing = (
        await session.execute(
            select(DeadlineNotificationSettings).where(
                DeadlineNotificationSettings.project_id == project.id,
                DeadlineNotificationSettings.deadline_type == deadline_type,
            )
        )
    ).scalar_one_or_none()

    if existing is not None:
        await session.delete(existing)
        await session.flush()
