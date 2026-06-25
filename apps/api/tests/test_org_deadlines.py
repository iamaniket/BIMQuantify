"""Integration tests for the org-wide (cross-project) calendar endpoints.

Covers GET /deadlines (aggregated list, ranked by closeness, localized label,
pagination) and GET /deadlines/summary (status / overdue / week-bucket counts),
plus visibility scoping: members see their projects, org admins see all, other
orgs see nothing.
"""

from __future__ import annotations

import datetime as dt
from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import select, text

from tests.conftest import _auth

if TYPE_CHECKING:
    from httpx import AsyncClient
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _create_project_with_dates(
    client: AsyncClient,
    token: str,
    *,
    planned_start_date: str | None = "2026-09-01",
    delivery_date: str | None = "2027-03-01",
    name: str = "Calendar Project",
) -> dict:
    payload: dict[str, object] = {"name": name}
    if planned_start_date is not None:
        payload["planned_start_date"] = planned_start_date
    if delivery_date is not None:
        payload["delivery_date"] = delivery_date
    resp = await client.post("/projects", json=payload, headers=_auth(token))
    assert resp.status_code == 201, resp.text
    return resp.json()


def _org_schema(org_user: dict[str, str]) -> str:
    from bimdossier_api.tenancy import schema_name_for

    return schema_name_for(UUID(org_user["organization_id"]))


async def _set_deadline_due_date(
    session_maker: async_sessionmaker[AsyncSession],
    org_schema: str,
    deadline_type: str,
    project_id: str,
    new_due_date: dt.date,
) -> None:
    """Force a deadline's due_date directly in the tenant schema."""
    from bimdossier_api.models.deadline import Deadline

    async with session_maker() as session:
        await session.execute(text(f'SET LOCAL search_path = "{org_schema}", public'))
        dl = (
            await session.execute(
                select(Deadline).where(
                    Deadline.project_id == project_id,
                    Deadline.deadline_type == deadline_type,
                )
            )
        ).scalar_one()
        dl.due_date = new_due_date
        await session.commit()


async def _list_org_deadlines(
    client: AsyncClient, token: str, *, locale: str | None = None, query: str = ""
) -> tuple[list[dict], str]:
    headers = _auth(token)
    if locale is not None:
        headers["Accept-Language"] = locale
    resp = await client.get(f"/deadlines{query}", headers=headers)
    assert resp.status_code == 200, resp.text
    return resp.json(), resp.headers.get("X-Total-Count", "")


# ---------------------------------------------------------------------------
# List aggregation
# ---------------------------------------------------------------------------


async def test_list_aggregates_across_projects_ranked_by_closeness(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    """GET /deadlines returns deadlines from every project, soonest first."""
    token = org_user["access_token"]
    await _create_project_with_dates(
        client, token, planned_start_date="2026-09-01", name="Project Early"
    )
    await _create_project_with_dates(
        client, token, planned_start_date="2027-02-01", name="Project Late"
    )

    items, total = await _list_org_deadlines(client, token)

    # Two projects x 3 NL deadlines.
    assert len(items) == 6
    assert total == "6"

    # Ranked by due_date ascending (nulls last) — non-decreasing.
    due_dates = [i["due_date"] for i in items if i["due_date"] is not None]
    assert due_dates == sorted(due_dates)

    # Project context + localized label present on each row.
    for i in items:
        assert i["project_name"] in {"Project Early", "Project Late"}
        assert i["label"]
        assert i["country"] == "NL"
        assert "days_until_due" in i


async def test_list_localizes_label_by_accept_language(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    token = org_user["access_token"]
    await _create_project_with_dates(client, token, name="Localize")

    nl_items, _ = await _list_org_deadlines(client, token, locale="nl")
    en_items, _ = await _list_org_deadlines(client, token, locale="en")

    nl_labels = {i["deadline_type"]: i["label"] for i in nl_items}
    en_labels = {i["deadline_type"]: i["label"] for i in en_items}
    assert nl_labels["construction_notification"] == "Bouwmelding"
    assert en_labels["construction_notification"] == "Construction notification"


async def test_list_pagination_and_total_count(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    token = org_user["access_token"]
    await _create_project_with_dates(client, token, name="Paged")  # 3 deadlines

    page1, total = await _list_org_deadlines(client, token, query="?limit=2")
    assert len(page1) == 2
    assert total == "3"

    page2, _ = await _list_org_deadlines(client, token, query="?limit=2&offset=2")
    assert len(page2) == 1


# ---------------------------------------------------------------------------
# Summary aggregates
# ---------------------------------------------------------------------------


async def test_summary_counts(
    client: AsyncClient,
    org_user: dict[str, str],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    token = org_user["access_token"]
    project = await _create_project_with_dates(client, token, name="Summary")
    schema = _org_schema(org_user)
    today = dt.date.today()

    # Engineer the three deadlines into known horizons.
    await _set_deadline_due_date(
        session_maker, schema, "construction_notification", project["id"],
        today + dt.timedelta(days=5),  # due this week, bucket 0-7
    )
    await _set_deadline_due_date(
        session_maker, schema, "information_obligation", project["id"],
        today + dt.timedelta(days=20),  # bucket 15-21
    )
    await _set_deadline_due_date(
        session_maker, schema, "completion_notification", project["id"],
        today - dt.timedelta(days=1),  # overdue
    )

    resp = await client.get("/deadlines/summary", headers=_auth(token))
    assert resp.status_code == 200, resp.text
    s = resp.json()

    assert s["total"] == 3
    assert s["pending"] == 3
    assert s["met"] == 0
    assert s["not_applicable"] == 0
    assert s["overdue"] == 1
    assert s["due_this_week"] == 1

    buckets = {(b["days_from"], b["days_to"]): b["count"] for b in s["upcoming_buckets"]}
    assert buckets[(0, 7)] == 1
    assert buckets[(8, 14)] == 0
    assert buckets[(15, 21)] == 1
    assert buckets[(22, 30)] == 0


# ---------------------------------------------------------------------------
# Visibility scoping
# ---------------------------------------------------------------------------


async def test_cross_org_isolation(
    client: AsyncClient,
    org_user: dict[str, str],
    other_org_user: dict[str, str],
) -> None:
    """A different org never sees this org's deadlines."""
    project = await _create_project_with_dates(
        client, org_user["access_token"], name="AlphaCo Only"
    )

    items, _ = await _list_org_deadlines(client, other_org_user["access_token"])
    project_ids = {i["project_id"] for i in items}
    assert project["id"] not in project_ids


async def test_non_member_non_admin_sees_nothing(
    client: AsyncClient,
    org_user: dict[str, str],
    same_org_non_admin_user: dict[str, str],
) -> None:
    """A same-org non-admin who isn't a project member sees no deadlines."""
    project = await _create_project_with_dates(
        client, org_user["access_token"], name="Members Only"
    )

    items, _ = await _list_org_deadlines(client, same_org_non_admin_user["access_token"])
    project_ids = {i["project_id"] for i in items}
    assert project["id"] not in project_ids


async def test_org_admin_sees_all_projects(
    client: AsyncClient,
    org_user: dict[str, str],
    same_org_user: dict[str, str],
) -> None:
    """An org admin sees deadlines for projects they're not a member of."""
    project = await _create_project_with_dates(
        client, org_user["access_token"], name="Admin Visible"
    )

    # same_org_user is provisioned as an org admin (helper default).
    items, _ = await _list_org_deadlines(client, same_org_user["access_token"])
    project_ids = {i["project_id"] for i in items}
    assert project["id"] in project_ids
