"""Tests for the self-serve free-tier account usage endpoint.

`GET /free/account/usage` exposes the calling free user's own data footprint
(storage / projects / containers / snags) vs. the configured caps, so the portal
account page can render a usage card. Mirrors the super-admin `/admin/users/free`
computation but scoped to the caller via the pooled free session.
"""

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from bimdossier_api.config import get_settings
from tests.conftest import FakeStorage
from tests.test_free_viewer import (
    _auth,
    _create_document,
    _create_project,
    _free_token,
    _upload,
)


async def test_free_account_usage_reflects_owned_content(
    free_tier_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """A free user with a project, a container, an uploaded file and a snag sees
    those counts (and the byte total) against the settings-derived caps."""
    client, fake = free_tier_storage_client
    token = await _free_token(client, session_maker, "fa-usage@example.com")

    pid = await _create_project(client, token, name="House")
    did = await _create_document(client, token, pid)
    await _upload(client, fake, token, pid, did, size=4096)

    snag = await client.post(
        f"/free/documents/{did}/findings",
        json={"title": "crack", "severity": "high"},
        headers=_auth(token),
    )
    assert snag.status_code == 201, snag.text

    resp = await client.get("/free/account/usage", headers=_auth(token))
    assert resp.status_code == 200, resp.text
    body = resp.json()

    settings = get_settings()
    assert body["storage_bytes_used"] == 4096
    assert body["storage_bytes_cap"] == settings.free_storage_max_bytes
    assert body["project_count"] == 1
    assert body["project_cap"] == settings.free_max_projects_per_user
    assert body["document_count"] == 1
    assert body["document_cap"] == settings.free_max_models_per_user
    assert body["snag_count"] == 1
    assert body["member_of_count"] == 0


async def test_free_account_usage_zero_for_new_user(
    free_tier_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """A brand-new free account has zero usage but fully-populated caps."""
    client, _ = free_tier_storage_client
    token = await _free_token(client, session_maker, "fa-empty@example.com")

    resp = await client.get("/free/account/usage", headers=_auth(token))
    assert resp.status_code == 200, resp.text
    body = resp.json()

    settings = get_settings()
    assert body["storage_bytes_used"] == 0
    assert body["project_count"] == 0
    assert body["document_count"] == 0
    assert body["snag_count"] == 0
    assert body["member_of_count"] == 0
    assert body["storage_bytes_cap"] == settings.free_storage_max_bytes
    assert body["project_cap"] == settings.free_max_projects_per_user
    assert body["document_cap"] == settings.free_max_models_per_user
    assert body["last_activity_at"] is None
    assert body["first_activity_at"] is None


async def test_free_account_usage_isolated_per_user(
    free_tier_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """User B's usage never bleeds into user A's (owner-keyed RLS + filter)."""
    client, fake = free_tier_storage_client
    token_a = await _free_token(client, session_maker, "fa-a@example.com")
    token_b = await _free_token(client, session_maker, "fa-b@example.com")

    pid = await _create_project(client, token_a, name="A house")
    did = await _create_document(client, token_a, pid)
    await _upload(client, fake, token_a, pid, did, size=2048)

    usage_b = await client.get("/free/account/usage", headers=_auth(token_b))
    assert usage_b.status_code == 200, usage_b.text
    body_b = usage_b.json()
    assert body_b["project_count"] == 0
    assert body_b["document_count"] == 0
    assert body_b["storage_bytes_used"] == 0


async def test_free_account_usage_flag_off_returns_403(
    free_tier_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The endpoint honours the free-tier kill-switch at request time."""
    client, _ = free_tier_storage_client
    token = await _free_token(client, session_maker, "fa-flag@example.com")

    monkeypatch.setenv("FREE_TIER_ENABLED", "false")
    get_settings.cache_clear()
    try:
        resp = await client.get("/free/account/usage", headers=_auth(token))
        assert resp.status_code == 403
        assert resp.json()["detail"] == "FREE_TIER_DISABLED"
    finally:
        monkeypatch.setenv("FREE_TIER_ENABLED", "true")
        get_settings.cache_clear()
