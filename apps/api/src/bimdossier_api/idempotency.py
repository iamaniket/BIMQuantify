"""Optional ``Idempotency-Key`` support for offline-replayed create endpoints.

The mobile app (apps/mobile) keeps an outbox of writes made while offline and
replays them when the connection returns. If a create's response is lost the
client retries, which would otherwise create a duplicate snag/attachment. To
make replay safe the client sends a stable ``Idempotency-Key`` header — a UUID
minted once per queued create and **never regenerated on retry** — and the
server records it on the created row behind a per-user partial-unique index.

The mechanism is **DB-centric, not Redis-backed**: the partial-unique index is
the real guarantee, and a keyed replay is served by a small pre-check
``SELECT ... WHERE idempotency_key = :key`` in the route. For attachment
``initiate`` that pre-check re-presigns a fresh upload URL for the existing row
rather than handing back a possibly-expired one. Online clients (the portal)
omit the header and are completely unaffected.

This module only owns the two cross-route pieces:
  * ``idempotency_key_header`` — a dependency that validates the optional header.
  * ``is_idempotency_conflict`` — classify an ``IntegrityError`` as a duplicate
    idempotency-key violation (vs an unrelated FK / content-dedup violation).
"""

from __future__ import annotations

import re
from typing import TYPE_CHECKING

from fastapi import Header, HTTPException, status

if TYPE_CHECKING:
    from sqlalchemy.exc import IntegrityError

# Keys are UUIDs in practice. Restrict to a conservative safe charset (no ':',
# whitespace, or control chars) and cap at the VARCHAR(200) column width so a
# malformed value can't be silently truncated or smuggle separators.
_IDEMPOTENCY_KEY_RE = re.compile(r"^[A-Za-z0-9._\-]{1,200}$")

# Substring shared by the per-user partial-unique indexes on findings and
# project_files, used to recognise their violation in an IntegrityError.
_IDEMPOTENCY_INDEX_TOKEN = "idempotency_key"


async def idempotency_key_header(
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
) -> str | None:
    """Validate and return the optional ``Idempotency-Key`` header.

    ``None`` when absent — the route then behaves exactly as before (online
    clients). A malformed key raises 400 rather than being silently ignored, so
    a client bug surfaces loudly instead of dropping the key and creating
    duplicates the server can no longer dedup.
    """
    if idempotency_key is None:
        return None
    key = idempotency_key.strip()
    if not _IDEMPOTENCY_KEY_RE.match(key):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="IDEMPOTENCY_KEY_INVALID",
        )
    return key


def is_idempotency_conflict(exc: IntegrityError) -> bool:
    """True when ``exc`` is a duplicate idempotency-key unique violation.

    A create can trip several constraints at flush (a bad attachment FK, the
    content-sha256 dedup, a version-group race). This distinguishes the
    idempotency index so the route maps it to a retryable 409 rather than a
    misleading 422/409 for the wrong cause. Driver-agnostic: checks asyncpg's
    ``constraint_name`` first, then falls back to the rendered error text.
    """
    orig = exc.orig
    constraint = getattr(orig, "constraint_name", None)
    if constraint and _IDEMPOTENCY_INDEX_TOKEN in constraint:
        return True
    return _IDEMPOTENCY_INDEX_TOKEN in str(orig).lower()
