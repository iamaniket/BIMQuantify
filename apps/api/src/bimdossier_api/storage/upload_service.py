"""Shared mechanics for the two-phase presigned upload flow.

`attachments`, `certificates`, and `project_files` all upload the same way:
validate the extension and size, mint a UUID storage key, hand back a presigned
PUT, then on `complete` HEAD-verify the object actually landed and matches the
declared size. Those steps were triplicated across the routers; this module is
the single home for the stateless, model-agnostic pieces (#35).

What stays in each router is the model-specific work — constructing the typed row
(attachment category / certificate conformity fields), audit snapshots, and any
post-upload dispatch — because those genuinely differ. This service deliberately
does *not* try to be a generic CRUD layer over heterogeneous models; it removes
the duplicated plumbing while keeping each table's create path explicit and
type-safe.
"""

from __future__ import annotations

from typing import TYPE_CHECKING
from uuid import UUID, uuid4

from fastapi import HTTPException, status

from bimdossier_api.storage.minio import ObjectNotFoundError

if TYPE_CHECKING:
    from collections.abc import Collection

    from bimdossier_api.storage import StorageBackend


def parse_extension(filename: str) -> str:
    """Return the lowercased extension including the dot (``".pdf"``), or ``""``.

    Matches the inline logic the routers used so behaviour is unchanged.
    """
    lower = filename.lower()
    dot = lower.rfind(".")
    return lower[dot:] if dot >= 0 else ""


def ensure_allowed_extension(ext: str, allowed: Collection[str]) -> None:
    """400 INVALID_FILE_EXTENSION if ``ext`` is not in ``allowed``.

    ``allowed`` may be any container of extension strings — the attachment
    extension→category map and the certificate extension set both qualify.
    """
    if ext not in allowed:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "code": "INVALID_FILE_EXTENSION",
                "allowed": sorted(allowed),
            },
        )


def ensure_within_size_limit(size_bytes: int, max_bytes: int) -> None:
    """413 FILE_TOO_LARGE if the declared size exceeds the configured cap."""
    if size_bytes > max_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail={"code": "FILE_TOO_LARGE", "max_bytes": max_bytes},
        )


def build_storage_key(project_id: UUID, kind: str, ext: str) -> str:
    """``projects/{project_id}/{kind}/{uuid4}{ext}`` — collision-free per upload.

    A fresh UUID per call means every version (and every re-upload) gets its own
    immutable key; the object store is never overwritten in place.
    """
    return f"projects/{project_id}/{kind}/{uuid4()}{ext}"


async def head_verify_size(
    storage: StorageBackend, storage_key: str, *, bucket: str | None = None
) -> int:
    """HEAD the uploaded object and return its actual byte size.

    Raises 422 OBJECT_NOT_UPLOADED if the client never PUT the bytes. The caller
    compares the returned size against the declared size and owns the
    model-specific rejection/audit path on a mismatch.
    """
    try:
        head = await storage.head_object(storage_key, bucket=bucket)
    except ObjectNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="OBJECT_NOT_UPLOADED",
        ) from exc
    actual = head.get("ContentLength", 0)
    return int(actual) if isinstance(actual, int) else 0
