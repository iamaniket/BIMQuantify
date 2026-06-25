"""Unit tests for the 2-point similarity solver used by PDF<->3D alignment.

Pure-function tests — no DB, no FastAPI, no fixtures. The solver maps a pair of
source control points (PDF page space, already flipped to plan convention) onto
a pair of target control points (the 3D model projected into plan space) as a
similarity transform: uniform scale + rotation + translation, no shear. See
``bimdossier_api.alignment.similarity``.
"""

from __future__ import annotations

import math

import pytest

from bimdossier_api.alignment import (
    DegeneratePointsError,
    Similarity2D,
    solve_similarity,
)

_ABS = 1e-9


def _close(a: float, b: float, tol: float = 1e-9) -> bool:
    return math.isclose(a, b, abs_tol=tol)


# ---------------------------------------------------------------------------
# solve_similarity — the four canonical cases
# ---------------------------------------------------------------------------


def test_identity() -> None:
    t = solve_similarity([(0.0, 0.0), (1.0, 0.0)], [(0.0, 0.0), (1.0, 0.0)])
    assert _close(t.scale, 1.0)
    assert _close(t.rotation_rad, 0.0)
    assert _close(t.offset_x, 0.0)
    assert _close(t.offset_y, 0.0)
    assert all(_close(a, b) for a, b in zip(t.apply(0.5, 0.7), (0.5, 0.7), strict=True))


def test_pure_translation() -> None:
    t = solve_similarity([(0.0, 0.0), (1.0, 0.0)], [(5.0, 3.0), (6.0, 3.0)])
    assert _close(t.scale, 1.0)
    assert _close(t.rotation_rad, 0.0)
    assert _close(t.offset_x, 5.0)
    assert _close(t.offset_y, 3.0)
    assert all(_close(a, b) for a, b in zip(t.apply(0.0, 0.0), (5.0, 3.0), strict=True))


def test_pure_rotation_90deg() -> None:
    # source +X axis maps to target +Y axis -> +90 degrees
    t = solve_similarity([(0.0, 0.0), (1.0, 0.0)], [(0.0, 0.0), (0.0, 1.0)])
    assert _close(t.scale, 1.0)
    assert _close(t.rotation_rad, math.pi / 2)
    assert _close(t.offset_x, 0.0)
    assert _close(t.offset_y, 0.0)
    assert all(_close(a, b) for a, b in zip(t.apply(1.0, 0.0), (0.0, 1.0), strict=True))


def test_pure_rotation_negative_90deg() -> None:
    # source +Y axis maps to target +X axis -> -90 degrees
    t = solve_similarity([(0.0, 0.0), (0.0, 1.0)], [(0.0, 0.0), (1.0, 0.0)])
    assert _close(t.rotation_rad, -math.pi / 2)


def test_pure_scale_2x() -> None:
    t = solve_similarity([(0.0, 0.0), (1.0, 0.0)], [(0.0, 0.0), (2.0, 0.0)])
    assert _close(t.scale, 2.0)
    assert _close(t.rotation_rad, 0.0)


def test_combined_scale_rotation_translation() -> None:
    # Expected transform: scale 2, rotate +90 deg, translate (10, -5).
    # Build the target by applying that transform to the source by hand:
    #   (0,0) -> 2*R90*(0,0) + (10,-5) = (10, -5)
    #   (1,0) -> 2*R90*(1,0) + (10,-5) = 2*(0,1) + (10,-5) = (10, -3)
    src = [(0.0, 0.0), (1.0, 0.0)]
    tgt = [(10.0, -5.0), (10.0, -3.0)]
    t = solve_similarity(src, tgt)
    assert _close(t.scale, 2.0)
    assert _close(t.rotation_rad, math.pi / 2)
    assert _close(t.offset_x, 10.0)
    assert _close(t.offset_y, -5.0)
    # The defining property: applying the solved transform to the source
    # control points reproduces the target control points.
    for (sx, sy), (tx, ty) in zip(src, tgt, strict=True):
        ax, ay = t.apply(sx, sy)
        assert _close(ax, tx, 1e-6)
        assert _close(ay, ty, 1e-6)


# ---------------------------------------------------------------------------
# inverse / round-trip
# ---------------------------------------------------------------------------


def test_inverse_round_trip() -> None:
    t = solve_similarity([(0.0, 0.0), (1.0, 0.0)], [(10.0, -5.0), (10.0, -3.0)])
    inv = t.inverse()
    for x, y in [(0.0, 0.0), (3.2, -1.1), (-4.0, 7.5)]:
        fx, fy = t.apply(x, y)
        bx, by = inv.apply(fx, fy)
        assert _close(bx, x, 1e-6)
        assert _close(by, y, 1e-6)


# ---------------------------------------------------------------------------
# degenerate / invalid input
# ---------------------------------------------------------------------------


def test_degenerate_source_raises() -> None:
    with pytest.raises(DegeneratePointsError):
        solve_similarity([(2.0, 2.0), (2.0, 2.0)], [(0.0, 0.0), (1.0, 0.0)])


def test_degenerate_target_raises() -> None:
    with pytest.raises(DegeneratePointsError):
        solve_similarity([(0.0, 0.0), (1.0, 0.0)], [(4.0, 4.0), (4.0, 4.0)])


def test_near_coincident_source_raises() -> None:
    with pytest.raises(DegeneratePointsError):
        solve_similarity([(0.0, 0.0), (1e-12, 0.0)], [(0.0, 0.0), (1.0, 0.0)])


def test_wrong_point_count_raises_value_error() -> None:
    # Not a DegeneratePointsError — a contract violation.
    with pytest.raises(ValueError):
        solve_similarity([(0.0, 0.0)], [(0.0, 0.0), (1.0, 0.0)])
    with pytest.raises(ValueError):
        solve_similarity(
            [(0.0, 0.0), (1.0, 0.0)],
            [(0.0, 0.0), (1.0, 0.0), (2.0, 0.0)],
        )


def test_dataclass_is_frozen() -> None:
    t = Similarity2D(scale=1.0, rotation_rad=0.0, offset_x=0.0, offset_y=0.0)
    with pytest.raises(AttributeError):
        t.scale = 2.0  # type: ignore[misc]
