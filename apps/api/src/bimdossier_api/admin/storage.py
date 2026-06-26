"""Active-storage helpers.

Computes the total bytes of non-deleted, ready files across all tenant
tables (project_files, certificates, org_certificates, reports) and
returns the result in GB.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from bimdossier_api.models.organization import Organization

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
    """Return total active storage for a single tenant schema, in GB."""
    async with session_maker() as session, session.begin():
        await session.execute(
            text(f'SET LOCAL search_path = "{schema_name}", public')
        )
        result = await session.execute(_ACTIVE_STORAGE_SQL)
        total_bytes = int(result.scalar_one())
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
