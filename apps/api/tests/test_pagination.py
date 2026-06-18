"""Tests for the shared list-endpoint pagination + sort helper and its wiring.

Covers the pure helper (``apply_sort`` whitelist + default + tiebreaker) and the
HTTP contract it gives every migrated list endpoint: an ``X-Total-Count`` header
with the true (pre-limit) total, server-side ordering via ``order_by``/
``order_dir``, and a 422 ``INVALID_SORT_KEY`` for columns outside the whitelist.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

import pytest
from fastapi import HTTPException
from fastapi_users.password import PasswordHelper
from sqlalchemy import select

from bimstitch_api.models.access_request import AccessRequest, AccessRequestStatus
from bimstitch_api.models.user import User
from bimstitch_api.pagination import SortParams, apply_sort

if TYPE_CHECKING:
    from httpx import AsyncClient
    from sqlalchemy.ext.asyncio import AsyncSession


PASSWORD = "correct-horse-battery"


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _login(client: AsyncClient, email: str) -> str:
    response = await client.post(
        "/auth/jwt/login", data={"username": email, "password": PASSWORD}
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


async def _seed_request(session: AsyncSession, *, work_email: str, company: str) -> None:
    session.add(
        AccessRequest(
            name=company,
            work_email=work_email,
            company=company,
            role="BIM Manager",
            company_size="11-50",
            country="NL",
            status=AccessRequestStatus.new,
        )
    )
    await session.commit()


# ---------------------------------------------------------------------------
# Pure helper
# ---------------------------------------------------------------------------


def test_apply_sort_unknown_key_is_422() -> None:
    with pytest.raises(HTTPException) as exc:
        apply_sort(
            select(AccessRequest),
            SortParams(order_by="passwords", order_dir="asc"),
            {"name": AccessRequest.name},
            default="name",
        )
    assert exc.value.status_code == 422
    assert "INVALID_SORT_KEY" in str(exc.value.detail)


def test_apply_sort_explicit_direction_and_tiebreaker() -> None:
    stmt = apply_sort(
        select(AccessRequest),
        SortParams(order_by="company", order_dir="desc"),
        {"company": AccessRequest.company},
        default="name",
        tiebreaker=AccessRequest.id,
    )
    compiled = str(stmt).lower()
    assert "order by" in compiled
    assert "company desc" in compiled
    assert "access_requests.id asc" in compiled  # tiebreaker appended


def test_apply_sort_falls_back_to_default_when_unspecified() -> None:
    stmt = apply_sort(
        select(AccessRequest),
        SortParams(order_by=None, order_dir="asc"),
        {"name": AccessRequest.name, "created_at": AccessRequest.created_at},
        default="created_at",
        default_dir="desc",
    )
    compiled = str(stmt).lower()
    assert "created_at desc" in compiled


# ---------------------------------------------------------------------------
# HTTP contract (via /admin/access-requests)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_total_count_header_is_true_total(
    client: AsyncClient, session: AsyncSession
) -> None:
    await _make_superuser(session, "admin@test.nl")
    for i in range(3):
        await _seed_request(session, work_email=f"u{i}@x.nl", company=f"Co {i}")
    token = await _login(client, "admin@test.nl")

    resp = await client.get(
        "/admin/access-requests", params={"limit": 1}, headers=_auth(token)
    )
    assert resp.status_code == 200, resp.text
    assert len(resp.json()) == 1
    # Header reports the full match count, not the returned page length.
    assert resp.headers["X-Total-Count"] == "3"


@pytest.mark.asyncio
async def test_order_by_sorts_server_side(
    client: AsyncClient, session: AsyncSession
) -> None:
    await _make_superuser(session, "admin@test.nl")
    await _seed_request(session, work_email="charlie@x.nl", company="Charlie")
    await _seed_request(session, work_email="alpha@x.nl", company="Alpha")
    await _seed_request(session, work_email="bravo@x.nl", company="Bravo")
    token = await _login(client, "admin@test.nl")

    asc = await client.get(
        "/admin/access-requests",
        params={"order_by": "work_email", "order_dir": "asc"},
        headers=_auth(token),
    )
    assert asc.status_code == 200, asc.text
    assert [r["work_email"] for r in asc.json()] == [
        "alpha@x.nl",
        "bravo@x.nl",
        "charlie@x.nl",
    ]

    desc = await client.get(
        "/admin/access-requests",
        params={"order_by": "work_email", "order_dir": "desc"},
        headers=_auth(token),
    )
    assert [r["work_email"] for r in desc.json()] == [
        "charlie@x.nl",
        "bravo@x.nl",
        "alpha@x.nl",
    ]


@pytest.mark.asyncio
async def test_unknown_sort_key_rejected(
    client: AsyncClient, session: AsyncSession
) -> None:
    await _make_superuser(session, "admin@test.nl")
    token = await _login(client, "admin@test.nl")
    resp = await client.get(
        "/admin/access-requests",
        params={"order_by": "hashed_password"},
        headers=_auth(token),
    )
    assert resp.status_code == 422
    assert "INVALID_SORT_KEY" in resp.text


@pytest.mark.asyncio
async def test_bad_order_dir_rejected(
    client: AsyncClient, session: AsyncSession
) -> None:
    await _make_superuser(session, "admin@test.nl")
    token = await _login(client, "admin@test.nl")
    resp = await client.get(
        "/admin/access-requests",
        params={"order_dir": "sideways"},
        headers=_auth(token),
    )
    assert resp.status_code == 422
