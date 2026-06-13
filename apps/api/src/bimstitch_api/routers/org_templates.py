"""Org-level templates (finding forms + report layouts) — unified CRUD.

One router over the `org_templates` table. `template_type` discriminates the kind
(``findings`` + the four report kinds); `config` is validated per kind by
`validate_template_config`. Reads are member-level (so any user can pick a
template when logging a finding or generating a report); writes
(create/update/set-default/delete) and the report-template asset uploads are
org-admin only.

At most one default per `template_type`, enforced by a partial-unique index plus
clear-then-set in one transaction (see `_clear_default`).

Asset uploads (logo, cover PDF) use the two-phase presigned pattern from
`org_certificates.py` but store no DB row — the object is referenced by
`storage_key` inside a template's `config.branding`.
"""

from __future__ import annotations

import logging
from typing import Annotated
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from pydantic import ValidationError
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from bimstitch_api import audit
from bimstitch_api.auth.fastapi_users import current_verified_user
from bimstitch_api.config import Settings, get_settings
from bimstitch_api.models.org_template import OrgTemplate
from bimstitch_api.models.report import ReportType
from bimstitch_api.models.user import User
from bimstitch_api.org_templates.registry import (
    is_report_template_type,
    report_merge_fields,
    report_sections,
)
from bimstitch_api.routers.projects import _is_org_admin
from bimstitch_api.schemas.org_template import (
    OrgTemplateCreate,
    OrgTemplateRead,
    OrgTemplateSchemaResponse,
    OrgTemplateUpdate,
    SchemaMergeField,
    SchemaSection,
    TemplateAssetCompleteRequest,
    TemplateAssetCompleteResponse,
    TemplateAssetInitiateRequest,
    TemplateAssetInitiateResponse,
    TemplateAssetKind,
    TemplateType,
    validate_template_config,
)
from bimstitch_api.storage import StorageBackend, get_attachments_bucket, get_storage
from bimstitch_api.storage.minio import ObjectNotFoundError
from bimstitch_api.tenancy import get_tenant_session, require_active_organization

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/org-templates", tags=["org-templates"])

# Allowed file extensions per asset kind. Logo = raster/vector image; cover = PDF.
_ASSET_EXTENSIONS: dict[TemplateAssetKind, frozenset[str]] = {
    TemplateAssetKind.logo: frozenset({".png", ".jpg", ".jpeg", ".webp", ".svg"}),
    TemplateAssetKind.cover_pdf: frozenset({".pdf"}),
}


async def _require_org_admin(session: AsyncSession, user: User, organization_id: UUID) -> None:
    if user.is_superuser:
        return
    if await _is_org_admin(session, user.id, organization_id):
        return
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="ORG_ADMIN_REQUIRED")


def _template_snapshot(t: OrgTemplate) -> dict[str, object]:
    return {
        "template_type": t.template_type,
        "name": t.name,
        "description": t.description,
        "is_default": t.is_default,
        "config_keys": sorted((t.config or {}).keys()),
    }


def _config_error_code(exc: Exception) -> str:
    """Map a config-validation failure to a stable SCREAMING_SNAKE detail code."""
    if isinstance(exc, ValidationError):
        errors = exc.errors()
        if errors:
            first = errors[0]
            msg = str(first.get("msg", ""))
            # Pydantic prefixes custom `raise ValueError("CODE")` with "Value error, ".
            if msg.startswith("Value error, "):
                return msg[len("Value error, ") :]
            loc = ".".join(str(p) for p in first.get("loc", ()) if p != "__root__")
            return f"INVALID_CONFIG:{loc}" if loc else "INVALID_CONFIG"
        return "INVALID_CONFIG"
    # Bare ValueError (e.g. the post-validation UNKNOWN_SECTION_KEY check).
    return str(exc) or "INVALID_CONFIG"


def _validate_config_or_422(template_type: TemplateType, config: dict) -> dict:
    try:
        return validate_template_config(template_type, config)
    except (ValidationError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=_config_error_code(exc),
        ) from exc


async def _load_template_or_404(session: AsyncSession, template_id: UUID) -> OrgTemplate:
    template = (
        await session.execute(
            select(OrgTemplate).where(
                OrgTemplate.id == template_id,
                OrgTemplate.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if template is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="ORG_TEMPLATE_NOT_FOUND")
    return template


async def _clear_default(session: AsyncSession, template_type: str) -> None:
    """Clear the current default for a type. Run before setting a new default so
    the partial-unique index is never tripped within one transaction."""
    await session.execute(
        update(OrgTemplate)
        .where(
            OrgTemplate.template_type == template_type,
            OrgTemplate.is_default.is_(True),
            OrgTemplate.deleted_at.is_(None),
        )
        .values(is_default=False)
    )


# ---------------------------------------------------------------------------
# Static paths first (declared before /{template_id} so they win route matching)
# ---------------------------------------------------------------------------


@router.get("", response_model=list[OrgTemplateRead])
async def list_org_templates(
    template_type: Annotated[TemplateType, Query()] = TemplateType.findings,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> list[OrgTemplate]:
    # Member-level read: everyone needs to see templates to pick one.
    stmt = (
        select(OrgTemplate)
        .where(
            OrgTemplate.template_type == template_type.value,
            OrgTemplate.deleted_at.is_(None),
        )
        .order_by(OrgTemplate.is_default.desc(), OrgTemplate.name.asc())
    )
    result = await session.execute(stmt)
    return list(result.scalars().all())


@router.get("/schema", response_model=OrgTemplateSchemaResponse)
async def get_org_template_schema(
    template_type: Annotated[TemplateType, Query()],
    locale: Annotated[str, Query(max_length=8)] = "nl",
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> OrgTemplateSchemaResponse:
    """Available content sections + merge fields for a report template type, in
    the requested locale. Drives the portal builder. Declared before
    `/{template_id}` so the static path wins the route match."""
    if not is_report_template_type(template_type.value):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="SCHEMA_NOT_AVAILABLE_FOR_TYPE",
        )
    report_type = ReportType(template_type.value)
    return OrgTemplateSchemaResponse(
        template_type=template_type,
        sections=[
            SchemaSection(key=s.key, label=s.label(locale)) for s in report_sections(report_type)
        ],
        merge_fields=[
            SchemaMergeField(path=m.path, label=m.label(locale))
            for m in report_merge_fields(report_type)
        ],
    )


@router.post(
    "/assets/initiate",
    response_model=TemplateAssetInitiateResponse,
    status_code=status.HTTP_201_CREATED,
)
async def initiate_template_asset_upload(
    payload: TemplateAssetInitiateRequest,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
    storage: StorageBackend = Depends(get_storage),
    settings: Settings = Depends(get_settings),
) -> TemplateAssetInitiateResponse:
    """Presigned PUT for a report-template asset (logo / cover PDF). No DB row —
    the object is referenced by `storage_key` in a template's `config.branding`."""
    await _require_org_admin(session, user, active_org_id)

    fname_lower = payload.filename.lower()
    dot_pos = fname_lower.rfind(".")
    ext = fname_lower[dot_pos:] if dot_pos >= 0 else ""
    allowed = _ASSET_EXTENSIONS[payload.asset_kind]
    if ext not in allowed:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "INVALID_FILE_EXTENSION", "allowed": sorted(allowed)},
        )
    if payload.size_bytes > settings.attachment_max_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail={"code": "FILE_TOO_LARGE", "max_bytes": settings.attachment_max_bytes},
        )

    storage_key = f"report-templates/{active_org_id}/{payload.asset_kind.value}/{uuid4()}{ext}"
    bucket = get_attachments_bucket()
    upload_url = await storage.presigned_put_url(
        storage_key, payload.content_type, payload.size_bytes, bucket=bucket
    )
    return TemplateAssetInitiateResponse(storage_key=storage_key, upload_url=upload_url)


@router.post("/assets/complete", response_model=TemplateAssetCompleteResponse)
async def complete_template_asset_upload(
    payload: TemplateAssetCompleteRequest,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
    storage: StorageBackend = Depends(get_storage),
) -> TemplateAssetCompleteResponse:
    await _require_org_admin(session, user, active_org_id)

    # Confine completion to this org's asset namespace (no cross-org probing).
    if not payload.storage_key.startswith(f"report-templates/{active_org_id}/"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="INVALID_ASSET_KEY")

    bucket = get_attachments_bucket()
    try:
        await storage.head_object(payload.storage_key, bucket=bucket)
    except ObjectNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="OBJECT_NOT_UPLOADED",
        ) from exc

    filename = payload.storage_key.rsplit("/", 1)[-1]
    url = await storage.presigned_get_url(
        payload.storage_key, filename, disposition="inline", bucket=bucket
    )
    return TemplateAssetCompleteResponse(storage_key=payload.storage_key, url=url)


@router.post("", response_model=OrgTemplateRead, status_code=status.HTTP_201_CREATED)
async def create_org_template(
    payload: OrgTemplateCreate,
    request: Request,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> OrgTemplate:
    await _require_org_admin(session, user, active_org_id)

    config = _validate_config_or_422(payload.template_type, payload.config)
    if payload.is_default:
        await _clear_default(session, payload.template_type.value)

    template = OrgTemplate(
        template_type=payload.template_type.value,
        name=payload.name,
        description=payload.description,
        is_default=payload.is_default,
        config=config,
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
        action="org_template.created",
        resource_type="org_template",
        resource_id=template.id,
        after=_template_snapshot(template),
        actor_user_id=user.id,
        request=request,
    )
    return await _load_template_or_404(session, template.id)


# ---------------------------------------------------------------------------
# Dynamic paths
# ---------------------------------------------------------------------------


@router.get("/{template_id}", response_model=OrgTemplateRead)
async def get_org_template(
    template_id: UUID,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> OrgTemplate:
    return await _load_template_or_404(session, template_id)


@router.patch("/{template_id}", response_model=OrgTemplateRead)
async def update_org_template(
    template_id: UUID,
    payload: OrgTemplateUpdate,
    request: Request,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> OrgTemplate:
    await _require_org_admin(session, user, active_org_id)

    template = await _load_template_or_404(session, template_id)
    before = _template_snapshot(template)

    updates = payload.model_dump(exclude_unset=True)
    if "config" in updates and payload.config is not None:
        # Validate against the loaded row's kind — never trust the client for type.
        updates["config"] = _validate_config_or_422(
            TemplateType(template.template_type), payload.config
        )
    for field, value in updates.items():
        setattr(template, field, value)
    await session.flush()

    await audit.record(
        session,
        action="org_template.updated",
        resource_type="org_template",
        resource_id=template.id,
        before=before,
        after=_template_snapshot(template),
        actor_user_id=user.id,
        request=request,
    )
    return await _load_template_or_404(session, template_id)


@router.post("/{template_id}/set-default", response_model=OrgTemplateRead)
async def set_default_org_template(
    template_id: UUID,
    request: Request,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> OrgTemplate:
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
            action="org_template.set_default",
            resource_type="org_template",
            resource_id=template.id,
            after=_template_snapshot(template),
            actor_user_id=user.id,
            request=request,
        )
    return await _load_template_or_404(session, template_id)


@router.delete("/{template_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_org_template(
    template_id: UUID,
    request: Request,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> Response:
    await _require_org_admin(session, user, active_org_id)

    template = await _load_template_or_404(session, template_id)
    if template.is_default:
        # Force an explicit choice of a new default rather than silently leaving none.
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="CANNOT_DELETE_DEFAULT_TEMPLATE",
        )
    before = _template_snapshot(template)
    template.soft_delete()
    await session.flush()

    await audit.record(
        session,
        action="org_template.deleted",
        resource_type="org_template",
        resource_id=template_id,
        before=before,
        actor_user_id=user.id,
        request=request,
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
