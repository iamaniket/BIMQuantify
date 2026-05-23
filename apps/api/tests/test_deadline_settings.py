"""Unit tests for deadline notification settings resolution.

Pure-function tests — exercises the schema validation logic without DB.
DB-backed settings resolution is tested via the API in
test_deadline_notification_settings.py.
"""

from __future__ import annotations

import pytest

from bimstitch_api.schemas.deadline_notification_settings import (
    DeadlineNotificationSettingsUpdate,
)


# ---------------------------------------------------------------------------
# DeadlineNotificationSettingsUpdate validation
# ---------------------------------------------------------------------------


def test_reminder_days_sorted_descending() -> None:
    schema = DeadlineNotificationSettingsUpdate(reminder_days=[1, 3, 14, 7])
    assert schema.reminder_days == [14, 7, 3, 1]


def test_reminder_days_single_value() -> None:
    schema = DeadlineNotificationSettingsUpdate(reminder_days=[7])
    assert schema.reminder_days == [7]


def test_reminder_days_zero_allowed() -> None:
    """Zero means 'day-of' reminder."""
    schema = DeadlineNotificationSettingsUpdate(reminder_days=[0])
    assert schema.reminder_days == [0]


def test_reminder_days_rejects_negative() -> None:
    with pytest.raises(ValueError, match="must be >= 0"):
        DeadlineNotificationSettingsUpdate(reminder_days=[7, -1])


def test_reminder_days_rejects_duplicates() -> None:
    with pytest.raises(ValueError, match="duplicates"):
        DeadlineNotificationSettingsUpdate(reminder_days=[7, 7, 3])


def test_reminder_days_rejects_empty() -> None:
    with pytest.raises(ValueError, match="must not be empty"):
        DeadlineNotificationSettingsUpdate(reminder_days=[])


def test_reminder_days_none_is_noop() -> None:
    schema = DeadlineNotificationSettingsUpdate(reminder_days=None)
    assert schema.reminder_days is None


def test_recipient_roles_valid_values() -> None:
    schema = DeadlineNotificationSettingsUpdate(
        recipient_roles=["owner", "editor", "contractor"]
    )
    assert schema.recipient_roles == ["owner", "editor", "contractor"]


def test_recipient_roles_all_valid() -> None:
    """All ProjectRole values should be accepted."""
    schema = DeadlineNotificationSettingsUpdate(
        recipient_roles=["owner", "editor", "viewer", "inspector"]
    )
    assert len(schema.recipient_roles) == 4


def test_recipient_roles_rejects_unknown() -> None:
    with pytest.raises(ValueError, match="Invalid role"):
        DeadlineNotificationSettingsUpdate(recipient_roles=["owner", "dictator"])


def test_recipient_roles_rejects_empty() -> None:
    with pytest.raises(ValueError, match="must not be empty"):
        DeadlineNotificationSettingsUpdate(recipient_roles=[])


def test_recipient_roles_none_is_noop() -> None:
    schema = DeadlineNotificationSettingsUpdate(recipient_roles=None)
    assert schema.recipient_roles is None


def test_partial_update_all_none() -> None:
    """All fields None → valid, no updates to apply."""
    schema = DeadlineNotificationSettingsUpdate()
    assert schema.reminder_days is None
    assert schema.recipient_roles is None
    assert schema.enabled is None


def test_enabled_only() -> None:
    schema = DeadlineNotificationSettingsUpdate(enabled=False)
    assert schema.enabled is False
    assert schema.reminder_days is None
    assert schema.recipient_roles is None
