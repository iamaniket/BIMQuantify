"""Single choke-point for binding an object-storage key to a tenant prefix.

The DB tenant boundary is structural (schema-per-tenant), but the object store
is one shared bucket per category — BCF snapshots, attachments, certificates and
report-template assets all live in the same `attachments` bucket. Any code that
persists or presigns a key supplied (or influenced) by a caller therefore has to
re-assert that the key is scoped to the active tenant's namespace, or it can hand
out a presigned URL for another tenant's object.

This module is that assertion in one place. Prefer recomputing a deterministic
key server-side over validating a client value; use `assert_key_scoped` for the
cases where the key legitimately originates outside the request (a trusted worker
callback, or a random-uuid asset key minted at `initiate` and echoed back at
`complete`). (SOC2 CC6.1 / CC6.6 — tenant isolation.)
"""

from __future__ import annotations

from fastapi import HTTPException, status


def assert_key_scoped(
    key: str | None,
    expected_prefix: str,
    *,
    detail: str = "INVALID_STORAGE_KEY",
) -> None:
    """Reject a key not scoped to ``expected_prefix`` (``None`` passes).

    A prefix check is sufficient to bind a key to its own tenant/project because
    every legitimate key is derived server-side from the row's own
    tenant/project context (e.g. artifacts under ``projects/{project_id}/``,
    report PDFs under ``reports/{org_id}/{project_id}/``, template assets under
    ``report-templates/{org_id}/``). ``None`` — an absent optional artifact —
    passes. Raises ``HTTPException(400, detail=detail)`` otherwise.
    """
    if key is not None and not key.startswith(expected_prefix):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=detail,
        )
