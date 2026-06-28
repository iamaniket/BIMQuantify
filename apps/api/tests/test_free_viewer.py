"""Tests for the free-tier ("free wedge") API surface.

Covers: upload initiate/complete (validation + caps), the free extraction
dispatch shape (tier=free, callback_path, geometry_threshold), the free
callback (artifact-key scoping + terminal idempotency), the viewer-bundle, snag
CRUD, the global extraction cap, and — the critical security gate — RLS
isolation between two free users running as bim_app.
"""

import os
from uuid import UUID, uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from bimdossier_api.config import get_settings
from bimdossier_api.models.free_model import FreeModel
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


async def _initiate(
    client: AsyncClient, token: str, *, filename: str = "house.ifc", size: int = 1000
) -> dict:
    resp = await client.post(
        "/free/models/initiate",
        json={"filename": filename, "size_bytes": size},
        headers=_auth(token),
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


async def test_complete_dispatches_free_extraction(
    free_tier_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
    job_dispatch_calls: list[dict],
) -> None:
    client, fake = free_tier_storage_client
    token = await _free_token(client, session_maker, "free-upload@example.com")

    init = await _initiate(client, token)
    assert init["storage_key"].startswith("free/")
    fake.objects[init["storage_key"]] = _IFC_HEADER

    resp = await client.post(
        f"/free/models/{init['model_id']}/complete", headers=_auth(token)
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "ready"
    assert body["extraction_status"] == "queued"
    assert body["ifc_schema"] == "IFC4"

    assert len(job_dispatch_calls) == 1
    call = job_dispatch_calls[0]
    assert call["job_type"] == "ifc_extraction"
    assert call["priority"] == get_settings().job_priority_free  # 100 (free)
    assert call["payload"]["callback_path"] == "/internal/jobs/free-callback"
    assert call["payload"]["geometry_threshold"] == get_settings().free_job_geometry_threshold
    assert call["payload"]["file_id"] == init["model_id"]


async def test_initiate_rejects_bad_extension(
    free_tier_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    client, _ = free_tier_storage_client
    token = await _free_token(client, session_maker, "free-badext@example.com")
    resp = await client.post(
        "/free/models/initiate",
        json={"filename": "notes.txt", "size_bytes": 10},
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
    too_big = get_settings().free_upload_max_bytes + 1
    resp = await client.post(
        "/free/models/initiate",
        json={"filename": "huge.ifc", "size_bytes": too_big},
        headers=_auth(token),
    )
    assert resp.status_code == 413
    assert resp.json()["detail"] == "FREE_UPLOAD_TOO_LARGE"


async def test_initiate_enforces_model_cap(
    free_tier_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client, _ = free_tier_storage_client
    token = await _free_token(client, session_maker, "free-cap@example.com")
    # Lower the cap for a fast test; the route is already mounted (flag stayed
    # on), and the handler reads the cap at request time.
    monkeypatch.setenv("FREE_MAX_MODELS_PER_USER", "2")
    get_settings.cache_clear()
    try:
        await _initiate(client, token, filename="a.ifc")
        await _initiate(client, token, filename="b.ifc")
        resp = await client.post(
            "/free/models/initiate",
            json={"filename": "c.ifc", "size_bytes": 10},
            headers=_auth(token),
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
    """THE security gate: user B cannot see or touch user A's free model/snags.
    Runs as bim_app + the owner GUC, so this exercises the real RLS boundary."""
    client, _ = free_tier_storage_client
    token_a = await _free_token(client, session_maker, "free-a@example.com")
    token_b = await _free_token(client, session_maker, "free-b@example.com")

    init = await _initiate(client, token_a)
    model_id = init["model_id"]

    # B cannot read A's model, and it's absent from B's list.
    assert (await client.get(f"/free/models/{model_id}", headers=_auth(token_b))).status_code == 404
    list_b = await client.get("/free/models", headers=_auth(token_b))
    assert list_b.status_code == 200
    assert list_b.json() == []

    # B cannot snag on, or delete, A's model.
    snag_b = await client.post(
        f"/free/models/{model_id}/snags",
        json={"title": "intrusion", "severity": "high"},
        headers=_auth(token_b),
    )
    assert snag_b.status_code == 404
    del_b = await client.delete(f"/free/models/{model_id}", headers=_auth(token_b))
    assert del_b.status_code == 404

    # A still sees their own model.
    assert (await client.get(f"/free/models/{model_id}", headers=_auth(token_a))).status_code == 200


async def test_free_callback_scoping_and_idempotency(
    free_tier_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    client, fake = free_tier_storage_client
    token = await _free_token(client, session_maker, "free-cb@example.com")
    init = await _initiate(client, token)
    model_id = init["model_id"]
    fake.objects[init["storage_key"]] = _IFC_HEADER
    await client.post(f"/free/models/{model_id}/complete", headers=_auth(token))

    secret = get_settings().processor_shared_secret
    worker_auth = {"Authorization": f"Bearer {secret}"}
    owner_prefix = init["storage_key"].rsplit("/", 1)[0]  # free/<uid>/<mid>

    # A key under another user's prefix is rejected (load-bearing on the no-RLS
    # callback path).
    bad = await client.post(
        "/internal/jobs/free-callback",
        json={
            "file_id": model_id,
            "status": "succeeded",
            "fragments_key": f"free/{uuid4()}/{model_id}/fragments.frag",
        },
        headers=worker_auth,
    )
    assert bad.status_code == 400
    assert bad.json()["detail"] == "INVALID_FREE_STORAGE_KEY"

    # Correctly-scoped success stamps the artifact keys.
    ok = await client.post(
        "/internal/jobs/free-callback",
        json={
            "file_id": model_id,
            "status": "succeeded",
            "fragments_key": f"{owner_prefix}/fragments.frag",
            "metadata_key": f"{owner_prefix}/metadata.json",
            "outline_key": f"{owner_prefix}/outline.bin",
        },
        headers=worker_auth,
    )
    assert ok.status_code == 200, ok.text

    detail = await client.get(f"/free/models/{model_id}", headers=_auth(token))
    assert detail.json()["extraction_status"] == "succeeded"

    # Viewer-bundle is now available with the federated scene id.
    bundle = await client.get(
        f"/free/models/{model_id}/viewer-bundle", headers=_auth(token)
    )
    assert bundle.status_code == 200, bundle.text
    assert bundle.json()["scene_id"] == f"file-{model_id}"
    assert "fragments.frag" in bundle.json()["fragments_url"]

    # Terminal state is idempotent — a replayed callback is a no-op 200.
    replay = await client.post(
        "/internal/jobs/free-callback",
        json={"file_id": model_id, "status": "failed", "error": "late"},
        headers=worker_auth,
    )
    assert replay.status_code == 200
    detail2 = await client.get(f"/free/models/{model_id}", headers=_auth(token))
    assert detail2.json()["extraction_status"] == "succeeded"


async def test_viewer_bundle_not_ready(
    free_tier_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    client, _ = free_tier_storage_client
    token = await _free_token(client, session_maker, "free-notready@example.com")
    init = await _initiate(client, token)
    resp = await client.get(
        f"/free/models/{init['model_id']}/viewer-bundle", headers=_auth(token)
    )
    assert resp.status_code == 409
    assert resp.json()["detail"] == "FREE_NOT_READY"


async def test_snag_crud(
    free_tier_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    client, _ = free_tier_storage_client
    token = await _free_token(client, session_maker, "free-snag@example.com")
    init = await _initiate(client, token)
    model_id = init["model_id"]

    created = await client.post(
        f"/free/models/{model_id}/snags",
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

    listed = await client.get(f"/free/models/{model_id}/snags", headers=_auth(token))
    assert listed.status_code == 200
    assert len(listed.json()) == 1

    patched = await client.patch(
        f"/free/snags/{snag_id}",
        json={"status": "resolved", "severity": "low"},
        headers=_auth(token),
    )
    assert patched.status_code == 200
    assert patched.json()["status"] == "resolved"
    assert patched.json()["severity"] == "low"

    deleted = await client.delete(f"/free/snags/{snag_id}", headers=_auth(token))
    assert deleted.status_code == 204
    listed2 = await client.get(f"/free/models/{model_id}/snags", headers=_auth(token))
    assert listed2.json() == []


async def test_global_extraction_cap(
    free_tier_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """With the global cap at its default of 1, a second concurrent extraction
    is refused (the first stays `queued` because dispatch is stubbed)."""
    client, fake = free_tier_storage_client
    token = await _free_token(client, session_maker, "free-cap2@example.com")

    init1 = await _initiate(client, token, filename="m1.ifc")
    fake.objects[init1["storage_key"]] = _IFC_HEADER
    r1 = await client.post(f"/free/models/{init1['model_id']}/complete", headers=_auth(token))
    assert r1.status_code == 200
    assert r1.json()["extraction_status"] == "queued"

    init2 = await _initiate(client, token, filename="m2.ifc")
    fake.objects[init2["storage_key"]] = _IFC_HEADER
    r2 = await client.post(f"/free/models/{init2['model_id']}/complete", headers=_auth(token))
    assert r2.status_code == 503
    assert r2.json()["detail"] == "FREE_EXTRACTION_BUSY"


async def test_free_stuck_extraction_reaper(
    free_tier_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """A free model stuck in `running` past the timeout is force-failed by the
    reconciliation sweep (free models have no tenant Job, so the tenant sweep
    can't see them)."""
    from bimdossier_api.free_reconcile import sweep_stuck_free_extractions

    client, _ = free_tier_storage_client
    token = await _free_token(client, session_maker, "free-reaper@example.com")
    init = await _initiate(client, token)
    model_id = init["model_id"]

    # Raw UPDATE (bypasses the ORM onupdate=now()) to backdate updated_at.
    async with session_maker() as s:
        await s.execute(
            text(
                "UPDATE free_models SET extraction_status='running', "
                "updated_at = now() - interval '2 hours' WHERE id = :id"
            ),
            {"id": UUID(model_id)},
        )
        await s.commit()

    failed = await sweep_stuck_free_extractions(60)
    assert failed >= 1
    detail = await client.get(f"/free/models/{model_id}", headers=_auth(token))
    assert detail.json()["extraction_status"] == "failed"


async def test_idle_free_model_reaper(
    free_tier_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """A free model with no viewer activity past the TTL is deleted (row +
    objects) by the idle reaper."""
    from bimdossier_api.free_reconcile import sweep_idle_free_models

    client, fake = free_tier_storage_client
    token = await _free_token(client, session_maker, "free-idle@example.com")
    init = await _initiate(client, token)
    model_id = init["model_id"]
    fake.objects[init["storage_key"]] = b"x"

    async with session_maker() as s:
        await s.execute(
            text(
                "UPDATE free_models SET last_viewed_at = now() - interval '40 days' "
                "WHERE id = :id"
            ),
            {"id": UUID(model_id)},
        )
        await s.commit()

    reaped = await sweep_idle_free_models(30, storage=fake)
    assert reaped >= 1
    # Row gone and its objects deleted.
    detail = await client.get(f"/free/models/{model_id}", headers=_auth(token))
    assert detail.status_code == 404
    assert init["storage_key"] not in fake.objects


async def test_free_data_purged_on_user_deletion(
    free_tier_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """Deleting (anonymizing) a user removes their pooled free models — the
    ON DELETE CASCADE from public.users never fires on anonymize, so the delete
    path purges them explicitly (GDPR)."""
    client, _ = free_tier_storage_client
    free_token = await _free_token(client, session_maker, "free-gdpr@example.com")
    init = await _initiate(client, free_token)
    model_id = init["model_id"]

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
            select(func.count()).select_from(FreeModel).where(FreeModel.id == UUID(model_id))
        )
    assert remaining == 0


async def test_free_endpoints_403_when_disabled(
    client: AsyncClient,
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """With FREE_TIER_ENABLED off, an authenticated call to /free/* is refused
    with 403 FREE_TIER_DISABLED — the router is mounted but every user endpoint
    is flag-gated. Force the flag off explicitly (the dev `.env` may enable it),
    restoring the env + settings cache afterward so nothing leaks to later tests."""
    prev = os.environ.get("FREE_TIER_ENABLED")
    os.environ["FREE_TIER_ENABLED"] = "false"
    get_settings.cache_clear()
    try:
        token = await _free_token(client, session_maker, "free-disabled@example.com")
        resp = await client.get("/free/models", headers=_auth(token))
        assert resp.status_code == 403
        assert resp.json()["detail"] == "FREE_TIER_DISABLED"
    finally:
        if prev is None:
            os.environ.pop("FREE_TIER_ENABLED", None)
        else:
            os.environ["FREE_TIER_ENABLED"] = prev
        get_settings.cache_clear()
