"""Unit tests for deadline working-day arithmetic.

Pure-function tests — no DB, no FastAPI, no fixtures. Exercises the
`holidays` library integration for NL national holidays and the
calendar-day vs. working-day distinction used by the three Wkb
deadline rules.
"""

from __future__ import annotations

import datetime as dt

import pytest

from bimdossier_api.deadlines.working_days import (
    add_working_days,
    compute_due_date,
    subtract_working_days,
)
from bimdossier_api.jurisdictions import DeadlineRule


# ---------------------------------------------------------------------------
# add_working_days
# ---------------------------------------------------------------------------


def test_add_zero_working_days_returns_same_date() -> None:
    assert add_working_days(dt.date(2026, 6, 2), 0) == dt.date(2026, 6, 2)  # Monday


def test_add_working_days_normal_week() -> None:
    # Mon 2026-06-01 + 3 working days = Thu 2026-06-04
    assert add_working_days(dt.date(2026, 6, 1), 3) == dt.date(2026, 6, 4)


def test_add_working_days_across_weekend() -> None:
    # Thu 2026-06-04 + 2 working days = Mon 2026-06-08 (skips Sat+Sun)
    assert add_working_days(dt.date(2026, 6, 4), 2) == dt.date(2026, 6, 8)


def test_add_working_days_across_koningsdag() -> None:
    # Koningsdag 2026 = Mon 27 April. Starting Wed 22 Apr 2026:
    # +1=Thu 23, +2=Fri 24, +3=Tue 28 (skip Sat 25, Sun 26, Mon 27=Koningsdag)
    assert add_working_days(dt.date(2026, 4, 22), 3) == dt.date(2026, 4, 28)


def test_add_working_days_across_christmas() -> None:
    # Kerst 2026: Fri 25 Dec = Christmas, Sat 26 Dec = 2nd Christmas day
    # Starting Wed 23 Dec 2026:
    # +1=Thu 24, +2=Mon 28 (skip Fri 25=Kerst, Sat 26=2e Kerstdag, Sun 27)
    assert add_working_days(dt.date(2026, 12, 23), 2) == dt.date(2026, 12, 28)


def test_add_working_days_across_new_year() -> None:
    # Nieuwjaar 2027 = Fri 1 Jan. Starting Wed 30 Dec 2026:
    # +1=Thu 31, skip Fri 1 Jan (Nieuwjaar), skip Sat 2, skip Sun 3,
    # +2=Mon 4 Jan 2027
    assert add_working_days(dt.date(2026, 12, 30), 2) == dt.date(2027, 1, 4)


def test_add_working_days_negative_raises() -> None:
    with pytest.raises(ValueError, match="days must be >= 0"):
        add_working_days(dt.date(2026, 6, 1), -1)


# ---------------------------------------------------------------------------
# subtract_working_days
# ---------------------------------------------------------------------------


def test_subtract_zero_working_days_returns_same_date() -> None:
    assert subtract_working_days(dt.date(2026, 6, 4), 0) == dt.date(2026, 6, 4)


def test_subtract_working_days_normal_week() -> None:
    # Thu 2026-06-04 - 2 working days = Tue 2026-06-02
    assert subtract_working_days(dt.date(2026, 6, 4), 2) == dt.date(2026, 6, 2)


def test_subtract_working_days_across_weekend() -> None:
    # Mon 2026-06-08 - 2 working days = Thu 2026-06-04 (skips Sun+Sat)
    assert subtract_working_days(dt.date(2026, 6, 8), 2) == dt.date(2026, 6, 4)


def test_subtract_working_days_across_koningsdag() -> None:
    # Koningsdag 2026 = Mon 27 April. Starting Tue 28 Apr 2026:
    # -1=Fri 24 (skip Mon 27=Koningsdag, Sun 26, Sat 25)
    assert subtract_working_days(dt.date(2026, 4, 28), 1) == dt.date(2026, 4, 24)


def test_subtract_working_days_negative_raises() -> None:
    with pytest.raises(ValueError, match="days must be >= 0"):
        subtract_working_days(dt.date(2026, 6, 1), -1)


# ---------------------------------------------------------------------------
# compute_due_date — per Wkb deadline type
# ---------------------------------------------------------------------------

# Construction notification (bouwmelding): 28 calendar days before planned_start_date
_CONSTRUCTION_NOTIFICATION = DeadlineRule(
    deadline_type="construction_notification",
    label={"nl": "Bouwmelding", "en": "Construction notification"},
    source_field="planned_start_date",
    offset_days=28,
    use_working_days=False,
    direction="before",
)

# Information obligation (informatieplicht): 2 working days before planned_start_date
_INFORMATION_OBLIGATION = DeadlineRule(
    deadline_type="information_obligation",
    label={"nl": "Informatieplicht", "en": "Information obligation"},
    source_field="planned_start_date",
    offset_days=2,
    use_working_days=True,
    direction="before",
)

# Completion notification (gereedmelding): 10 working days after delivery_date
_COMPLETION_NOTIFICATION = DeadlineRule(
    deadline_type="completion_notification",
    label={"nl": "Gereedmelding", "en": "Completion notification"},
    source_field="delivery_date",
    offset_days=10,
    use_working_days=True,
    direction="after",
)


def test_construction_notification_28_calendar_days() -> None:
    # Planned start 2026-07-01 → due 2026-06-03
    result = compute_due_date(dt.date(2026, 7, 1), _CONSTRUCTION_NOTIFICATION, "NL")
    assert result == dt.date(2026, 6, 3)


def test_information_obligation_2_working_days_before() -> None:
    # Planned start Wed 2026-07-01 → -2 working days = Mon 2026-06-29
    result = compute_due_date(dt.date(2026, 7, 1), _INFORMATION_OBLIGATION, "NL")
    assert result == dt.date(2026, 6, 29)


def test_information_obligation_across_weekend() -> None:
    # Planned start Mon 2026-06-08 → -2 working days = Thu 2026-06-04
    result = compute_due_date(dt.date(2026, 6, 8), _INFORMATION_OBLIGATION, "NL")
    assert result == dt.date(2026, 6, 4)


def test_completion_notification_10_working_days_after() -> None:
    # Delivery Mon 2026-06-01 → +10 working days = Mon 2026-06-15
    result = compute_due_date(dt.date(2026, 6, 1), _COMPLETION_NOTIFICATION, "NL")
    assert result == dt.date(2026, 6, 15)


def test_completion_notification_across_holidays() -> None:
    # Delivery Fri 2026-12-18 → +10 working days, crossing Kerst + Nieuwjaar
    # Working days: Mon 21, Tue 22, Wed 23, Thu 24 (4 so far)
    # Fri 25 = Kerst, Sat/Sun skip, Mon 28, Tue 29, Wed 30, Thu 31 (8)
    # Fri 1 Jan = Nieuwjaar, Mon 4 Jan, Tue 5 Jan (10)
    result = compute_due_date(dt.date(2026, 12, 18), _COMPLETION_NOTIFICATION, "NL")
    assert result == dt.date(2027, 1, 5)


def test_compute_due_date_unknown_direction_raises() -> None:
    bad_rule = DeadlineRule(
        deadline_type="test",
        label={},
        source_field="x",
        offset_days=1,
        use_working_days=False,
        direction="sideways",
    )
    with pytest.raises(ValueError, match="Unknown direction"):
        compute_due_date(dt.date(2026, 1, 1), bad_rule, "NL")
