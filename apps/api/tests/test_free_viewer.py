"""Tests for the free-tier Document → ProjectFile API surface (the "free wedge").

Covers: container CRUD, the two-phase file upload (initiate/complete, validation
+ caps + dedup), the free extraction dispatch shape (tier=free, callback_path,
geometry_threshold), the free callback (artifact-key scoping + terminal
idempotency), the per-file viewer-bundle, document-scoped snag CRUD, versioning +
restore (F7), the global extraction cap, the reapers, GDPR purge, and — the
critical security gate — RLS isolation between two free users running as bim_app.

Shared helpers here (`_create_project`, `_create_document`, `_initiate_file`,
`_complete_file`, `_upload`) are imported by test_pooled_projects.py and
test_free_conversion.py.
"""

import hashlib
import os
from uuid import UUID, uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from bimdossier_api.config import get_settings
from bimdossier_api.models.pooled_document import PooledDocument
from bimdossier_api.models.pooled_project_file import PooledProjectFile
from bimdossier_api.models.user import User
from tests.conftest import FakeStorage, make_test_user

# Minimal valid STEP-21 / IFC4 header for the complete-phase header parse.
_IFC_HEADER = (
    b"ISO-10303-21;\nHEADER;\n"
    b"FILE_DESCRIPTION((''),'2;1');\n"
    b"FILE_NAME('x','',(),(),'','','');\n"
    b"FILE_SCHEMA(('IFC4'));\nENDSEC;\nDATA;\n"
)


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _sha(seed: str) -> str:
    """Deterministic, distinct 64-hex content hash per seed (initiate requires it)."""
    return hashlib.sha256(seed.encode()).hexdigest()


async def _free_token(
    client: AsyncClient,
    session_maker: async_sessionmaker[AsyncSession],
    email: str,
) -> str:
    await make_test_user(session_maker, email=email, is_verified=True)
    login = await client.post(
        "/auth/jwt/login",
        data={"username": email, "password": "correct-horse-battery"},
    )
    assert login.status_code == 200, login.text
    return login.json()["access_token"]


async def _create_project(client: AsyncClient, token: str, *, name: str = "My House") -> str:
    resp = await client.post("/free/projects", json={"name": name}, headers=_auth(token))
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


async def _create_document(
    client: AsyncClient,
    token: str,
    project_id: str,
    *,
    name: str = "House",
    discipline: str | None = None,
) -> str:
    body: dict[str, str] = {"name": name}
    if discipline is not None:
        body["discipline"] = discipline
    resp = await client.post(
        f"/free/projects/{project_id}/documents", json=body, headers=_auth(token)
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


async def _initiate_file(
    client: AsyncClient,
    token: str,
    project_id: str,
    document_id: str,
    *,
    filename: str = "house.ifc",
    size: int = 1000,
    sha: str | None = None,
) -> dict:
    resp = await client.post(
        f"/free/projects/{project_id}/documents/{document_id}/files/initiate",
        json={
            "filename": filename,
            "size_bytes": size,
            "content_type": "application/octet-stream",
            "content_sha256": sha or _sha(filename),
        },
        headers=_auth(token),
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _complete_file(
    client: AsyncClient, token: str, project_id: str, document_id: str, file_id: str
) -> dict:
    resp = await client.post(
        f"/free/projects/{project_id}/documents/{document_id}/files/{file_id}/complete",
        headers=_auth(token),
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


async def _upload(
    client: AsyncClient,
    fake: FakeStorage,
    token: str,
    project_id: str,
    document_id: str,
    *,
    filename: str = "house.ifc",
    size: int = 1000,
) -> dict:
    """initiate → stage bytes → complete; returns the completed ProjectFileRead."""
    init = await _initiate_file(
        client, token, project_id, document_id, filename=filename, size=size
    )
    fake.objects[init["storage_key"]] = _IFC_HEADER
    body = await _complete_file(client, token, project_id, document_id, init["file_id"])
    return {**body, "storage_key": init["storage_key"]}


async def _callback_succeeded(
    client: AsyncClient, file_id: str, storage_key: str
) -> None:
    """Drive the worker free-callback to terminal `succeeded` for a file."""
    secret = get_settings().processor_shared_secret
    prefix = storage_key.rsplit("/", 1)[0]  # free/<uid>/<doc>/<file>
    resp = await client.post(
        "/internal/jobs/free-callback",
        json={
            "file_id": file_id,
            "status": "succeeded",
            "fragments_key": f"{prefix}/source.frag",
            "metadata_key": f"{prefix}/source.metadata.json",
            "outline_key": f"{prefix}/source.outline.bin",
        },
        headers={"Authorization": f"Bearer {secret}"},
    )
    assert resp.status_code == 200, resp.text


# ---------------------------------------------------------------------------


async def test_create_document_and_complete_dispatches_free_extraction(
    free_tier_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
    job_dispatch_calls: list[dict],
) -> None:
    client, fake = free_tier_storage_client
    token = await _free_token(client, session_maker, "free-upload@example.com")
    pid = await _create_project(client, token)
    did = await _create_document(client, token, pid)

    init = await _initiate_file(client, token, pid, did)
    assert init["storage_key"].startswith("free/")
    assert f"/{did}/" in init["storage_key"]
    fake.objects[init["storage_key"]] = _IFC_HEADER

    body = await _complete_file(client, token, pid, did, init["file_id"])
    assert body["status"] == "ready"
    assert body["extraction_status"] == "queued"
    assert body["ifc_schema"] == "IFC4"
    assert body["role"] == "model_source"
    assert body["document_id"] == did
    assert body["project_id"] == pid
    assert body["version_number"] == 1

    assert len(job_dispatch_calls) == 1
    call = job_dispatch_calls[0]
    assert call["job_type"] == "ifc_extraction"
    assert call["priority"] == get_settings().job_priority_free  # 100 (free)
    assert call["payload"]["callback_path"] == "/internal/jobs/free-callback"
    assert call["payload"]["geometry_threshold"] == get_settings().pooled_job_geometry_threshold
    assert call["payload"]["file_id"] == init["file_id"]


async def test_create_document_requires_project_ownership(
    free_tier_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    client, _ = free_tier_storage_client
    token_a = await _free_token(client, session_maker, "free-owner@example.com")
    token_b = await _free_token(client, session_maker, "free-other@example.com")
    pid = await _create_project(client, token_a)
    # B is not the owner → 404 (RLS hides the project).
    resp = await client.post(
        f"/free/projects/{pid}/documents", json={"name": "x"}, headers=_auth(token_b)
    )
    assert resp.status_code == 404


async def test_duplicate_name_conflicts(
    free_tier_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    client, _ = free_tier_storage_client
    token = await _free_token(client, session_maker, "free-dupname@example.com")
    pid = await _create_project(client, token)
    await _create_document(client, token, pid, name="Same")
    resp = await client.post(
        f"/free/projects/{pid}/documents", json={"name": "Same"}, headers=_auth(token)
    )
    assert resp.status_code == 409
    assert resp.json()["detail"] == "DOCUMENT_NAME_CONFLICT"


async def test_initiate_rejects_bad_extension(
    free_tier_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    client, _ = free_tier_storage_client
    token = await _free_token(client, session_maker, "free-badext@example.com")
    pid = await _create_project(client, token)
    did = await _create_document(client, token, pid)
    resp = await client.post(
        f"/free/projects/{pid}/documents/{did}/files/initiate",
        json={
            "filename": "notes.txt",
            "size_bytes": 10,
            "content_type": "text/plain",
            "content_sha256": _sha("notes"),
        },
        headers=_auth(token),
    )
    assert resp.status_code == 400
    assert resp.json()["detail"] == "INVALID_FILE_EXTENSION"


async def test_initiate_rejects_oversized(
    free_tier_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    client, _ = free_tier_storage_client
    token = await _free_token(client, session_maker, "free-big@example.com")
    pid = await _create_project(client, token)
    did = await _create_document(client, token, pid)
    too_big = get_settings().free_upload_max_bytes + 1
    resp = await client.post(
        f"/free/projects/{pid}/documents/{did}/files/initiate",
        json={
            "filename": "huge.ifc",
            "size_bytes": too_big,
            "content_type": "application/octet-stream",
            "content_sha256": _sha("huge"),
        },
        headers=_auth(token),
    )
    assert resp.status_code == 413
    assert resp.json()["detail"] == "FREE_UPLOAD_TOO_LARGE"


async def test_initiate_dedups_identical_content(
    free_tier_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    client, _ = free_tier_storage_client
    token = await _free_token(client, session_maker, "free-dedup@example.com")
    pid = await _create_project(client, token)
    did = await _create_document(client, token, pid)
    sha = _sha("identical")
    await _initiate_file(client, token, pid, did, filename="a.ifc", sha=sha)
    resp = await client.post(
        f"/free/projects/{pid}/documents/{did}/files/initiate",
        json={
            "filename": "a-copy.ifc",
            "size_bytes": 1000,
            "content_type": "application/octet-stream",
            "content_sha256": sha,
        },
        headers=_auth(token),
    )
    assert resp.status_code == 409
    assert resp.json()["detail"]["code"] == "DUPLICATE_FILE_CONTENT"


async def test_document_cap_enforced(
    free_tier_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client, _ = free_tier_storage_client
    token = await _free_token(client, session_maker, "free-cap@example.com")
    pid = await _create_project(client, token)
    monkeypatch.setenv("FREE_MAX_MODELS_PER_USER", "2")
    get_settings.cache_clear()
    try:
        await _create_document(client, token, pid, name="a")
        await _create_document(client, token, pid, name="b")
        resp = await client.post(
            f"/free/projects/{pid}/documents", json={"name": "c"}, headers=_auth(token)
        )
        assert resp.status_code == 403
        assert resp.json()["detail"] == "FREE_MODEL_CAP_REACHED"
    finally:
        monkeypatch.delenv("FREE_MAX_MODELS_PER_USER", raising=False)
        get_settings.cache_clear()


async def test_rls_isolation_between_free_users(
    free_tier_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """THE security gate: user B cannot see or touch user A's container/files/findings."""
    client, _ = free_tier_storage_client
    token_a = await _free_token(client, session_maker, "free-a@example.com")
    token_b = await _free_token(client, session_maker, "free-b@example.com")

    pid = await _create_project(client, token_a)
    did = await _create_document(client, token_a, pid)

    # B cannot read A's container, nor list its files.
    assert (
        await client.get(
            f"/free/projects/{pid}/documents/{did}", headers=_auth(token_b)
        )
    ).status_code == 404
    list_b = await client.get(
        f"/free/projects/{pid}/documents", headers=_auth(token_b)
    )
    # RLS hides the project's containers from a non-participant.
    assert list_b.status_code == 200
    assert list_b.json() == []

    # B cannot snag on A's container.
    snag_b = await client.post(
        f"/free/documents/{did}/findings",
        json={"title": "intrusion", "severity": "high"},
        headers=_auth(token_b),
    )
    assert snag_b.status_code == 404

    # A still sees their own container.
    assert (
        await client.get(
            f"/free/projects/{pid}/documents/{did}", headers=_auth(token_a)
        )
    ).status_code == 200


async def test_free_callback_scoping_and_idempotency(
    free_tier_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    client, fake = free_tier_storage_client
    token = await _free_token(client, session_maker, "free-cb@example.com")
    pid = await _create_project(client, token)
    did = await _create_document(client, token, pid)
    init = await _initiate_file(client, token, pid, did)
    file_id = init["file_id"]
    fake.objects[init["storage_key"]] = _IFC_HEADER
    await _complete_file(client, token, pid, did, file_id)

    secret = get_settings().processor_shared_secret
    worker_auth = {"Authorization": f"Bearer {secret}"}
    prefix = init["storage_key"].rsplit("/", 1)[0]

    # A key under another user's prefix is rejected (load-bearing on the no-RLS path).
    bad = await client.post(
        "/internal/jobs/free-callback",
        json={
            "file_id": file_id,
            "status": "succeeded",
            "fragments_key": f"free/{uuid4()}/{did}/source.frag",
        },
        headers=worker_auth,
    )
    assert bad.status_code == 400
    assert bad.json()["detail"] == "INVALID_FREE_STORAGE_KEY"

    # Correctly-scoped success stamps the artifact keys (incl. the 2D floor-plan
    # artifact the processor generates for architectural/mixed free models).
    ok = await client.post(
        "/internal/jobs/free-callback",
        json={
            "file_id": file_id,
            "status": "succeeded",
            "fragments_key": f"{prefix}/source.frag",
            "metadata_key": f"{prefix}/source.metadata.json",
            "outline_key": f"{prefix}/source.outline.bin",
            "floor_plans_key": f"{prefix}/source.floor-plans.bin",
        },
        headers=worker_auth,
    )
    assert ok.status_code == 200, ok.text

    # Per-file viewer-bundle is now available, including the 2D floor-plan URL so
    # the unified viewer's 2D pane works for free models.
    bundle = await client.get(
        f"/free/projects/{pid}/documents/{did}/files/{file_id}/viewer-bundle",
        headers=_auth(token),
    )
    assert bundle.status_code == 200, bundle.text
    assert bundle.json()["file_type"] == "ifc"
    assert "source.frag" in bundle.json()["fragments_url"]
    assert "floor-plans.bin" in (bundle.json()["floor_plans_url"] or "")

    # Terminal state is idempotent — a replayed callback is a no-op 200.
    replay = await client.post(
        "/internal/jobs/free-callback",
        json={"file_id": file_id, "status": "failed", "error": "late"},
        headers=worker_auth,
    )
    assert replay.status_code == 200
    detail = await client.get(
        f"/free/projects/{pid}/documents/{did}", headers=_auth(token)
    )
    assert detail.json()["versions"][0]["extraction_status"] == "succeeded"


async def test_viewer_bundle_not_ready(
    free_tier_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    client, _ = free_tier_storage_client
    token = await _free_token(client, session_maker, "free-notready@example.com")
    pid = await _create_project(client, token)
    did = await _create_document(client, token, pid)
    init = await _initiate_file(client, token, pid, did)
    resp = await client.get(
        f"/free/projects/{pid}/documents/{did}/files/{init['file_id']}/viewer-bundle",
        headers=_auth(token),
    )
    assert resp.status_code == 409
    assert resp.json()["detail"] == "FREE_NOT_READY"


async def test_snag_crud(
    free_tier_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    client, _ = free_tier_storage_client
    token = await _free_token(client, session_maker, "free-snag@example.com")
    pid = await _create_project(client, token)
    did = await _create_document(client, token, pid)

    created = await client.post(
        f"/free/documents/{did}/findings",
        json={
            "title": "Crack in wall",
            "note": "near grid B2",
            "severity": "high",
            "anchor_x": 1.0,
            "anchor_y": 2.0,
            "anchor_z": 3.0,
            "linked_element_global_id": "2O2Fr$t4X7Zf8NOew3FNld",
        },
        headers=_auth(token),
    )
    assert created.status_code == 201, created.text
    snag_id = created.json()["id"]
    assert created.json()["status"] == "open"
    # Free snags now serialize as the paid FindingRead (linked_document_id ==
    # the container) — the single server-side shape, no client adapter.
    assert created.json()["linked_document_id"] == did

    listed = await client.get(f"/free/documents/{did}/findings", headers=_auth(token))
    assert listed.status_code == 200
    assert len(listed.json()) == 1

    patched = await client.patch(
        f"/free/findings/{snag_id}",
        json={"status": "resolved", "severity": "low"},
        headers=_auth(token),
    )
    assert patched.status_code == 200
    assert patched.json()["status"] == "resolved"
    assert patched.json()["severity"] == "low"

    deleted = await client.delete(f"/free/findings/{snag_id}", headers=_auth(token))
    assert deleted.status_code == 204
    listed2 = await client.get(f"/free/documents/{did}/findings", headers=_auth(token))
    assert listed2.json() == []


async def test_snag_assignee_and_deadline(
    free_tier_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """A snag can be assigned to a project participant (here the owner) + carry a
    deadline; both round-trip through PooledFindingRead. Assigning to a non-participant
    is a 422 ASSIGNEE_NOT_A_PROJECT_MEMBER."""
    client, _ = free_tier_storage_client
    token = await _free_token(client, session_maker, "free-assign@example.com")
    pid = await _create_project(client, token)
    did = await _create_document(client, token, pid)

    # The owner is a participant (synthesized into the members list).
    members = await client.get(f"/free/projects/{pid}/members", headers=_auth(token))
    assert members.status_code == 200
    owner_id = next(m["user_id"] for m in members.json() if m["role"] == "owner")

    # Create assigned to the owner, with a deadline.
    created = await client.post(
        f"/free/documents/{did}/findings",
        json={
            "title": "Assign me",
            "severity": "medium",
            "assigned_to_user_id": owner_id,
            "deadline_date": "2026-12-31",
        },
        headers=_auth(token),
    )
    assert created.status_code == 201, created.text
    assert created.json()["assignee_user_id"] == owner_id
    assert created.json()["deadline_date"] == "2026-12-31"

    # Assigning to a non-participant is rejected.
    bad = await client.post(
        f"/free/documents/{did}/findings",
        json={"title": "Bad assignee", "assigned_to_user_id": str(uuid4())},
        headers=_auth(token),
    )
    assert bad.status_code == 422
    assert bad.json()["detail"] == "ASSIGNEE_NOT_A_PROJECT_MEMBER"

    # PATCH assignment + deadline onto a plain snag.
    plain = await client.post(
        f"/free/documents/{did}/findings", json={"title": "Plain"}, headers=_auth(token)
    )
    assert plain.status_code == 201
    assert plain.json()["assignee_user_id"] is None
    patched = await client.patch(
        f"/free/findings/{plain.json()['id']}",
        json={"assigned_to_user_id": owner_id, "deadline_date": "2027-01-15"},
        headers=_auth(token),
    )
    assert patched.status_code == 200
    assert patched.json()["assignee_user_id"] == owner_id
    assert patched.json()["deadline_date"] == "2027-01-15"

    # PATCH assigning to a non-participant is still rejected.
    bad_patch = await client.patch(
        f"/free/findings/{plain.json()['id']}",
        json={"assigned_to_user_id": str(uuid4())},
        headers=_auth(token),
    )
    assert bad_patch.status_code == 422
    assert bad_patch.json()["detail"] == "ASSIGNEE_NOT_A_PROJECT_MEMBER"


async def test_snag_patch_clears_and_preserves_assignment(
    free_tier_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """PATCH semantics: an OMITTED field is left unchanged, an explicit null
    CLEARS a nullable column (assignee/deadline), and a null on a NOT-NULL column
    (title) is ignored. Regression for the bare-None 'can't unassign' bug."""
    client, _ = free_tier_storage_client
    token = await _free_token(client, session_maker, "free-clear@example.com")
    pid = await _create_project(client, token)
    did = await _create_document(client, token, pid)

    members = await client.get(f"/free/projects/{pid}/members", headers=_auth(token))
    owner_id = next(m["user_id"] for m in members.json() if m["role"] == "owner")

    created = await client.post(
        f"/free/documents/{did}/findings",
        json={
            "title": "Clearable",
            "assigned_to_user_id": owner_id,
            "deadline_date": "2026-12-31",
        },
        headers=_auth(token),
    )
    assert created.status_code == 201, created.text
    fid = created.json()["id"]

    # Omitting assignee/deadline leaves them untouched.
    only_title = await client.patch(
        f"/free/findings/{fid}", json={"title": "Renamed"}, headers=_auth(token)
    )
    assert only_title.status_code == 200, only_title.text
    assert only_title.json()["title"] == "Renamed"
    assert only_title.json()["assignee_user_id"] == owner_id
    assert only_title.json()["deadline_date"] == "2026-12-31"

    # An explicit null clears both nullable columns.
    cleared = await client.patch(
        f"/free/findings/{fid}",
        json={"assigned_to_user_id": None, "deadline_date": None},
        headers=_auth(token),
    )
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["assignee_user_id"] is None
    assert cleared.json()["deadline_date"] is None

    # A null on the NOT-NULL title column is ignored (value preserved).
    keep_title = await client.patch(
        f"/free/findings/{fid}", json={"title": None}, headers=_auth(token)
    )
    assert keep_title.status_code == 200, keep_title.text
    assert keep_title.json()["title"] == "Renamed"


async def test_versioning_and_restore(
    free_tier_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """Two versions in one container, then restore v1 as the head (F7)."""
    client, fake = free_tier_storage_client
    token = await _free_token(client, session_maker, "free-versions@example.com")
    pid = await _create_project(client, token)
    did = await _create_document(client, token, pid)

    v1 = await _upload(client, fake, token, pid, did, filename="v1.ifc")
    await _callback_succeeded(client, v1["id"], v1["storage_key"])  # free the slot
    v2 = await _upload(client, fake, token, pid, did, filename="v2.ifc")
    await _callback_succeeded(client, v2["id"], v2["storage_key"])

    doc = await client.get(
        f"/free/projects/{pid}/documents/{did}", headers=_auth(token)
    )
    assert doc.status_code == 200
    body = doc.json()
    assert len(body["versions"]) == 2
    assert body["head_file_id"] is None  # newest (v2) is the implicit head
    assert {v["version_number"] for v in body["versions"]} == {1, 2}

    restore = await client.post(
        f"/free/projects/{pid}/documents/{did}/files/{v1['id']}/restore",
        headers=_auth(token),
    )
    assert restore.status_code == 200, restore.text
    assert restore.json()["head_file_id"] == v1["id"]

    # Restoring the current head again is a no-op 409.
    again = await client.post(
        f"/free/projects/{pid}/documents/{did}/files/{v1['id']}/restore",
        headers=_auth(token),
    )
    assert again.status_code == 409
    assert again.json()["detail"] == "VERSION_ALREADY_HEAD"


async def test_global_extraction_cap(
    free_tier_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """With the global cap at its default of 1, a second concurrent extraction is
    refused (the first stays `queued` because dispatch is stubbed)."""
    client, fake = free_tier_storage_client
    token = await _free_token(client, session_maker, "free-cap2@example.com")
    pid = await _create_project(client, token)
    d1 = await _create_document(client, token, pid, name="m1")
    d2 = await _create_document(client, token, pid, name="m2")

    i1 = await _initiate_file(client, token, pid, d1, filename="m1.ifc")
    fake.objects[i1["storage_key"]] = _IFC_HEADER
    r1 = await _complete_file(client, token, pid, d1, i1["file_id"])
    assert r1["extraction_status"] == "queued"

    i2 = await _initiate_file(client, token, pid, d2, filename="m2.ifc")
    fake.objects[i2["storage_key"]] = _IFC_HEADER
    resp = await client.post(
        f"/free/projects/{pid}/documents/{d2}/files/{i2['file_id']}/complete",
        headers=_auth(token),
    )
    assert resp.status_code == 503
    assert resp.json()["detail"] == "FREE_EXTRACTION_BUSY"


async def test_free_stuck_extraction_reaper(
    free_tier_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """A free file stuck in `running` past the timeout is force-failed by the
    reconciliation sweep (free files have no tenant Job)."""
    from bimdossier_api.pooled_reconcile import sweep_stuck_pooled_extractions

    client, _ = free_tier_storage_client
    token = await _free_token(client, session_maker, "free-reaper@example.com")
    pid = await _create_project(client, token)
    did = await _create_document(client, token, pid)
    init = await _initiate_file(client, token, pid, did)
    file_id = init["file_id"]

    async with session_maker() as s:
        await s.execute(
            text(
                "UPDATE pooled_project_files SET extraction_status='running', "
                "updated_at = now() - interval '2 hours' WHERE id = :id"
            ),
            {"id": UUID(file_id)},
        )
        await s.commit()

    failed = await sweep_stuck_pooled_extractions(60)
    assert failed >= 1
    doc = await client.get(
        f"/free/projects/{pid}/documents/{did}", headers=_auth(token)
    )
    assert doc.json()["versions"][0]["extraction_status"] == "failed"


async def test_idle_free_container_reaper(
    free_tier_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """A free container with no viewer activity past the TTL is deleted (rows +
    objects) by the idle reaper."""
    from bimdossier_api.pooled_reconcile import sweep_idle_pooled_containers

    client, fake = free_tier_storage_client
    token = await _free_token(client, session_maker, "free-idle@example.com")
    pid = await _create_project(client, token)
    did = await _create_document(client, token, pid)
    init = await _initiate_file(client, token, pid, did)
    fake.objects[init["storage_key"]] = b"x"

    async with session_maker() as s:
        await s.execute(
            text(
                "UPDATE pooled_documents SET last_viewed_at = now() - interval '40 days' "
                "WHERE id = :id"
            ),
            {"id": UUID(did)},
        )
        await s.commit()

    reaped = await sweep_idle_pooled_containers(30, storage=fake)
    assert reaped >= 1
    detail = await client.get(
        f"/free/projects/{pid}/documents/{did}", headers=_auth(token)
    )
    assert detail.status_code == 404
    async with session_maker() as s:
        files = await s.scalar(
            select(func.count())
            .select_from(PooledProjectFile)
            .where(PooledProjectFile.pooled_document_id == UUID(did))
        )
    assert files == 0


async def test_free_data_purged_on_user_deletion(
    free_tier_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """Deleting (anonymizing) a user removes their pooled free projects/containers
    (cascade) — the ON DELETE CASCADE from public.users never fires on anonymize,
    so the delete path purges them explicitly (GDPR)."""
    client, _ = free_tier_storage_client
    free_token = await _free_token(client, session_maker, "free-gdpr@example.com")
    pid = await _create_project(client, free_token)
    did = await _create_document(client, free_token, pid)

    async with session_maker() as s:
        free_user_id = await s.scalar(
            select(User.id).where(User.email == "free-gdpr@example.com")
        )

    await make_test_user(
        session_maker, email="su-gdpr@example.com", is_verified=True, is_superuser=True
    )
    su_login = await client.post(
        "/auth/jwt/login",
        data={"username": "su-gdpr@example.com", "password": "correct-horse-battery"},
    )
    su_token = su_login.json()["access_token"]

    resp = await client.delete(f"/users/{free_user_id}", headers=_auth(su_token))
    assert resp.status_code in (200, 204), resp.text

    async with session_maker() as s:
        remaining = await s.scalar(
            select(func.count())
            .select_from(PooledDocument)
            .where(PooledDocument.id == UUID(did))
        )
    assert remaining == 0


async def test_free_endpoints_403_when_disabled(
    client: AsyncClient,
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """With FREE_TIER_ENABLED off, an authenticated call to /free/* is refused
    with 403 FREE_TIER_DISABLED."""
    prev = os.environ.get("FREE_TIER_ENABLED")
    os.environ["FREE_TIER_ENABLED"] = "false"
    get_settings.cache_clear()
    try:
        token = await _free_token(client, session_maker, "free-disabled@example.com")
        resp = await client.get("/free/projects", headers=_auth(token))
        assert resp.status_code == 403
        assert resp.json()["detail"] == "FREE_TIER_DISABLED"
    finally:
        if prev is None:
            os.environ.pop("FREE_TIER_ENABLED", None)
        else:
            os.environ["FREE_TIER_ENABLED"] = prev
        get_settings.cache_clear()
