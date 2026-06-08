"""Org-level custom form templates for findings (Bevindingen).

Admin-authored, org-wide (tenant schema, no project scope — usable in every
project). Reads are member-level so any user can pick a template when logging a
finding; writes (create/update/set-default/delete) are org-admin only.

At most one default per `template_type`, enforced by a partial-unique index plus
clear-then-set in one transaction (see `_clear_default`).
"""

from __future__ import annotations

from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from bimstitch_api import audit
from bimstitch_api.auth.fastapi_users import current_verified_user
from bimstitch_api.models.finding_template import FindingTemplate
from bimstitch_api.models.user import User
from bimstitch_api.routers.projects import _is_org_admin
from bimstitch_api.schemas.finding_template import (
    BuiltinFieldConfig,
    FieldDef,
    FindingTemplateCreate,
    FindingTemplateRead,
    FindingTemplateUpdate,
)
from bimstitch_api.tenancy import get_tenant_session, require_active_organization

router = APIRouter(prefix="/finding-templates", tags=["finding-templates"])


async def _require_org_admin(session: AsyncSession, user: User, organization_id: UUID) -> None:
    if user.is_superuser:
        return
    if await _is_org_admin(session, user.id, organization_id):
        return
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="ORG_ADMIN_REQUIRED")


def _dump_fields(fields: list[FieldDef]) -> list[dict[str, Any]]:
    # exclude_none keeps the stored JSONB lean (no null options/min/max/help_text).
    return [f.model_dump(mode="json", exclude_none=True) for f in fields]


def _dump_builtins(builtins: dict[str, BuiltinFieldConfig]) -> dict[str, dict[str, Any]]:
    return {key: cfg.model_dump(mode="json") for key, cfg in builtins.items()}


def _template_snapshot(t: FindingTemplate) -> dict[str, object]:
    return {
        "template_type": t.template_type,
        "name": t.name,
        "description": t.description,
        "is_default": t.is_default,
        "field_count": len(t.fields or []),
        "builtin_fields": t.builtin_fields,
    }


async def _load_template_or_404(session: AsyncSession, template_id: UUID) -> FindingTemplate:
    template = (
        await session.execute(
            select(FindingTemplate).where(
                FindingTemplate.id == template_id,
                FindingTemplate.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if template is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="FINDING_TEMPLATE_NOT_FOUND"
        )
    return template


async def _clear_default(session: AsyncSession, template_type: str) -> None:
    """Clear the current default for a type. Run before setting a new default so
    the partial-unique index is never tripped within one transaction."""
    await session.execute(
        update(FindingTemplate)
        .where(
            FindingTemplate.template_type == template_type,
            FindingTemplate.is_default.is_(True),
            FindingTemplate.deleted_at.is_(None),
        )
        .values(is_default=False)
    )


@router.get("", response_model=list[FindingTemplateRead])
async def list_finding_templates(
    template_type: Annotated[str, Query(max_length=32)] = "findings",
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> list[FindingTemplate]:
    # Member-level read: everyone needs to see templates to pick one.
    stmt = (
        select(FindingTemplate)
        .where(
            FindingTemplate.template_type == template_type,
            FindingTemplate.deleted_at.is_(None),
        )
        .order_by(FindingTemplate.is_default.desc(), FindingTemplate.name.asc())
    )
    result = await session.execute(stmt)
    return list(result.scalars().all())


@router.get("/{template_id}", response_model=FindingTemplateRead)
async def get_finding_template(
    template_id: UUID,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> FindingTemplate:
    return await _load_template_or_404(session, template_id)


@router.post("", response_model=FindingTemplateRead, status_code=status.HTTP_201_CREATED)
async def create_finding_template(
    payload: FindingTemplateCreate,
    request: Request,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> FindingTemplate:
    await _require_org_admin(session, user, active_org_id)

    if payload.is_default:
        await _clear_default(session, payload.template_type.value)

    template = FindingTemplate(
        template_type=payload.template_type.value,
        name=payload.name,
        description=payload.description,
        is_default=payload.is_default,
        builtin_fields=_dump_builtins(payload.builtin_fields),
        fields=_dump_fields(payload.fields),
        created_by_user_id=user.id,
    )
    session.add(template)
    try:
        await session.flush()
    except IntegrityError as exc:
        # Concurrent set-default lost the race against the partial-unique index.
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="DEFAULT_TEMPLATE_CONFLICT",
        ) from exc

    await audit.record(
        session,
        action="finding_template.created",
        resource_type="finding_template",
        resource_id=template.id,
        after=_template_snapshot(template),
        actor_user_id=user.id,
        request=request,
    )
    return await _load_template_or_404(session, template.id)


@router.patch("/{template_id}", response_model=FindingTemplateRead)
async def update_finding_template(
    template_id: UUID,
    payload: FindingTemplateUpdate,
    request: Request,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> FindingTemplate:
    await _require_org_admin(session, user, active_org_id)

    template = await _load_template_or_404(session, template_id)
    before = _template_snapshot(template)

    updates = payload.model_dump(exclude_unset=True)
    if "fields" in updates and payload.fields is not None:
        updates["fields"] = _dump_fields(payload.fields)
    if "builtin_fields" in updates and payload.builtin_fields is not None:
        updates["builtin_fields"] = _dump_builtins(payload.builtin_fields)
    for field, value in updates.items():
        setattr(template, field, value)
    await session.flush()

    await audit.record(
        session,
        action="finding_template.updated",
        resource_type="finding_template",
        resource_id=template.id,
        before=before,
        after=_template_snapshot(template),
        actor_user_id=user.id,
        request=request,
    )
    return await _load_template_or_404(session, template_id)


@router.post("/{template_id}/set-default", response_model=FindingTemplateRead)
async def set_default_finding_template(
    template_id: UUID,
    request: Request,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> FindingTemplate:
    await _require_org_admin(session, user, active_org_id)

    template = await _load_template_or_404(session, template_id)
    if not template.is_default:
        await _clear_default(session, template.template_type)
        template.is_default = True
        try:
            await session.flush()
        except IntegrityError as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="DEFAULT_TEMPLATE_CONFLICT",
            ) from exc
        await audit.record(
            session,
            action="finding_template.set_default",
            resource_type="finding_template",
            resource_id=template.id,
            after=_template_snapshot(template),
            actor_user_id=user.id,
            request=request,
        )
    return await _load_template_or_404(session, template_id)


@router.delete("/{template_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_finding_template(
    template_id: UUID,
    request: Request,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> Response:
    await _require_org_admin(session, user, active_org_id)

    template = await _load_template_or_404(session, template_id)
    if template.is_default:
        # Force an explicit choice of a new default rather than silently leaving
        # the org with none.
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="CANNOT_DELETE_DEFAULT_TEMPLATE",
        )
    before = _template_snapshot(template)
    template.soft_delete()
    await session.flush()

    await audit.record(
        session,
        action="finding_template.deleted",
        resource_type="finding_template",
        resource_id=template_id,
        before=before,
        actor_user_id=user.id,
        request=request,
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
