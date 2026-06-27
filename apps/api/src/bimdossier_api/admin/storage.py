"""Active-storage helpers.

Computes the total bytes of non-deleted, ready files across all tenant
tables (project_files, certificates, org_certificates, reports) and
returns the result in GB.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from bimdossier_api.config import get_settings
from bimdossier_api.models.organization import Organization
from bimdossier_api.storage.minio import StorageBackend

logger = logging.getLogger(__name__)

_BYTES_PER_GB = 1024 ** 3

_ACTIVE_STORAGE_SQL = text("""
    SELECT COALESCE(SUM(s), 0) FROM (
        SELECT size_bytes AS s FROM project_files
            WHERE deleted_at IS NULL AND status = 'ready'
        UNION ALL
        SELECT size_bytes FROM certificates
            WHERE deleted_at IS NULL AND status = 'ready'
        UNION ALL
        SELECT size_bytes FROM org_certificates
            WHERE deleted_at IS NULL AND status = 'ready'
        UNION ALL
        SELECT byte_size FROM reports
            WHERE status = 'ready' AND byte_size IS NOT NULL
    ) t
""")


async def compute_active_storage_gb(
    session_maker: async_sessionmaker[AsyncSession],
    schema_name: str,
) -> float:
    """Return total active storage for a single tenant schema, in GB.

    Resilient to a missing schema: a purged org's schema has been dropped, so the
    UNION query's tables no longer resolve — that is reported as 0 GB rather than
    raising, since the admin read paths (get/list with include_deleted, the purge
    response) legitimately serialize purged tombstones.
    """
    try:
        async with session_maker() as session, session.begin():
            await session.execute(
                text(f'SET LOCAL search_path = "{schema_name}", public')
            )
            result = await session.execute(_ACTIVE_STORAGE_SQL)
            total_bytes = int(result.scalar_one())
    except Exception:
        logger.warning(
            "compute_active_storage_gb[%s]: query failed (schema purged?); reporting 0",
            schema_name,
            exc_info=True,
        )
        return 0.0
    return round(total_bytes / _BYTES_PER_GB, 1)


async def compute_storage_gb_bulk(
    session_maker: async_sessionmaker[AsyncSession],
    orgs: list[Organization],
) -> dict[UUID, float]:
    """Bulk storage lookup. Returns {org_id: used_gb}."""
    out: dict[UUID, float] = {}
    for org in orgs:
        out[org.id] = await compute_active_storage_gb(session_maker, org.schema_name)
    return out


async def assert_storage_limit_not_below_usage(
    session_maker: async_sessionmaker[AsyncSession],
    organization: Organization,
    new_limit_gb: int,
) -> None:
    """Raise 409 if the proposed limit is below current usage."""
    used = await compute_active_storage_gb(session_maker, organization.schema_name)
    if new_limit_gb < used:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="STORAGE_LIMIT_BELOW_USAGE",
        )


@dataclass
class StorageWipeResult:
    """Outcome of an org storage wipe. `targets` is a human-readable list of every
    bucket:prefix*/bucket:key the wipe covers (used for the dry-run report + audit);
    `deleted_count` is the number of objects actually removed (0 for a dry run)."""

    targets: list[str] = field(default_factory=list)
    deleted_count: int = 0


async def wipe_org_storage(
    session_maker: async_sessionmaker[AsyncSession],
    storage: StorageBackend,
    organization: Organization,
    *,
    dry_run: bool = False,
) -> StorageWipeResult:
    """Delete every MinIO/S3 object owned by `organization`, across BOTH buckets.

    MUST be called while the tenant schema still EXISTS: the flat-keyed objects
    (project thumbnails `thumbnails/{uuid}`, org-certificates `org-certificates/{uuid}`)
    carry no org/project segment, so they can only be discovered from their tenant
    rows — `DROP SCHEMA` would make them unfindable. The org logo (`image_key`) lives
    on the PUBLIC org row and survives the drop, so it is wiped here too.

    Object families and how each is covered:
      * `projects/{project_id}/`  — model files + worker artifacts (ifc bucket),
        attachments + capture + project certificates (attachments bucket). Deleted
        by a per-project prefix delete on BOTH buckets.
      * `reports/{org_id}/`       — report PDFs. Prefix delete on BOTH buckets
        (download presigns the ifc bucket; worker write-bucket is unverified).
      * `report-templates/{org_id}/` and `bcf-snapshots/{schema}/` — prefix delete
        on the attachments bucket.
      * flat keys (thumbnails, org-certificates, org logo) — explicit delete_object.

    Idempotent. A prefix-delete failure PROPAGATES so the caller can abort before
    `DROP SCHEMA` (dropping after a partial wipe would orphan the survivors forever).
    Individual flat-key deletes are best-effort (S3 delete is idempotent for a
    missing key; a transient failure is logged, not fatal).
    """
    settings = get_settings()
    ifc_bucket = settings.s3_bucket_ifc
    att_bucket = settings.s3_bucket_attachments
    org_id = organization.id
    schema = organization.schema_name

    # ── Collect identifiers from the still-live tenant schema ──────────────
    project_ids: list[str] = []
    thumbnail_keys: list[str] = []
    org_cert_keys: list[str] = []
    async with session_maker() as session, session.begin():
        await session.execute(text(f'SET LOCAL search_path = "{schema}", public'))
        for pid, thumb in (await session.execute(
            text("SELECT id, thumbnail_url FROM projects")
        )).all():
            project_ids.append(str(pid))
            if thumb and str(thumb).startswith("thumbnails/"):
                thumbnail_keys.append(str(thumb))
        for (key,) in (await session.execute(
            text("SELECT storage_key FROM org_certificates")
        )).all():
            if key:
                org_cert_keys.append(str(key))

    # ── Build the deletion plan ────────────────────────────────────────────
    prefixes: list[tuple[str, str]] = []
    for pid in project_ids:
        prefixes.append((ifc_bucket, f"projects/{pid}/"))
        prefixes.append((att_bucket, f"projects/{pid}/"))
    prefixes.append((ifc_bucket, f"reports/{org_id}/"))
    prefixes.append((att_bucket, f"reports/{org_id}/"))
    prefixes.append((att_bucket, f"report-templates/{org_id}/"))
    prefixes.append((att_bucket, f"bcf-snapshots/{schema}/"))

    flat_keys: list[tuple[str, str]] = [(ifc_bucket, k) for k in thumbnail_keys]
    flat_keys += [(att_bucket, k) for k in org_cert_keys]
    if organization.image_key:
        flat_keys.append((att_bucket, organization.image_key))

    targets = [f"{b}:{p}*" for b, p in prefixes] + [f"{b}:{k}" for b, k in flat_keys]
    if dry_run:
        return StorageWipeResult(targets=targets, deleted_count=0)

    deleted = 0
    for bucket, prefix in prefixes:
        deleted += await storage.delete_prefix(prefix, bucket=bucket)
    for bucket, key in flat_keys:
        try:
            await storage.delete_object(key, bucket=bucket)
            deleted += 1
        except Exception:
            logger.warning(
                "wipe_org_storage[%s]: failed to delete %s:%s", schema, bucket, key,
                exc_info=True,
            )
    return StorageWipeResult(targets=targets, deleted_count=deleted)
