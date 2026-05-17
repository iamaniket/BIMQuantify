"""Unit tests for approx_count_floor — used to anonymize public counts."""

from __future__ import annotations

import pytest

from bimstitch_api.approx import approx_count_floor


@pytest.mark.parametrize(
    ("n", "expected"),
    [
        (-5, 0),
        (0, 0),
        (1, 1),
        (9, 9),
        (10, 10),
        (14, 10),
        (27, 20),
        (99, 90),
        (100, 100),
        (121, 100),
        (199, 100),
        (200, 200),
        (1000, 1000),
        (1234, 1000),
        (9999, 9000),
        (10_000, 10_000),
        (12_500, 10_000),
    ],
)
def test_approx_count_floor(n: int, expected: int) -> None:
    assert approx_count_floor(n) == expected
