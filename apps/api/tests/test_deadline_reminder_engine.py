"""Integration tests for the deadline reminder engine (backlog #29, Phase 3).

Covers:
- Sends reminder for upcoming deadline at correct tier
- Idempotent: second sweep sends nothing new
- Skips met deadlines
- Skips not_applicable deadlines
- Sends missed alert exactly once
- Respects enabled=False
- Notification log cleared when deadline recomputes (date change)
"""

from __future__ import annotations

import datetime as dt
from typing import TYPE_CHECKING

from sqlalchemy import select, text

from tests.conftest import _auth, _create_project

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
    name: str = "Reminder Engine Test",
) -> dict:
    payload: dict[str, object] = {"name": name}
    if planned_start_date is not None:
        payload["planned_start_date"] = planned_start_date
    if delivery_date is not None:
        payload["delivery_date"] = delivery_date
    resp = await client.post("/projects", json=payload, headers=_auth(token))
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _set_deadline_due_date(
    session_maker: async_sessionmaker[AsyncSession],
    org_schema: str,
    deadline_type: str,
    project_id: str,
    new_due_date: dt.date,
) -> str:
    """Directly update a deadline's due_date in the tenant schema.

    Returns the deadline id. Useful for forcing specific timing scenarios
    without needing to reverse-engineer the project dates.
    """
    from bimdossier_api.models.deadline import Deadline

    async with session_maker() as session:
        await session.execute(text(f'SET LOCAL search_path = "{org_schema}", public'))
        stmt = select(Deadline).where(
            Deadline.project_id == project_id,
            Deadline.deadline_type == deadline_type,
        )
        dl = (await session.execute(stmt)).scalar_one()
        dl.due_date = new_due_date
        deadline_id = str(dl.id)
        await session.commit()
    return deadline_id


async def _get_notification_log_count(
    session_maker: async_sessionmaker[AsyncSession],
    org_schema: str,
    deadline_id: str,
) -> int:
    """Count notification log entries for a deadline."""
    from bimdossier_api.models.deadline_notification_log import DeadlineNotificationLog

    async with session_maker() as session:
        await session.execute(text(f'SET LOCAL search_path = "{org_schema}", public'))
        result = await session.execute(
            select(DeadlineNotificationLog).where(
                DeadlineNotificationLog.deadline_id == deadline_id,
            )
        )
        return len(result.scalars().all())


def _org_schema(org_user: dict[str, str]) -> str:
    """Derive tenant schema name from org_user fixture."""
    from uuid import UUID

    from bimdossier_api.tenancy import schema_name_for

    return schema_name_for(UUID(org_user["organization_id"]))


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestReminderEngine:
    async def test_sends_reminder_for_upcoming_deadline(
        self,
        client: AsyncClient,
        org_user: dict[str, str],
        session_maker: async_sessionmaker[AsyncSession],
        action_dispatch_calls: list[dict[str, object]],
    ) -> None:
        """Sweep sends a reminder when a deadline is within the reminder window."""
        from bimdossier_api.deadlines.reminder_engine import sweep_all_orgs

        token = org_user["access_token"]
        project = await _create_project_with_dates(client, token)
        schema = _org_schema(org_user)

        # Set construction_notification due date to 7 days from now
        today = dt.date.today()
        due = today + dt.timedelta(days=7)
        await _set_deadline_due_date(
            session_maker, schema, "construction_notification",
            project["id"], due,
        )

        count = await sweep_all_orgs()
        assert count > 0

        # Should have dispatched a reminder email
        reminder_actions = [
            c for c in action_dispatch_calls
            if c["action_type"] == "send_email"
            and "Deadline-herinnering" in c["payload"]["subject"]
            and "Bouwmelding" in c["payload"]["subject"]
        ]
        assert len(reminder_actions) >= 1

    async def test_sends_t30_reminder(
        self,
        client: AsyncClient,
        org_user: dict[str, str],
        session_maker: async_sessionmaker[AsyncSession],
        action_dispatch_calls: list[dict[str, object]],
    ) -> None:
        """A deadline ~25 days out fires the T-30 tier reminder.

        Before T-30 was added (max tier 14), a 25-day-out deadline produced
        no reminder; with the (30, 14, 7, 3, 1) default it must fire one, and
        the notification log records the tier as days_before=30.
        """
        from bimdossier_api.deadlines.reminder_engine import sweep_all_orgs
        from bimdossier_api.models.deadline_notification_log import (
            DeadlineNotificationLog,
        )

        token = org_user["access_token"]
        project = await _create_project_with_dates(client, token)
        schema = _org_schema(org_user)

        today = dt.date.today()
        due = today + dt.timedelta(days=25)  # within T-30, beyond T-14
        dl_id = await _set_deadline_due_date(
            session_maker, schema, "construction_notification",
            project["id"], due,
        )

        count = await sweep_all_orgs()
        assert count > 0

        reminder_actions = [
            c for c in action_dispatch_calls
            if c["action_type"] == "send_email"
            and "Deadline-herinnering" in c["payload"]["subject"]
            and "Bouwmelding" in c["payload"]["subject"]
        ]
        assert len(reminder_actions) >= 1

        # Tier recorded as 30.
        async with session_maker() as session:
            await session.execute(text(f'SET LOCAL search_path = "{schema}", public'))
            tiers = (
                await session.execute(
                    select(DeadlineNotificationLog.days_before).where(
                        DeadlineNotificationLog.deadline_id == dl_id,
                        DeadlineNotificationLog.notification_type == "reminder",
                    )
                )
            ).scalars().all()
        assert 30 in tiers

    async def test_idempotent_second_sweep_sends_nothing(
        self,
        client: AsyncClient,
        org_user: dict[str, str],
        session_maker: async_sessionmaker[AsyncSession],
        action_dispatch_calls: list[dict[str, object]],
    ) -> None:
        """Running the sweep twice for the same tier sends only once."""
        from bimdossier_api.deadlines.reminder_engine import sweep_all_orgs

        token = org_user["access_token"]
        project = await _create_project_with_dates(client, token)
        schema = _org_schema(org_user)

        today = dt.date.today()
        due = today + dt.timedelta(days=7)
        await _set_deadline_due_date(
            session_maker, schema, "construction_notification",
            project["id"], due,
        )

        await sweep_all_orgs()
        first_count = len(action_dispatch_calls)
        assert first_count > 0

        # Second sweep — should not dispatch more emails for the same tier
        await sweep_all_orgs()
        assert len(action_dispatch_calls) == first_count

    async def test_skips_met_deadlines(
        self,
        client: AsyncClient,
        org_user: dict[str, str],
        session_maker: async_sessionmaker[AsyncSession],
        action_dispatch_calls: list[dict[str, object]],
    ) -> None:
        """Met deadlines are not processed by the sweep."""
        from bimdossier_api.deadlines.reminder_engine import sweep_all_orgs

        token = org_user["access_token"]
        project = await _create_project_with_dates(client, token)
        schema = _org_schema(org_user)

        today = dt.date.today()
        due = today + dt.timedelta(days=3)
        await _set_deadline_due_date(
            session_maker, schema, "construction_notification",
            project["id"], due,
        )

        # Mark as met via API
        deadlines_resp = await client.get(
            f"/projects/{project['id']}/deadlines",
            headers=_auth(token),
        )
        cn_dl = next(
            d for d in deadlines_resp.json()
            if d["deadline_type"] == "construction_notification"
        )
        await client.patch(
            f"/projects/{project['id']}/deadlines/{cn_dl['id']}",
            json={},
            headers=_auth(token),
        )

        await sweep_all_orgs()
        # No reminder for met deadline
        cn_actions = [
            c for c in action_dispatch_calls
            if c["action_type"] == "send_email"
            and "Bouwmelding" in c["payload"]["subject"]
        ]
        assert len(cn_actions) == 0

    async def test_skips_not_applicable_deadlines(
        self,
        client: AsyncClient,
        org_user: dict[str, str],
        session_maker: async_sessionmaker[AsyncSession],
        action_dispatch_calls: list[dict[str, object]],
    ) -> None:
        """Not-applicable deadlines are not processed."""
        from bimdossier_api.deadlines.reminder_engine import sweep_all_orgs

        # Create project without dates → all deadlines not_applicable
        token = org_user["access_token"]
        await _create_project(client, token, "No Dates")

        await sweep_all_orgs()
        assert len(action_dispatch_calls) == 0

    async def test_sends_missed_alert_once(
        self,
        client: AsyncClient,
        org_user: dict[str, str],
        session_maker: async_sessionmaker[AsyncSession],
        action_dispatch_calls: list[dict[str, object]],
    ) -> None:
        """Missed deadline sends one alert; second sweep sends nothing."""
        from bimdossier_api.deadlines.reminder_engine import sweep_all_orgs

        token = org_user["access_token"]
        project = await _create_project_with_dates(client, token)
        schema = _org_schema(org_user)

        # Set due date to yesterday
        yesterday = dt.date.today() - dt.timedelta(days=1)
        await _set_deadline_due_date(
            session_maker, schema, "construction_notification",
            project["id"], yesterday,
        )

        await sweep_all_orgs()
        missed_actions = [
            c for c in action_dispatch_calls
            if c["action_type"] == "send_email"
            and "Gemiste deadline" in c["payload"]["subject"]
        ]
        assert len(missed_actions) >= 1

        first_count = len(action_dispatch_calls)
        await sweep_all_orgs()
        # No new dispatches on second sweep
        assert len(action_dispatch_calls) == first_count

    async def test_respects_enabled_false(
        self,
        client: AsyncClient,
        org_user: dict[str, str],
        session_maker: async_sessionmaker[AsyncSession],
        action_dispatch_calls: list[dict[str, object]],
    ) -> None:
        """When notification is disabled, no emails are dispatched."""
        from bimdossier_api.deadlines.reminder_engine import sweep_all_orgs

        token = org_user["access_token"]

        # Disable construction_notification at org level
        resp = await client.patch(
            "/deadline-notification-settings/construction_notification",
            json={"enabled": False},
            headers=_auth(token),
        )
        assert resp.status_code == 200

        project = await _create_project_with_dates(client, token)
        schema = _org_schema(org_user)

        today = dt.date.today()
        due = today + dt.timedelta(days=3)
        await _set_deadline_due_date(
            session_maker, schema, "construction_notification",
            project["id"], due,
        )

        await sweep_all_orgs()
        cn_actions = [
            c for c in action_dispatch_calls
            if c["action_type"] == "send_email"
            and "Bouwmelding" in c["payload"]["subject"]
        ]
        assert len(cn_actions) == 0

    async def test_notification_log_cleared_on_date_change(
        self,
        client: AsyncClient,
        org_user: dict[str, str],
        session_maker: async_sessionmaker[AsyncSession],
        action_dispatch_calls: list[dict[str, object]],
    ) -> None:
        """When project dates change and deadline recomputes, notification log is cleared."""
        from bimdossier_api.deadlines.reminder_engine import sweep_all_orgs

        token = org_user["access_token"]
        project = await _create_project_with_dates(client, token)
        schema = _org_schema(org_user)

        # Set due date to 3 days from now → triggers reminder
        today = dt.date.today()
        due = today + dt.timedelta(days=3)
        dl_id = await _set_deadline_due_date(
            session_maker, schema, "construction_notification",
            project["id"], due,
        )

        await sweep_all_orgs()
        assert len(action_dispatch_calls) > 0
        log_count = await _get_notification_log_count(
            session_maker, schema, dl_id
        )
        assert log_count > 0

        # Change the project's planned_start_date → recompute clears log
        resp = await client.patch(
            f"/projects/{project['id']}",
            json={"planned_start_date": "2027-01-15"},
            headers=_auth(token),
        )
        assert resp.status_code == 200

        # The recompute should have cleared the notification log
        log_count_after = await _get_notification_log_count(
            session_maker, schema, dl_id
        )
        assert log_count_after == 0

        # A second sweep should be able to dispatch fresh reminders
        action_dispatch_calls.clear()
        # Set the new due date to within reminder window
        new_due = today + dt.timedelta(days=5)
        await _set_deadline_due_date(
            session_maker, schema, "construction_notification",
            project["id"], new_due,
        )
        await sweep_all_orgs()
        assert len(action_dispatch_calls) > 0
