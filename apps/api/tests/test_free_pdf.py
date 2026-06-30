"""Tests for free-tier PDF upload + view (viewer parity).

A free user can upload a PDF drawing into a container; it runs `pdf_extraction`
(geometry + page_count for the desktop pdfjs viewer) AND `pdf_pages_rasterization`
(page images for the pdfjs-free MOBILE viewer). The free callbacks stamp the
geometry artifact + page_count and the page-image manifest, and the per-file
viewer-bundle serves it as a PDF (`file_type=pdf` + `file_url` + `geometry_url`
+ `pdf_pages_url`) for the SAME shared viewer the paid tier uses.
"""

import json
from uuid import uuid4

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from bimdossier_api.config import get_settings
from tests.conftest import FakeStorage
from tests.test_free_viewer import (
    _auth,
    _complete_file,
    _create_document,
    _create_project,
    _free_token,
    _initiate_file,
)

# Minimal valid PDF header (the complete-phase peek only checks the `%PDF` magic).
_PDF_BYTES = b"%PDF-1.7\n%\xe2\xe3\xcf\xd3\n1 0 obj\n<< /Type /Catalog >>\nendobj\n"


async def _pdf_callback_succeeded(
    client: AsyncClient, file_id: str, storage_key: str, *, page_count: int = 3
) -> None:
    """Drive the worker free-callback to terminal `succeeded` for a PDF — metadata
    + geometry + page_count, NO fragments (that's the IFC path)."""
    secret = get_settings().processor_shared_secret
    prefix = storage_key.rsplit("/", 1)[0]  # free/<uid>/<doc>/<file>
    resp = await client.post(
        "/internal/jobs/pooled-callback",
        json={
            "file_id": file_id,
            "status": "succeeded",
            "metadata_key": f"{prefix}/source.metadata.json",
            "geometry_key": f"{prefix}/source.geometry.json",
            "page_count": page_count,
        },
        headers={"Authorization": f"Bearer {secret}"},
    )
    assert resp.status_code == 200, resp.text


async def _pages_callback_succeeded(
    client: AsyncClient,
    fake: FakeStorage,
    file_id: str,
    storage_key: str,
    *,
    page_count: int = 3,
) -> str:
    """Stage a page-image manifest in storage + drive the free PAGES callback to
    `succeeded`. Returns the manifest key. Mirrors the processor's
    pdf_pages_rasterization output (a pages.json with per-page image keys)."""
    secret = get_settings().processor_shared_secret
    prefix = storage_key.rsplit("/", 1)[0]  # free/<uid>/<doc>/<file>
    manifest_key = f"{prefix}/source.pages.json"
    fake.objects[manifest_key] = json.dumps(
        {
            "v": 1,
            "pages": [
                {
                    "index": i,
                    "key": f"{prefix}/source.page-{i}.webp",
                    "pageWidth": 612,
                    "pageHeight": 792,
                    "imageWidth": 1224,
                    "imageHeight": 1584,
                }
                for i in range(page_count)
            ],
        }
    ).encode()
    resp = await client.post(
        "/internal/jobs/pooled-pages-callback",
        json={
            "file_id": file_id,
            "status": "succeeded",
            "pdf_pages_key": manifest_key,
            "page_count": page_count,
        },
        headers={"Authorization": f"Bearer {secret}"},
    )
    assert resp.status_code == 200, resp.text
    return manifest_key


async def test_free_pdf_upload_dispatches_pdf_extraction_and_views(
    free_tier_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
    job_dispatch_calls: list[dict],
) -> None:
    client, fake = free_tier_storage_client
    token = await _free_token(client, session_maker, "free-pdf@example.com")
    pid = await _create_project(client, token)
    did = await _create_document(client, token, pid)

    init = await _initiate_file(client, token, pid, did, filename="plan.pdf")
    assert init["storage_key"].endswith(".pdf")
    fake.objects[init["storage_key"]] = _PDF_BYTES

    body = await _complete_file(client, token, pid, did, init["file_id"])
    assert body["status"] == "ready"
    assert body["extraction_status"] == "queued"
    assert body["file_type"] == "pdf"

    # TWO jobs dispatched at the free priority: pdf_extraction (primary, → free
    # callback) + pdf_pages_rasterization (sibling, → free pages callback) so the
    # pdfjs-free mobile viewer can render this drawing. No IFC geometry_threshold.
    assert len(job_dispatch_calls) == 2
    by_type = {c["job_type"]: c for c in job_dispatch_calls}
    extraction = by_type["pdf_extraction"]
    assert extraction["priority"] == get_settings().job_priority_free
    assert extraction["payload"]["callback_path"] == "/internal/jobs/pooled-callback"
    assert extraction["payload"]["file_id"] == init["file_id"]
    assert "geometry_threshold" not in extraction["payload"]
    pages = by_type["pdf_pages_rasterization"]
    assert pages["priority"] == get_settings().job_priority_free
    assert pages["payload"]["callback_path"] == "/internal/jobs/pooled-pages-callback"
    assert pages["payload"]["file_id"] == init["file_id"]

    # Worker finishes extraction → geometry + page_count stamped.
    await _pdf_callback_succeeded(client, init["file_id"], init["storage_key"])

    # The viewer-bundle serves it as a PDF the shared desktop viewer can render.
    bundle = await client.get(
        f"/pooled/projects/{pid}/documents/{did}/files/{init['file_id']}/viewer-bundle",
        headers=_auth(token),
    )
    assert bundle.status_code == 200, bundle.text
    data = bundle.json()
    assert data["file_type"] == "pdf"
    assert data["file_url"] is not None  # raw PDF for pdfjs
    assert data["geometry_url"] is not None  # vector snap layer
    assert data["fragments_url"] is None  # not an IFC
    assert data["pdf_pages_url"] is None  # rasterization hasn't completed yet

    # The page-rasterization sibling completes → manifest stamped → the mobile
    # bundle now carries a fetchable pdf_pages_url (inlined data: manifest).
    await _pages_callback_succeeded(client, fake, init["file_id"], init["storage_key"])
    bundle2 = await client.get(
        f"/pooled/projects/{pid}/documents/{did}/files/{init['file_id']}/viewer-bundle",
        headers=_auth(token),
    )
    assert bundle2.status_code == 200, bundle2.text
    data2 = bundle2.json()
    assert data2["pdf_pages_url"] is not None
    assert data2["pdf_pages_url"].startswith("data:application/json;base64,")


async def test_free_pdf_rejects_non_pdf_bytes(
    free_tier_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """A `.pdf` whose bytes aren't a PDF is rejected at complete (magic-byte check)."""
    client, fake = free_tier_storage_client
    token = await _free_token(client, session_maker, "free-pdf-bad@example.com")
    pid = await _create_project(client, token)
    did = await _create_document(client, token, pid)

    init = await _initiate_file(client, token, pid, did, filename="fake.pdf")
    fake.objects[init["storage_key"]] = b"this is definitely not a pdf"

    body = await _complete_file(client, token, pid, did, init["file_id"])
    assert body["status"] == "rejected"
    assert body["rejection_reason"] == "FILE_NOT_VALID_PDF"


async def test_free_pages_callback_rejects_cross_owner_key(
    free_tier_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """The pages callback runs as superuser (RLS-bypassing), so a manifest key not
    under the OWNER's `free/<uid>/` prefix is rejected (400) — a forged key can't
    stamp another user's file."""
    client, fake = free_tier_storage_client
    token = await _free_token(client, session_maker, "free-pages-scope@example.com")
    pid = await _create_project(client, token)
    did = await _create_document(client, token, pid)
    init = await _initiate_file(client, token, pid, did, filename="plan.pdf")
    fake.objects[init["storage_key"]] = _PDF_BYTES
    await _complete_file(client, token, pid, did, init["file_id"])

    secret = get_settings().processor_shared_secret
    resp = await client.post(
        "/internal/jobs/pooled-pages-callback",
        json={
            "file_id": init["file_id"],
            "status": "succeeded",
            # A key under a DIFFERENT user's prefix — must be rejected.
            "pdf_pages_key": f"free/{uuid4()}/evil/source.pages.json",
        },
        headers={"Authorization": f"Bearer {secret}"},
    )
    assert resp.status_code == 400, resp.text
    assert resp.json()["detail"] == "INVALID_FREE_STORAGE_KEY"
