from fastapi import Depends, HTTPException, status
from sqlalchemy import func, select

from bimdossier_api.db import get_session_maker
from bimdossier_api.jobs import require_worker_secret
from bimdossier_api.models.pooled_document import PooledDocument
from bimdossier_api.models.pooled_project_file import PooledProjectFile
from bimdossier_api.models.pooled_project_member import PooledProjectMember
from bimdossier_api.notifications.pooled_service import emit_pooled_job_notification
from bimdossier_api.routers.pooled._shared import (
    PooledCallbackRequest,
    PooledPagesCallbackRequest,
    internal_router,
)
from bimdossier_api.storage.scoping import (
    assert_key_scoped,
    assert_pooled_key_scoped,
    pooled_key_prefix,
)

# ---------------------------------------------------------------------------
# Worker callback (secret-gated, superuser session — RLS-bypassing)
# ---------------------------------------------------------------------------


@internal_router.post("/pooled-callback", status_code=status.HTTP_200_OK)
async def pooled_extraction_callback(
    payload: PooledCallbackRequest,
    _: None = Depends(require_worker_secret),
) -> dict[str, bool]:
    # Notification inputs captured inside the txn, emitted POST-commit (best-effort,
    # never blocking/failing the worker callback). None = no notification (running /
    # idempotent no-op).
    notify: dict[str, object] | None = None
    async with get_session_maker()() as session, session.begin():
        # Superuser session bypasses RLS — operate cross-user by id, so every
        # artifact key MUST be validated against the OWNER's prefix below.
        row = await session.get(PooledProjectFile, payload.file_id, with_for_update=True)
        if row is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="FREE_FILE_NOT_FOUND")
        if row.extraction_status in ("succeeded", "failed"):
            return {"ok": True}  # terminal — idempotent no-op

        owner = row.owner_user_id
        if payload.status == "running":
            row.extraction_status = "running"
            row.extraction_started_at = func.now()
        elif payload.status == "succeeded":
            # Bind every worker-supplied artifact key to THIS file's own namespace,
            # not just the owner prefix. Artifacts are siblings of the source object
            # (the processor derives them by suffix-replace — see
            # apps/processor/src/storage/s3.ts), so they must live under
            # free/<owner>/<document>/<file>/, reconstructed here from trusted row
            # columns. The owner check stays as the cross-user boundary; the
            # file-prefix check adds the cross-file boundary within the owner.
            file_prefix = f"{pooled_key_prefix(owner)}{row.pooled_document_id}/{row.id}/"
            for key in (
                payload.fragments_key,
                payload.metadata_key,
                payload.outline_key,
                payload.properties_key,
                payload.floor_plans_key,
                payload.geometry_key,
            ):
                assert_pooled_key_scoped(key, owner)
                assert_key_scoped(key, file_prefix, detail="INVALID_FREE_STORAGE_KEY")
            row.fragments_storage_key = payload.fragments_key
            row.metadata_storage_key = payload.metadata_key
            row.outline_storage_key = payload.outline_key
            row.properties_storage_key = payload.properties_key
            row.floor_plans_storage_key = payload.floor_plans_key
            # PDF artifacts (None for IFC; fragments None for PDF).
            row.geometry_storage_key = payload.geometry_key
            row.page_count = payload.page_count
            row.extraction_status = "succeeded"
            row.extraction_error = None
            row.extraction_finished_at = func.now()
            row.extractor_version = payload.extractor_version
        elif payload.status == "failed":
            row.extraction_status = "failed"
            row.extraction_error = (payload.error or "extraction failed")[:2000]
            row.extraction_finished_at = func.now()
        else:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="VALIDATION_ERROR",
            )

        # On a terminal state, capture the fan-out set (owner + invited members of
        # the model's project) so the post-commit emit can notify each recipient.
        if payload.status in ("succeeded", "failed"):
            project_id = await session.scalar(
                select(PooledDocument.pooled_project_id).where(
                    PooledDocument.id == row.pooled_document_id
                )
            )
            member_ids = (
                (
                    await session.execute(
                        select(PooledProjectMember.user_id).where(
                            PooledProjectMember.pooled_project_id == project_id
                        )
                    )
                )
                .scalars()
                .all()
                if project_id is not None
                else []
            )
            notify = {
                "event_type": ("job_succeeded" if payload.status == "succeeded" else "job_failed"),
                "recipients": list({owner, *member_ids}),
                "file_id": row.id,
                "document_id": row.pooled_document_id,
                "project_id": project_id,
                "filename": row.original_filename,
                "error": payload.error if payload.status == "failed" else None,
            }

    if notify is not None:
        await emit_pooled_job_notification(**notify)  # type: ignore[arg-type]
    return {"ok": True}


@internal_router.post("/pooled-pages-callback", status_code=status.HTTP_200_OK)
async def pooled_pages_rasterization_callback(
    payload: PooledPagesCallbackRequest,
    _: None = Depends(require_worker_secret),
) -> dict[str, bool]:
    """Worker → API callback for the free `pdf_pages_rasterization` sibling job.

    Records the page-image manifest key on the free file so the pdfjs-free mobile
    viewer can render the PDF. Additive — never touches `extraction_status`
    (pdf_extraction owns that field), so it sidesteps the terminal-state guard in
    the extraction callback. Superuser session (RLS-bypassing), so the key is
    validated against the OWNER's prefix. Idempotent + best-effort: a non-success
    status (or a vanished file) is a no-op, since the page raster is a bonus."""
    if payload.status != "succeeded" or payload.pdf_pages_key is None:
        return {"ok": True}
    async with get_session_maker()() as session, session.begin():
        row = await session.get(PooledProjectFile, payload.file_id, with_for_update=True)
        if row is None:
            return {"ok": True}  # file gone — nothing to stamp
        assert_pooled_key_scoped(payload.pdf_pages_key, row.owner_user_id)
        assert_key_scoped(
            payload.pdf_pages_key,
            f"{pooled_key_prefix(row.owner_user_id)}{row.pooled_document_id}/{row.id}/",
            detail="INVALID_FREE_STORAGE_KEY",
        )
        row.pdf_pages_storage_key = payload.pdf_pages_key
        if payload.page_count is not None and row.page_count is None:
            row.page_count = payload.page_count
    return {"ok": True}
