"""Tests for admin access-request endpoints — list, approve, reject, export."""

from __future__ import annotations

from typing import TYPE_CHECKING

import pytest
from fastapi_users.password import PasswordHelper

from bimstitch_api.models.access_request import AccessRequest, AccessRequestStatus
from bimstitch_api.models.user import User

if TYPE_CHECKING:
    from httpx import AsyncClient
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker


PASSWORD = "correct-horse-battery"


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _login(client: AsyncClient, email: str) -> str:
    response = await client.post(
        "/auth/jwt/login",
        data={"username": email, "password": PASSWORD},
    )
    assert response.status_code == 200, response.text
    return response.json()["access_token"]


async def _make_superuser(session: AsyncSession, email: str) -> User:
    user = User(
        email=email,
        hashed_password=PasswordHelper().hash(PASSWORD),
        full_name="Root Admin",
        is_active=True,
        is_verified=True,
        is_superuser=True,
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user


async def _make_regular_user(session: AsyncSession, email: str) -> User:
    user = User(
        email=email,
        hashed_password=PasswordHelper().hash(PASSWORD),
        full_name="Regular User",
        is_active=True,
        is_verified=True,
        is_superuser=False,
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user


async def _seed_access_request(
    session: AsyncSession,
    *,
    work_email: str = "lieke@heijmans.nl",
    company: str = "Heijmans Bouw N.V.",
    status: AccessRequestStatus = AccessRequestStatus.new,
) -> AccessRequest:
    ar = AccessRequest(
        name="Lieke Beumer",
        work_email=work_email,
        company=company,
        role="BIM Manager",
        company_size="201-500",
        country="NL",
        notes="Interested in Wkb workflow.",
        status=status,
    )
    session.add(ar)
    await session.commit()
    await session.refresh(ar)
    return ar


# ---------------------------------------------------------------------------
# Auth guard
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_requires_superuser(
    client: AsyncClient,
    session: AsyncSession,
) -> None:
    await _make_regular_user(session, "user@test.nl")
    token = await _login(client, "user@test.nl")
    response = await client.get("/admin/access-requests", headers=_auth(token))
    assert response.status_code == 403


# ---------------------------------------------------------------------------
# List
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_access_requests(
    client: AsyncClient,
    session: AsyncSession,
) -> None:
    await _make_superuser(session, "admin@test.nl")
    await _seed_access_request(session)
    token = await _login(client, "admin@test.nl")

    response = await client.get("/admin/access-requests", headers=_auth(token))
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 1
    assert data[0]["work_email"] == "lieke@heijmans.nl"
    assert data[0]["status"] == "new"
    assert "updated_at" in data[0]


@pytest.mark.asyncio
async def test_list_filter_by_status(
    client: AsyncClient,
    session: AsyncSession,
) -> None:
    await _make_superuser(session, "admin@test.nl")
    await _seed_access_request(session, work_email="a@x.nl", status=AccessRequestStatus.new)
    await _seed_access_request(session, work_email="b@x.nl", status=AccessRequestStatus.rejected)
    token = await _login(client, "admin@test.nl")

    response = await client.get(
        "/admin/access-requests", params={"status": "new"}, headers=_auth(token),
    )
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 1
    assert data[0]["work_email"] == "a@x.nl"


@pytest.mark.asyncio
async def test_list_search(
    client: AsyncClient,
    session: AsyncSession,
) -> None:
    await _make_superuser(session, "admin@test.nl")
    await _seed_access_request(session, work_email="a@heijmans.nl", company="Heijmans")
    await _seed_access_request(session, work_email="b@bam.nl", company="BAM Bouw")
    token = await _login(client, "admin@test.nl")

    response = await client.get(
        "/admin/access-requests", params={"q": "bam"}, headers=_auth(token),
    )
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 1
    assert data[0]["company"] == "BAM Bouw"


# ---------------------------------------------------------------------------
# Reject
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_reject_access_request(
    client: AsyncClient,
    session: AsyncSession,
) -> None:
    await _make_superuser(session, "admin@test.nl")
    ar = await _seed_access_request(session)
    token = await _login(client, "admin@test.nl")

    response = await client.post(
        f"/admin/access-requests/{ar.id}/reject", headers=_auth(token),
    )
    assert response.status_code == 200
    assert response.json()["status"] == "rejected"


@pytest.mark.asyncio
async def test_reject_already_rejected(
    client: AsyncClient,
    session: AsyncSession,
) -> None:
    await _make_superuser(session, "admin@test.nl")
    ar = await _seed_access_request(session, status=AccessRequestStatus.rejected)
    token = await _login(client, "admin@test.nl")

    response = await client.post(
        f"/admin/access-requests/{ar.id}/reject", headers=_auth(token),
    )
    assert response.status_code == 409


# ---------------------------------------------------------------------------
# Export
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_export_csv(
    client: AsyncClient,
    session: AsyncSession,
) -> None:
    await _make_superuser(session, "admin@test.nl")
    await _seed_access_request(session)
    token = await _login(client, "admin@test.nl")

    response = await client.get("/admin/access-requests/export", headers=_auth(token))
    assert response.status_code == 200
    assert "text/csv" in response.headers["content-type"]
    lines = response.text.strip().split("\n")
    assert len(lines) == 2  # header + 1 data row
    assert "work_email" in lines[0]
    assert "lieke@heijmans.nl" in lines[1]
