"""Internal endpoint the extractor calls back into when a job finishes.

Auth: shared bearer token via `require_extractor_secret`. No user auth.

This router does NOT use `get_tenant_session` because the extractor has no
tenant context. The connecting Postgres role is a superuser, which bypasses
RLS, so the system session can update any project_files row.

Status machine:
    queued    → running, succeeded, failed
    running   → succeeded, failed
    succeeded → (terminal — callback is no-op + 200)
    failed    → (terminal — callback is no-op + 200)
"""

import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from bimstitch_api.db import get_async_session
from bimstitch_api.extraction import require_extractor_secret
from bimstitch_api.models.project_file import ExtractionStatus, ProjectFile
from bimstitch_api.schemas.project_file import ExtractionCallbackRequest, ProjectFileRead

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/internal/extraction",
    tags=["internal-extraction"],
    dependencies=[Depends(require_extractor_secret)],
)


_TERMINAL = {ExtractionStatus.succeeded, ExtractionStatus.failed}
_VALID_INCOMING = {
    ExtractionStatus.running,
    ExtractionStatus.succeeded,
    ExtractionStatus.failed,
}


@router.post("/callback", response_model=ProjectFileRead)
async def extraction_callback(
    payload: ExtractionCallbackRequest,
    session: AsyncSession = Depends(get_async_session),
) -> ProjectFile:
    if payload.status not in _VALID_INCOMING:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="INVALID_CALLBACK_STATUS",
        )

    async with session.begin():
        row = await _load_file(session, payload.file_id)

        if row.extraction_status in _TERMINAL:
            # Idempotent no-op. Don't overwrite what we already recorded.
            return row

        if payload.status is ExtractionStatus.running:
            row.extraction_status = ExtractionStatus.running
            if payload.started_at is not None:
                row.extraction_started_at = payload.started_at
            if payload.extractor_version is not None:
                row.extractor_version = payload.extractor_version
        elif payload.status is ExtractionStatus.succeeded:
            row.extraction_status = ExtractionStatus.succeeded
            row.fragments_storage_key = payload.fragments_key
            row.metadata_storage_key = payload.metadata_key
            row.properties_storage_key = payload.properties_key
            row.extraction_error = None
            if payload.started_at is not None:
                row.extraction_started_at = payload.started_at
            if payload.finished_at is not None:
                row.extraction_finished_at = payload.finished_at
            if payload.extractor_version is not None:
                row.extractor_version = payload.extractor_version
        else:  # failed
            row.extraction_status = ExtractionStatus.failed
            row.extraction_error = payload.error
            if payload.started_at is not None:
                row.extraction_started_at = payload.started_at
            if payload.finished_at is not None:
                row.extraction_finished_at = payload.finished_at
            if payload.extractor_version is not None:
                row.extractor_version = payload.extractor_version

    await session.refresh(row)
    return row


async def _load_file(session: AsyncSession, file_id: UUID) -> ProjectFile:
    row = (
        await session.execute(select(ProjectFile).where(ProjectFile.id == file_id))
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="FILE_NOT_FOUND")
    return row


__all__ = ["router"]
