"""Pure working-day arithmetic — no DB access.

`add_working_days` / `subtract_working_days` walk day-by-day, skipping
weekends (Saturday + Sunday) and national holidays for the given country.
The `holidays` library provides the holiday calendar.

`compute_due_date` is the top-level helper that takes a `DeadlineRule`
and a source date and returns the computed due date.
"""

from __future__ import annotations

import datetime as _dt

import holidays as _holidays

from bimstitch_api.jurisdictions import DeadlineRule


def _holiday_set(country: str, years: set[int]) -> set[_dt.date]:
    """Build a set of holiday dates for the given country and years."""
    return set(_holidays.country_holidays(country, years=years))


def add_working_days(start: _dt.date, days: int, country: str = "NL") -> _dt.date:
    """Add *days* working days to *start*, skipping weekends + holidays.

    ``days=0`` returns *start* (or the next working day if *start* itself
    is a non-working day — but callers don't rely on that edge today).
    """
    if days < 0:
        raise ValueError("days must be >= 0; use subtract_working_days for backward movement")

    # Pre-fetch holidays for a reasonable year range (start year ±1 to cover
    # year boundaries when walking forward).
    hols = _holiday_set(country, {start.year, start.year + 1})
    current = start
    remaining = days
    while remaining > 0:
        current += _dt.timedelta(days=1)
        if current.weekday() < 5 and current not in hols:
            remaining -= 1
    return current


def subtract_working_days(start: _dt.date, days: int, country: str = "NL") -> _dt.date:
    """Subtract *days* working days from *start*, skipping weekends + holidays."""
    if days < 0:
        raise ValueError("days must be >= 0; use add_working_days for forward movement")

    hols = _holiday_set(country, {start.year, start.year - 1})
    current = start
    remaining = days
    while remaining > 0:
        current -= _dt.timedelta(days=1)
        if current.weekday() < 5 and current not in hols:
            remaining -= 1
    return current


def compute_due_date(
    source_date: _dt.date,
    rule: DeadlineRule,
    country: str,
) -> _dt.date:
    """Compute the due date for a single deadline rule.

    Delegates to calendar-day or working-day arithmetic depending on the
    rule's ``use_working_days`` flag.
    """
    if rule.direction == "before":
        if rule.use_working_days:
            return subtract_working_days(source_date, rule.offset_days, country)
        return source_date - _dt.timedelta(days=rule.offset_days)
    elif rule.direction == "after":
        if rule.use_working_days:
            return add_working_days(source_date, rule.offset_days, country)
        return source_date + _dt.timedelta(days=rule.offset_days)
    else:
        raise ValueError(f"Unknown direction: {rule.direction!r}")
