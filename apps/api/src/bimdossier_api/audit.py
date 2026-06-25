"""Audit log helper.

App-layer only — never written via DB triggers because triggers can't see
the HTTP actor or request_id. Every identity/admin mutation should call
`audit.record(...)` with the same session it's mutating in, so the audit
entry rolls back with the operation on failure.

Sensitive fields in `before`/`after` are scrubbed via `REDACT_FIELDS_BY_TABLE`
before persistence.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from fastapi import Request
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from bimdossier_api.models.audit_log import AuditLog

# Sensitive fields per table. When a row's dict is captured for before/after,
# any key in this set is dropped before serialization.
REDACT_FIELDS_BY_TABLE: dict[str, frozenset[str]] = {
    "users": frozenset(
        {
            "hashed_password",
            "password_hash",
            "password",
        }
    ),
    "organization_members": frozenset(),
    "organizations": frozenset(),
    "project_members": frozenset(),
    "project_files": frozenset(),
    "capture_links": frozenset({"token"}),
}


def _redact(table_name: str, payload: dict[str, Any] | None) -> dict[str, Any] | None:
    if payload is None:
        return None
    redact = REDACT_FIELDS_BY_TABLE.get(table_name, frozenset())
    if not redact:
        return payload
    return {k: v for k, v in payload.items() if k not in redact}


def _extract_request_context(request: Request | None) -> tuple[str | None, str | None, str | None]:
    """Pull (request_id, ip_address, user_agent) from the FastAPI Request.

    `request_id` is sourced from the `X-Request-Id` header if present —
    consumers behind a load balancer that injects this header get the same
    id across the audit log and any external tracing.
    """
    if request is None:
        return None, None, None
    request_id = request.headers.get("x-request-id")
    ip = request.client.host if request.client else None
    user_agent = request.headers.get("user-agent")
    if user_agent is not None:
        user_agent = user_agent[:255]
    return request_id, ip, user_agent


def _resolve_impersonator(
    explicit: UUID | None, request: Request | None
) -> UUID | None:
    """Pick the impersonator attribution for an audit row.

    Explicit param wins (used by `auth.impersonate.start` to record the
    super admin even though that endpoint isn't itself an impersonated
    request). Otherwise we read it off `request.state.impersonator_user_id`
    where the `get_impersonator_user_id` dependency stashed it when the
    caller's access token carried an `imp` claim.
    """
    if explicit is not None:
        return explicit
    if request is None:
        return None
    return getattr(request.state, "impersonator_user_id", None)


async def record(
    session: AsyncSession,
    *,
    action: str,
    resource_type: str,
    resource_id: str | UUID | None = None,
    before: dict[str, Any] | None = None,
    after: dict[str, Any] | None = None,
    actor_user_id: UUID | None = None,
    project_id: UUID | None = None,
    request: Request | None = None,
    impersonator_user_id: UUID | None = None,
) -> None:
    """Append an audit entry within the caller's transaction.

    The row lands in whatever schema the session's `search_path` resolves
    `audit_log` to. Tenant-session callers (and any caller that has already
    set search_path to an org schema) get the entry written into that org's
    schema with no extra work. Callers on a plain master/superuser session
    that need to target a specific org's schema should use `record_for_org`.

    Always called with the *same* session the mutation is happening on so
    the entry commits or rolls back atomically with the operation. Do NOT
    open a new session here — that would let an audit entry persist even
    if the underlying operation later fails.

    When `impersonator_user_id` is not passed but `request` is, the helper
    auto-populates the column from `request.state.impersonator_user_id`
    (set by `auth.dependencies.get_impersonator_user_id`). Routes never
    have to thread this manually for normal traffic; explicit pass is
    only needed by the impersonate-start endpoint itself.
    """
    request_id, ip_address, user_agent = _extract_request_context(request)
    impersonator = _resolve_impersonator(impersonator_user_id, request)

    entry = AuditLog(
        user_id=actor_user_id,
        impersonator_user_id=impersonator,
        project_id=project_id,
        action=action,
        resource_type=resource_type,
        resource_id=str(resource_id) if resource_id is not None else None,
        before=_redact(resource_type, before),
        after=_redact(resource_type, after),
        request_id=request_id,
        ip_address=ip_address,
        user_agent=user_agent,
    )
    session.add(entry)
    # Caller's transaction commits this. We deliberately do NOT flush() —
    # letting the surrounding txn batch the insert is fine, and a forced
    # flush here would emit SQL before the caller is ready.


async def record_for_org(
    session: AsyncSession,
    organization_id: UUID | None,
    *,
    action: str,
    resource_type: str,
    resource_id: str | UUID | None = None,
    before: dict[str, Any] | None = None,
    after: dict[str, Any] | None = None,
    actor_user_id: UUID | None = None,
    project_id: UUID | None = None,
    request: Request | None = None,
    impersonator_user_id: UUID | None = None,
) -> None:
    """Append an audit entry into a specific org's schema from a master session.

    For callers that are NOT inside a tenant session (auth, super-admin,
    background tasks): `audit_log` is a per-tenant table, so we point the
    session's `search_path` at the target org's schema, write the row, flush
    it (so the INSERT is emitted under that search_path), then reset
    `search_path` back to `public`. The reset matters because leaving it on
    the org schema would let an org-local enum type shadow a public one in a
    later statement of the same transaction — the hazard documented in
    `jobs_internal._set_tenant_schema`.

    `organization_id=None` routes the entry to the platform org's schema —
    used for events that belong to no single customer org (anonymous auth
    failures, platform-level super-admin actions, org deletion where the
    subject schema is being dropped).
    """
    from bimdossier_api.tenancy import resolve_platform_schema, schema_name_for

    if organization_id is not None:
        schema = schema_name_for(organization_id)
    else:
        schema = await resolve_platform_schema(session)

    await session.execute(text(f'SET LOCAL search_path TO "{schema}", public'))
    await record(
        session,
        action=action,
        resource_type=resource_type,
        resource_id=resource_id,
        before=before,
        after=after,
        actor_user_id=actor_user_id,
        project_id=project_id,
        request=request,
        impersonator_user_id=impersonator_user_id,
    )
    await session.flush()
    await session.execute(text("SET LOCAL search_path TO public"))


async def log_permission_denied(
    *,
    role: str,
    resource: str,
    action: str,
    actor_user_id: UUID,
    organization_id: UUID | None = None,
    resource_id: str | UUID | None = None,
    request: Request | None = None,
) -> None:
    """Record a permission denial in an independent session.

    The calling endpoint's tenant transaction will be rolled back when the
    HTTPException propagates, so a same-session entry would vanish with it.
    This function commits the denial row in its own transaction.

    Call pattern::

        try:
            require_permission(membership.role, Resource.risk, Action.delete)
        except HTTPException:
            await audit.log_permission_denied(
                role=membership.role.value,
                resource=Resource.risk.value,
                action=Action.delete.value,
                actor_user_id=user.id,
                organization_id=active_org_id,
                resource_id=risk_id,
                request=request,
            )
            raise

    Failures are caught and logged — a broken audit path must never mask the
    original 403 response.
    """
    import logging  # stdlib, always available

    from bimdossier_api.db import get_session_maker  # lazy to avoid circular import

    try:
        sm = get_session_maker()
        async with sm() as ds, ds.begin():
            await record_for_org(
                ds,
                organization_id,
                action="permission.denied",
                resource_type=resource,
                resource_id=resource_id,
                before={"role": role, "resource": resource, "action": action},
                actor_user_id=actor_user_id,
                request=request,
            )
    except Exception:
        logging.getLogger(__name__).warning(
            "Failed to record permission denial audit entry", exc_info=True
        )
