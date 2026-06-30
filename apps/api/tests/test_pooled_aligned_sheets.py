"""Tests for free-tier PDF↔IFC calibration (pooled public.pooled_aligned_sheets).

A free user pins a PDF drawing page to a level's 3D slice, calibrates it with two
control points (the shared solve_similarity), and the sheet goes stale when a newer
PDF version reclaims the document head. RLS isolates sheets to owner + members.
"""

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from tests.conftest import FakeStorage
from tests.test_pooled_levels import _create_level
from tests.test_pooled_pdf import _PDF_BYTES, _pdf_callback_succeeded
from tests.test_pooled_viewer import (
    _auth,
    _complete_file,
    _create_document,
    _create_project,
    _free_token,
    _initiate_file,
)


async def _upload_pdf_version(
    client: AsyncClient,
    fake: FakeStorage,
    token: str,
    pid: str,
    did: str,
    *,
    filename: str,
) -> str:
    """initiate → stage %PDF → complete → drive the callback terminal (frees the
    single global extraction slot for the next upload); returns the file id."""
    init = await _initiate_file(client, token, pid, did, filename=filename)
    fake.objects[init["storage_key"]] = _PDF_BYTES
    await _complete_file(client, token, pid, did, init["file_id"])
    await _pdf_callback_succeeded(client, init["file_id"], init["storage_key"])
    return init["file_id"]


async def test_free_aligned_sheet_create_calibrate_and_drift(
    free_tier_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    client, fake = free_tier_storage_client
    token = await _free_token(client, session_maker, "free-align@example.com")
    pid = await _create_project(client, token)
    model3d = await _create_document(client, token, pid, name="Model")
    pdfdoc = await _create_document(client, token, pid, name="Plan")
    level = await _create_level(client, token, pid, name="Ground")
    pdf_v1 = await _upload_pdf_version(client, fake, token, pid, pdfdoc, filename="p1.pdf")

    # Create an uncalibrated sheet.
    created = await client.post(
        f"/pooled/projects/{pid}/aligned-sheets",
        json={
            "document_id": model3d,
            "level_id": level["id"],
            "pdf_document_id": pdfdoc,
            "page_number": 1,
        },
        headers=_auth(token),
    )
    assert created.status_code == 201, created.text
    sheet = created.json()
    assert sheet["is_calibrated"] is False
    assert sheet["page_number"] == 1 and sheet["page_index"] == 0

    # A second sheet on the same (level, page) conflicts.
    dup = await client.post(
        f"/pooled/projects/{pid}/aligned-sheets",
        json={
            "document_id": model3d,
            "level_id": level["id"],
            "pdf_document_id": pdfdoc,
            "page_number": 1,
        },
        headers=_auth(token),
    )
    assert dup.status_code == 409
    assert dup.json()["detail"] == "ALIGNED_SHEET_DUPLICATE"

    # Calibrate with two distinct points → solves a similarity (scale 2).
    cal = await client.post(
        f"/pooled/projects/{pid}/aligned-sheets/{sheet['id']}/calibrate",
        json={
            "pdf_points": [[0, 0], [10, 0]],
            "plan_points": [[0, 0], [20, 0]],
            "pdf_file_id": pdf_v1,
        },
        headers=_auth(token),
    )
    assert cal.status_code == 200, cal.text
    body = cal.json()
    assert body["is_calibrated"] is True
    assert abs(body["scale"] - 2.0) < 1e-6
    assert body["is_stale"] is False

    # Re-pin (PATCH) to a different page; the transform is preserved.
    repinned = await client.patch(
        f"/pooled/projects/{pid}/aligned-sheets/{sheet['id']}",
        json={"page_number": 2},
        headers=_auth(token),
    )
    assert repinned.status_code == 200, repinned.text
    assert repinned.json()["page_number"] == 2
    assert repinned.json()["page_index"] == 1
    assert repinned.json()["is_calibrated"] is True

    # Degenerate (coincident) points → 422.
    degenerate = await client.post(
        f"/pooled/projects/{pid}/aligned-sheets/{sheet['id']}/calibrate",
        json={"pdf_points": [[0, 0], [0, 0]], "plan_points": [[0, 0], [1, 0]]},
        headers=_auth(token),
    )
    assert degenerate.status_code == 422
    assert degenerate.json()["detail"] == "ALIGNED_SHEET_DEGENERATE_POINTS"

    # A newer PDF version reclaims the head → the sheet (calibrated on v1) is stale.
    await _upload_pdf_version(client, fake, token, pid, pdfdoc, filename="p2.pdf")
    listed = await client.get(
        f"/pooled/projects/{pid}/aligned-sheets", headers=_auth(token)
    )
    assert listed.status_code == 200
    assert listed.json()[0]["is_stale"] is True


async def test_pooled_aligned_sheets_rls_isolation(
    free_tier_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    client, _ = free_tier_storage_client
    token_a = await _free_token(client, session_maker, "free-align-a@example.com")
    token_b = await _free_token(client, session_maker, "free-align-b@example.com")
    pid = await _create_project(client, token_a)

    assert (
        await client.get(f"/pooled/projects/{pid}/aligned-sheets", headers=_auth(token_b))
    ).status_code == 404
    assert (
        await client.post(
            f"/pooled/projects/{pid}/aligned-sheets",
            json={
                "document_id": pid,
                "level_id": pid,
                "pdf_document_id": pid,
                "page_number": 1,
            },
            headers=_auth(token_b),
        )
    ).status_code == 404
