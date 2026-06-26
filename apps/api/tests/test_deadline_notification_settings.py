"""Tests for deadline notification settings (backlog #29, Phase 2).

Covers:
- Settings resolution: project override > org default > jurisdiction fallback
- Org-level API (GET + PATCH): requires org admin
- Project-level API (GET + PUT + DELETE): permission gates
- Schema validation: reminder_days and recipient_roles
- RLS isolation: org B sees nothing from org A
- Jurisdictions endpoint returns default_reminder_days + default_recipient_roles
"""

from __future__ import annotations

from typing import TYPE_CHECKING

import pytest

from tests.conftest import _auth

if TYPE_CHECKING:
    from httpx import AsyncClient


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _create_project_with_dates(
    client: AsyncClient,
    token: str,
    *,
    planned_start_date: str | None = "2026-09-01",
    delivery_date: str | None = "2027-03-01",
    name: str = "Notif Settings Project",
) -> dict:
    payload: dict[str, object] = {"name": name}
    if planned_start_date is not None:
        payload["planned_start_date"] = planned_start_date
    if delivery_date is not None:
        payload["delivery_date"] = delivery_date
    resp = await client.post("/projects", json=payload, headers=_auth(token))
    assert resp.status_code == 201, resp.text
    return resp.json()


# ---------------------------------------------------------------------------
# Schema validation (unit-level, no DB)
# ---------------------------------------------------------------------------


class TestSchemaValidation:
    def test_reminder_days_sorted_desc(self) -> None:
        from bimdossier_api.schemas.deadline_notification_settings import (
            DeadlineNotificationSettingsUpdate,
        )

        schema = DeadlineNotificationSettingsUpdate(reminder_days=[1, 7, 3, 14])
        assert schema.reminder_days == [14, 7, 3, 1]

    def test_reminder_days_no_negatives(self) -> None:
        from bimdossier_api.schemas.deadline_notification_settings import (
            DeadlineNotificationSettingsUpdate,
        )

        with pytest.raises(ValueError, match="must be >= 0"):
            DeadlineNotificationSettingsUpdate(reminder_days=[7, -1])

    def test_reminder_days_no_duplicates(self) -> None:
        from bimdossier_api.schemas.deadline_notification_settings import (
            DeadlineNotificationSettingsUpdate,
        )

        with pytest.raises(ValueError, match="duplicates"):
            DeadlineNotificationSettingsUpdate(reminder_days=[7, 7, 3])

    def test_reminder_days_not_empty(self) -> None:
        from bimdossier_api.schemas.deadline_notification_settings import (
            DeadlineNotificationSettingsUpdate,
        )

        with pytest.raises(ValueError, match="must not be empty"):
            DeadlineNotificationSettingsUpdate(reminder_days=[])

    def test_recipient_roles_valid(self) -> None:
        from bimdossier_api.schemas.deadline_notification_settings import (
            DeadlineNotificationSettingsUpdate,
        )

        schema = DeadlineNotificationSettingsUpdate(
            recipient_roles=["owner", "editor"]
        )
        assert schema.recipient_roles == ["owner", "editor"]

    def test_recipient_roles_invalid_role(self) -> None:
        from bimdossier_api.schemas.deadline_notification_settings import (
            DeadlineNotificationSettingsUpdate,
        )

        with pytest.raises(ValueError, match="Invalid role"):
            DeadlineNotificationSettingsUpdate(
                recipient_roles=["owner", "ceo"]
            )

    def test_recipient_roles_not_empty(self) -> None:
        from bimdossier_api.schemas.deadline_notification_settings import (
            DeadlineNotificationSettingsUpdate,
        )

        with pytest.raises(ValueError, match="must not be empty"):
            DeadlineNotificationSettingsUpdate(recipient_roles=[])


# ---------------------------------------------------------------------------
# Settings resolution (unit-level via session fixture)
# ---------------------------------------------------------------------------


class TestSettingsResolution:
    async def test_fallback_to_jurisdiction_defaults(
        self, client: AsyncClient, org_user: dict[str, str]
    ) -> None:
        """With no DB rows, effective settings come from the jurisdiction."""
        token = org_user["access_token"]
        project = await _create_project_with_dates(client, token)

        resp = await client.get(
            f"/projects/{project['id']}/deadline-notification-settings",
            headers=_auth(token),
        )
        assert resp.status_code == 200
        settings = resp.json()

        assert len(settings) == 3
        by_type = {s["deadline_type"]: s for s in settings}

        # construction_notification uses the global default (30, 14, 7, 3, 1)
        cn = by_type["construction_notification"]
        assert cn["reminder_days"] == [30, 14, 7, 3, 1]
        assert cn["recipient_roles"] == ["owner", "editor", "contractor"]
        assert cn["source"] == "jurisdiction_default"
        assert cn["enabled"] is True

        # information_obligation has a custom default (3, 1)
        io = by_type["information_obligation"]
        assert io["reminder_days"] == [3, 1]
        assert io["source"] == "jurisdiction_default"

    async def test_org_default_overrides_jurisdiction(
        self, client: AsyncClient, org_user: dict[str, str]
    ) -> None:
        """After PATCHing org defaults, project GET shows org_default source."""
        token = org_user["access_token"]

        # Set org default
        resp = await client.patch(
            "/deadline-notification-settings/construction_notification",
            json={"reminder_days": [21, 7]},
            headers=_auth(token),
        )
        assert resp.status_code == 200
        assert resp.json()["source"] == "org_default"
        assert resp.json()["reminder_days"] == [21, 7]

        # Project should inherit org default
        project = await _create_project_with_dates(client, token)
        resp = await client.get(
            f"/projects/{project['id']}/deadline-notification-settings",
            headers=_auth(token),
        )
        assert resp.status_code == 200
        by_type = {s["deadline_type"]: s for s in resp.json()}
        assert by_type["construction_notification"]["source"] == "org_default"
        assert by_type["construction_notification"]["reminder_days"] == [21, 7]
        # Other types still from jurisdiction
        assert by_type["information_obligation"]["source"] == "jurisdiction_default"

    async def test_project_override_wins_over_org_default(
        self, client: AsyncClient, org_user: dict[str, str]
    ) -> None:
        """Project-level PUT creates override that wins over org default."""
        token = org_user["access_token"]

        # Set org default first
        resp = await client.patch(
            "/deadline-notification-settings/construction_notification",
            json={"reminder_days": [21, 7]},
            headers=_auth(token),
        )
        assert resp.status_code == 200

        # Create project and add override
        project = await _create_project_with_dates(client, token)
        resp = await client.put(
            f"/projects/{project['id']}/deadline-notification-settings/construction_notification",
            json={"reminder_days": [30, 14, 7], "recipient_roles": ["owner"]},
            headers=_auth(token),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["source"] == "project_override"
        assert data["reminder_days"] == [30, 14, 7]
        assert data["recipient_roles"] == ["owner"]

    async def test_delete_project_override_reverts_to_org_default(
        self, client: AsyncClient, org_user: dict[str, str]
    ) -> None:
        """DELETE removes the project override; settings revert."""
        token = org_user["access_token"]

        # Set org default
        await client.patch(
            "/deadline-notification-settings/construction_notification",
            json={"reminder_days": [21, 7]},
            headers=_auth(token),
        )

        project = await _create_project_with_dates(client, token)

        # Set project override
        await client.put(
            f"/projects/{project['id']}/deadline-notification-settings/construction_notification",
            json={"reminder_days": [30]},
            headers=_auth(token),
        )

        # Delete it
        resp = await client.delete(
            f"/projects/{project['id']}/deadline-notification-settings/construction_notification",
            headers=_auth(token),
        )
        assert resp.status_code == 204

        # Should fall back to org default
        resp = await client.get(
            f"/projects/{project['id']}/deadline-notification-settings",
            headers=_auth(token),
        )
        by_type = {s["deadline_type"]: s for s in resp.json()}
        assert by_type["construction_notification"]["source"] == "org_default"
        assert by_type["construction_notification"]["reminder_days"] == [21, 7]


# ---------------------------------------------------------------------------
# Org defaults API — permission gates
# ---------------------------------------------------------------------------


class TestOrgDefaultsPermissions:
    async def test_org_admin_can_read(
        self, client: AsyncClient, org_user: dict[str, str]
    ) -> None:
        resp = await client.get(
            "/deadline-notification-settings",
            headers=_auth(org_user["access_token"]),
        )
        assert resp.status_code == 200
        assert len(resp.json()) == 3

    async def test_non_admin_gets_403(
        self,
        client: AsyncClient,
        org_user: dict[str, str],
        same_org_non_admin_user: dict[str, str],
    ) -> None:
        resp = await client.get(
            "/deadline-notification-settings",
            headers=_auth(same_org_non_admin_user["access_token"]),
        )
        assert resp.status_code == 403

    async def test_org_admin_can_patch(
        self, client: AsyncClient, org_user: dict[str, str]
    ) -> None:
        resp = await client.patch(
            "/deadline-notification-settings/construction_notification",
            json={"enabled": False},
            headers=_auth(org_user["access_token"]),
        )
        assert resp.status_code == 200
        assert resp.json()["enabled"] is False

    async def test_patch_unknown_type_returns_404(
        self, client: AsyncClient, org_user: dict[str, str]
    ) -> None:
        resp = await client.patch(
            "/deadline-notification-settings/nonexistent_type",
            json={"enabled": False},
            headers=_auth(org_user["access_token"]),
        )
        assert resp.status_code == 404

    async def test_patch_is_partial_update(
        self, client: AsyncClient, org_user: dict[str, str]
    ) -> None:
        """PATCHing only `enabled` preserves other fields from jurisdiction defaults."""
        token = org_user["access_token"]

        # Patch only enabled
        resp = await client.patch(
            "/deadline-notification-settings/construction_notification",
            json={"enabled": False},
            headers=_auth(token),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["enabled"] is False
        # Should still have jurisdiction default values for the rest
        assert data["reminder_days"] == [30, 14, 7, 3, 1]
        assert data["recipient_roles"] == ["owner", "editor", "contractor"]


# ---------------------------------------------------------------------------
# Project settings API — permission gates
# ---------------------------------------------------------------------------


class TestProjectSettingsPermissions:
    async def test_viewer_can_read_project_settings(
        self,
        client: AsyncClient,
        org_user: dict[str, str],
        same_org_user: dict[str, str],
    ) -> None:
        """Viewer can read settings (via project read access)."""
        token = org_user["access_token"]
        project = await _create_project_with_dates(client, token)

        # same_org_user is auto-added as editor by default project creation;
        # set them to viewer
        resp = await client.patch(
            f"/projects/{project['id']}/members/{same_org_user['id']}",
            json={"role": "viewer"},
            headers=_auth(token),
        )
        assert resp.status_code == 200

        resp = await client.get(
            f"/projects/{project['id']}/deadline-notification-settings",
            headers=_auth(same_org_user["access_token"]),
        )
        assert resp.status_code == 200

    async def test_viewer_cannot_put_project_setting(
        self,
        client: AsyncClient,
        org_user: dict[str, str],
        same_org_non_admin_user: dict[str, str],
    ) -> None:
        """Viewer cannot create/update project overrides."""
        token = org_user["access_token"]
        project = await _create_project_with_dates(client, token)

        # Add as viewer
        await client.post(
            f"/projects/{project['id']}/members",
            json={
                "user_id": same_org_non_admin_user["id"],
                "role": "viewer",
            },
            headers=_auth(token),
        )

        resp = await client.put(
            f"/projects/{project['id']}/deadline-notification-settings/construction_notification",
            json={"reminder_days": [7, 3]},
            headers=_auth(same_org_non_admin_user["access_token"]),
        )
        assert resp.status_code == 403

    async def test_editor_can_put_project_setting(
        self,
        client: AsyncClient,
        org_user: dict[str, str],
        same_org_user: dict[str, str],
    ) -> None:
        """Editor can create project overrides."""
        token = org_user["access_token"]
        project = await _create_project_with_dates(client, token)

        resp = await client.put(
            f"/projects/{project['id']}/deadline-notification-settings/construction_notification",
            json={"reminder_days": [7, 3]},
            headers=_auth(same_org_user["access_token"]),
        )
        assert resp.status_code == 200
        assert resp.json()["reminder_days"] == [7, 3]

    async def test_put_unknown_type_returns_404(
        self,
        client: AsyncClient,
        org_user: dict[str, str],
    ) -> None:
        token = org_user["access_token"]
        project = await _create_project_with_dates(client, token)

        resp = await client.put(
            f"/projects/{project['id']}/deadline-notification-settings/nonexistent_type",
            json={"reminder_days": [7]},
            headers=_auth(token),
        )
        assert resp.status_code == 404

    async def test_put_is_idempotent(
        self,
        client: AsyncClient,
        org_user: dict[str, str],
    ) -> None:
        """Calling PUT twice updates the existing row."""
        token = org_user["access_token"]
        project = await _create_project_with_dates(client, token)

        for _ in range(2):
            resp = await client.put(
                f"/projects/{project['id']}/deadline-notification-settings/construction_notification",
                json={"reminder_days": [10, 5]},
                headers=_auth(token),
            )
            assert resp.status_code == 200
        assert resp.json()["reminder_days"] == [10, 5]

    async def test_delete_nonexistent_is_noop(
        self,
        client: AsyncClient,
        org_user: dict[str, str],
    ) -> None:
        """DELETE on a type with no override is a silent 204."""
        token = org_user["access_token"]
        project = await _create_project_with_dates(client, token)

        resp = await client.delete(
            f"/projects/{project['id']}/deadline-notification-settings/construction_notification",
            headers=_auth(token),
        )
        assert resp.status_code == 204


# ---------------------------------------------------------------------------
# RLS tenant isolation
# ---------------------------------------------------------------------------


class TestRLSIsolation:
    async def test_org_b_cannot_see_org_a_settings(
        self,
        client: AsyncClient,
        org_user: dict[str, str],
        other_org_user: dict[str, str],
    ) -> None:
        """Org defaults from org A are invisible to org B."""
        # Org A sets a default
        resp = await client.patch(
            "/deadline-notification-settings/construction_notification",
            json={"reminder_days": [21, 14, 7]},
            headers=_auth(org_user["access_token"]),
        )
        assert resp.status_code == 200

        # Org B reads defaults — should see jurisdiction defaults, not A's
        resp = await client.get(
            "/deadline-notification-settings",
            headers=_auth(other_org_user["access_token"]),
        )
        assert resp.status_code == 200
        by_type = {s["deadline_type"]: s for s in resp.json()}
        assert by_type["construction_notification"]["source"] == "jurisdiction_default"
        assert by_type["construction_notification"]["reminder_days"] == [30, 14, 7, 3, 1]

    async def test_org_b_cannot_see_org_a_project(
        self,
        client: AsyncClient,
        org_user: dict[str, str],
        other_org_user: dict[str, str],
    ) -> None:
        """Project from org A is invisible to org B."""
        project = await _create_project_with_dates(
            client, org_user["access_token"], name="Org A Only"
        )

        resp = await client.get(
            f"/projects/{project['id']}/deadline-notification-settings",
            headers=_auth(other_org_user["access_token"]),
        )
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Jurisdictions endpoint: default_reminder_days + default_recipient_roles
# ---------------------------------------------------------------------------


class TestJurisdictionEndpointDefaults:
    async def test_deadline_rules_include_defaults(
        self, client: AsyncClient, org_user: dict[str, str]
    ) -> None:
        """GET /jurisdictions returns reminder defaults on each deadline rule."""
        resp = await client.get("/jurisdictions")
        assert resp.status_code == 200
        jurisdictions = resp.json()["items"]
        nl = next(j for j in jurisdictions if j["country"] == "NL")
        rules = nl["deadline_rules"]
        assert len(rules) == 3

        cn_rule = next(r for r in rules if r["deadline_type"] == "construction_notification")
        assert cn_rule["default_reminder_days"] == [30, 14, 7, 3, 1]
        assert cn_rule["default_recipient_roles"] == ["owner", "editor", "contractor"]

        io_rule = next(r for r in rules if r["deadline_type"] == "information_obligation")
        assert io_rule["default_reminder_days"] == [3, 1]
