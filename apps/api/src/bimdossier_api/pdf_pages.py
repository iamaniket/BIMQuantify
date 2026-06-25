"""Find-or-create helper for the logical ``pdf_pages`` table.

Shared by the aligned-sheet and finding routers so a page can be pinned on
demand — before (or without) extraction having materialized it. The SAVEPOINT
(``begin_nested``) isolates the speculative insert: if a concurrent request won
the race on ``uq_pdf_pages_model_page``, the savepoint rolls back without
poisoning the surrounding request transaction and we re-read the winner.

``page_number`` is 1-indexed (the canonical PdfPage convention). Callers holding
a 0-based ``page_index`` add 1 first.
"""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from bimdossier_api.models.pdf_pages import PdfPage


async def _find(session: AsyncSession, pdf_document_id: UUID, page_number: int) -> PdfPage | None:
    return (
        await session.execute(
            select(PdfPage).where(
                PdfPage.pdf_document_id == pdf_document_id,
                PdfPage.page_number == page_number,
                PdfPage.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()


async def find_or_create_pdf_page(
    session: AsyncSession, pdf_document_id: UUID, page_number: int
) -> PdfPage:
    """Return the active PdfPage for ``(pdf_document_id, page_number)``, creating it
    if absent. Race-safe via a SAVEPOINT around the speculative insert."""
    page = await _find(session, pdf_document_id, page_number)
    if page is not None:
        return page
    try:
        async with session.begin_nested():
            page = PdfPage(pdf_document_id=pdf_document_id, page_number=page_number)
            session.add(page)
            await session.flush()
    except IntegrityError:
        page = await _find(session, pdf_document_id, page_number)
        if page is None:
            raise  # not a uniqueness race — a genuine integrity error
    return page
