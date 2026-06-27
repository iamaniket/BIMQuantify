"""Tests for GET /public/system-status — live health check for the login page."""

from __future__ import annotations

from typing import TYPE_CHECKING

import pytest

if TYPE_CHECKING:
    from httpx import AsyncClient


@pytest.mark.asyncio
async def test_system_status_returns_normal_when_healthy(
    client: "AsyncClient",
) -> None:
    response = await client.get("/public/system-status")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "normal"
    assert body["region"] == "dev"
    assert body["node"] == "local"
    # Real coverage figures replace the old made-up "version" strings.
    from bimdossier_api.compliance.coverage import (
        BBL_IMPLEMENTED_CHECKS,
        WKB_IMPLEMENTED_CHECKS,
    )
    from bimdossier_api.ifc.header import supported_ifc_schemas

    assert body["wkb_checks"] == WKB_IMPLEMENTED_CHECKS
    assert body["bbl_checks"] == BBL_IMPLEMENTED_CHECKS
    assert body["ifc_schemas"] == supported_ifc_schemas()
    assert "wkb_version" not in body
    assert "bbl_version" not in body
    assert "ifc_version" not in body
    assert body["checks"] == {"db": True, "redis": True, "storage": True}


@pytest.mark.asyncio
async def test_system_status_reflects_deploy_env_overrides(
    client: "AsyncClient", monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("DEPLOY_REGION", "EU-WEST")
    monkeypatch.setenv("DEPLOY_NODE", "AMS01")
    from bimdossier_api.config import get_settings

    get_settings.cache_clear()
    try:
        response = await client.get("/public/system-status")
        assert response.status_code == 200
        body = response.json()
        assert body["region"] == "EU-WEST"
        assert body["node"] == "AMS01"
    finally:
        monkeypatch.delenv("DEPLOY_REGION", raising=False)
        monkeypatch.delenv("DEPLOY_NODE", raising=False)
        get_settings.cache_clear()


@pytest.mark.asyncio
async def test_system_status_degrades_when_redis_fails(
    client: "AsyncClient", monkeypatch: pytest.MonkeyPatch
) -> None:
    from bimdossier_api.routers import public as public_router

    async def _broken_check_redis() -> bool:
        return False

    monkeypatch.setattr(public_router, "_check_redis", _broken_check_redis)

    response = await client.get("/public/system-status")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "degraded"
    assert body["checks"]["redis"] is False
    assert body["checks"]["db"] is True


@pytest.mark.asyncio
async def test_system_status_down_when_multiple_fail(
    client: "AsyncClient", monkeypatch: pytest.MonkeyPatch
) -> None:
    from bimdossier_api.routers import public as public_router

    async def _broken() -> bool:
        return False

    monkeypatch.setattr(public_router, "_check_redis", _broken)
    monkeypatch.setattr(public_router, "_check_storage", _broken)

    response = await client.get("/public/system-status")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "down"
