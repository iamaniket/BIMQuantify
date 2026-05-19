from __future__ import annotations

import pytest

from bimstitch_api.models.notification import NotificationEventType


# Override conftest's autouse DB/Redis fixtures — enum is pure Python.
@pytest.fixture(autouse=True)
def _clean_tables() -> None:
    return None


@pytest.fixture(autouse=True)
def _flush_redis() -> None:
    return None


@pytest.fixture(autouse=True)
def _stub_extraction_dispatcher() -> None:
    return None


def test_job_event_types_present() -> None:
    # Existing producers must keep working.
    assert NotificationEventType.job_started.value == "job_started"
    assert NotificationEventType.job_succeeded.value == "job_succeeded"
    assert NotificationEventType.job_failed.value == "job_failed"
    assert NotificationEventType.job_progress.value == "job_progress"


def test_deadline_finding_invitation_event_types_present() -> None:
    # Backlog #30 — extend the feed so the UI can render filtering chrome
    # ahead of the producers that will emit each value.
    expected = {
        "deadline_upcoming",
        "deadline_missed",
        "finding_created",
        "finding_resolved",
        "invitation_sent",
        "invitation_accepted",
    }
    actual = {member.value for member in NotificationEventType}
    assert expected.issubset(actual), expected - actual


def test_no_unexpected_legacy_values() -> None:
    # A safety net: if someone deletes a value, the test catches it before
    # a notification.event_type column rejects a legal historic row.
    expected_legacy = {
        "job_started",
        "job_succeeded",
        "job_failed",
        "job_progress",
    }
    actual = {member.value for member in NotificationEventType}
    assert expected_legacy.issubset(actual)
