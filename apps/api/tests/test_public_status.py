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
    assert body["region"] == "EU-WEST"
    assert body["wkb_version"] == "2026.1"
    assert body["checks"] == {"db": True, "redis": True, "storage": True}


@pytest.mark.asyncio
async def test_system_status_degrades_when_redis_fails(
    client: "AsyncClient", monkeypatch: pytest.MonkeyPatch
) -> None:
    from bimstitch_api.routers import public as public_router

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
    from bimstitch_api.routers import public as public_router

    async def _broken() -> bool:
        return False

    monkeypatch.setattr(public_router, "_check_redis", _broken)
    monkeypatch.setattr(public_router, "_check_storage", _broken)

    response = await client.get("/public/system-status")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "down"
