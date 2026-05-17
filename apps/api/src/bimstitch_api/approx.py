"""Approximate-count rounding for public/anonymized payloads.

Public endpoints that expose aggregate counts round these down so exact
tenant data never leaves the server. The rule keeps one significant
figure for n >= 10, exact below:

    9    -> 9
    14   -> 10
    121  -> 100
    1234 -> 1000

The result is always a non-negative integer <= n.
"""

from __future__ import annotations


def approx_count_floor(n: int) -> int:
    if n < 10:
        return max(0, n)
    magnitude = 10 ** (len(str(n)) - 1)
    return (n // magnitude) * magnitude
