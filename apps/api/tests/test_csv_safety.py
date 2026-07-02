"""Unit tests for CSV formula-injection neutralization (no DB)."""

from __future__ import annotations

import pytest

from bimdossier_api.csv_safety import csv_safe_mapping, csv_safe_row, csv_safe_value


@pytest.mark.parametrize(
    "raw",
    [
        "=1+1",
        "+1",
        "-1",
        "@SUM(A1)",
        "=cmd|'/c calc'!A1",
        "\t=1",
        "\r=1",
    ],
)
def test_dangerous_values_are_prefixed(raw: str) -> None:
    out = csv_safe_value(raw)
    assert out == "'" + raw
    # The neutralized cell no longer begins with a formula trigger.
    assert not out.startswith(("=", "+", "-", "@", "\t", "\r"))


@pytest.mark.parametrize(
    "raw",
    ["hello", "Room 4.51", "2026-07-02", "user@example.com", "", "123", "a=b"],
)
def test_safe_values_untouched(raw: str) -> None:
    # A trigger char that is NOT leading (e.g. an email, "a=b") stays as-is.
    assert csv_safe_value(raw) == raw


def test_none_becomes_empty_string() -> None:
    assert csv_safe_value(None) == ""


def test_row_and_mapping_helpers() -> None:
    assert csv_safe_row(["=evil", "ok", 5]) == ["'=evil", "ok", "5"]
    assert csv_safe_mapping({"a": "=evil", "b": "ok"}) == {"a": "'=evil", "b": "ok"}
