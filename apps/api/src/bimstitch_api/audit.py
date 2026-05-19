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
from sqlalchemy.ext.asyncio import AsyncSession

from bimstitch_api.models.audit_log import AuditLog


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


async def record(
    session: AsyncSession,
    *,
    action: str,
    resource_type: str,
    resource_id: str | UUID | None = None,
    before: dict[str, Any] | None = None,
    after: dict[str, Any] | None = None,
    actor_user_id: UUID | None = None,
    organization_id: UUID | None = None,
    request: Request | None = None,
) -> None:
    """Append an audit entry within the caller's transaction.

    Always called with the *same* session the mutation is happening on so
    the entry commits or rolls back atomically with the operation. Do NOT
    open a new session here — that would let an audit entry persist even
    if the underlying operation later fails.
    """
    request_id, ip_address, user_agent = _extract_request_context(request)

    entry = AuditLog(
        user_id=actor_user_id,
        organization_id=organization_id,
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
