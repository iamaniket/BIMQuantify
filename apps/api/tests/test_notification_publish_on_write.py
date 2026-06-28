"""M-en1: finding / comment / @mention notifications are PUBLISHED on write.

The rows were always created, but the Redis WS publish was missing — so
real-time delivery was silently broken and a member only saw the notification
on a later refetch. These tests spy on ``publish_notification`` at each write
site and assert it fires (so the ConnectionManager actually pushes to live
sockets), with the right recipient on the targeted paths.
"""

from __future__ import annotations

from typing import TYPE_CHECKING
from unittest.mock import AsyncMock

import pytest

from tests.conftest import _add_member, _auth, _create_project

if TYPE_CHECKING:
    from httpx import AsyncClient


async def _create_finding(client: AsyncClient, token: str, project_id: str) -> dict:
    resp = await client.post(
        f"/projects/{project_id}/findings",
        json={"title": "Brandwerende doorvoer ontbreekt", "description": "n.v.t."},
        headers=_auth(token),
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


@pytest.fixture
def spy_comment_publish(monkeypatch: pytest.MonkeyPatch) -> AsyncMock:
    spy = AsyncMock()
    monkeypatch.setattr("bimdossier_api.routers.finding_comment.publish_notification", spy)
    return spy


@pytest.fixture
def spy_finding_publish(monkeypatch: pytest.MonkeyPatch) -> AsyncMock:
    spy = AsyncMock()
    monkeypatch.setattr("bimdossier_api.routers.finding.publish_notification", spy)
    return spy


async def test_mention_publishes_to_recipient(
    client: AsyncClient,
    org_user: dict[str, str],
    same_org_non_admin_user: dict[str, str],
    spy_comment_publish: AsyncMock,
) -> None:
    """An @mention publishes a targeted notification, not just writes the row."""
    token = org_user["access_token"]
    other = same_org_non_admin_user
    project = await _create_project(client, token)
    await _add_member(client, token, project["id"], other["id"], "contractor")
    finding = await _create_finding(client, token, project["id"])

    resp = await client.post(
        f"/projects/{project['id']}/findings/{finding['id']}/comments",
        json={"text": f"kijk hiernaar @[Bob]({other['id']})"},
        headers=_auth(token),
    )
    assert resp.status_code == 201, resp.text

    # Published exactly once, to the mentioned member (recipient-scoped).
    assert spy_comment_publish.await_count == 1
    notification = spy_comment_publish.await_args_list[0].args[0]
    assert str(notification.recipient_user_id) == other["id"]


async def test_finding_promote_publishes_to_assignee(
    client: AsyncClient,
    org_user: dict[str, str],
    same_org_non_admin_user: dict[str, str],
    spy_finding_publish: AsyncMock,
) -> None:
    """Promoting draft→open publishes the assignment ping to the assignee."""
    token = org_user["access_token"]
    other = same_org_non_admin_user
    project = await _create_project(client, token)
    await _add_member(client, token, project["id"], other["id"], "contractor")
    finding = await _create_finding(client, token, project["id"])

    resp = await client.patch(
        f"/projects/{project['id']}/findings/{finding['id']}",
        json={
            "status": "open",
            "deadline_date": "2099-01-01",
            "assignee_user_id": other["id"],
        },
        headers=_auth(token),
    )
    assert resp.status_code == 200, resp.text

    assert spy_finding_publish.await_count == 1
    notification = spy_finding_publish.await_args_list[0].args[0]
    assert str(notification.recipient_user_id) == other["id"]
