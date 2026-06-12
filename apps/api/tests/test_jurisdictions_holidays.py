"""Tests for the public holidays endpoint.

`GET /jurisdictions/{country}/holidays` exposes national public holidays for a
country/year so the portal calendar can mark them. It reuses the same
`holidays` library the deadline working-day engine uses
(`deadlines/working_days.py`), so calendar holidays never drift from deadline
math. Public, no tenancy — mirrors `GET /jurisdictions`.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from httpx import AsyncClient


def _dates(body: dict) -> set[str]:
    return {item["date"] for item in body["items"]}


def _by_date(body: dict, iso: str) -> dict:
    return next(item for item in body["items"] if item["date"] == iso)


# ---------------------------------------------------------------------------
# GET /jurisdictions/{country}/holidays
# ---------------------------------------------------------------------------


async def test_nl_holidays_2026_includes_fixed_dates(client: AsyncClient) -> None:
    """NL 2026: the stable fixed-date holidays are present and well-shaped."""
    resp = await client.get("/jurisdictions/NL/holidays", params={"year": 2026})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert "items" in body

    dates = _dates(body)
    # Stable, jurisdiction-independent NL public holidays.
    assert "2026-01-01" in dates  # Nieuwjaarsdag
    assert "2026-04-27" in dates  # Koningsdag (Mon 27 Apr 2026)
    assert "2026-12-25" in dates  # Eerste Kerstdag
    assert "2026-12-26" in dates  # Tweede Kerstdag

    # Easter-derived movable feasts push the count above the fixed set.
    assert len(body["items"]) >= 8

    # Each item carries an ISO date and a non-empty name.
    item = _by_date(body, "2026-01-01")
    assert set(item) == {"date", "name"}
    assert isinstance(item["name"], str) and item["name"]


async def test_nl_holidays_easter_derived_2026(client: AsyncClient) -> None:
    """Easter 2026 = 5 Apr → the movable feasts land on the right days."""
    resp = await client.get("/jurisdictions/NL/holidays", params={"year": 2026})
    dates = _dates(resp.json())
    assert "2026-04-03" in dates  # Goede Vrijdag (Good Friday)
    assert "2026-04-06" in dates  # Tweede Paasdag (Easter Monday)
    assert "2026-05-14" in dates  # Hemelvaartsdag (Ascension)
    assert "2026-05-25" in dates  # Tweede Pinksterdag (Whit Monday)


async def test_holidays_are_sorted_by_date(client: AsyncClient) -> None:
    resp = await client.get("/jurisdictions/NL/holidays", params={"year": 2026})
    dates = [item["date"] for item in resp.json()["items"]]
    assert dates == sorted(dates)


async def test_holidays_public_no_auth_required(client: AsyncClient) -> None:
    """Like the registry, the endpoint is public (consumed by the calendar)."""
    resp = await client.get("/jurisdictions/NL/holidays", params={"year": 2026})
    assert resp.status_code == 200


async def test_holidays_localized_names(client: AsyncClient) -> None:
    """`locale` localizes holiday names; NL and EN differ where supported."""
    nl = await client.get(
        "/jurisdictions/NL/holidays", params={"year": 2026, "locale": "nl"}
    )
    en = await client.get(
        "/jurisdictions/NL/holidays", params={"year": 2026, "locale": "en"}
    )
    nl_name = _by_date(nl.json(), "2026-01-01")["name"]
    en_name = _by_date(en.json(), "2026-01-01")["name"]

    assert "Nieuwjaar" in nl_name
    assert "New Year" in en_name
    assert nl_name != en_name


async def test_unknown_country_returns_empty_list(client: AsyncClient) -> None:
    """A country the holidays library doesn't implement → 200 with no items
    (graceful, not a 500), so the portal just renders no holiday markers."""
    resp = await client.get("/jurisdictions/ZZ/holidays", params={"year": 2026})
    assert resp.status_code == 200, resp.text
    assert resp.json()["items"] == []


async def test_unsupported_locale_falls_back_to_default(client: AsyncClient) -> None:
    """An unsupported locale must not 500 — names fall back to the default
    language rather than erroring."""
    resp = await client.get(
        "/jurisdictions/NL/holidays", params={"year": 2026, "locale": "zz"}
    )
    assert resp.status_code == 200, resp.text
    assert len(resp.json()["items"]) >= 8
