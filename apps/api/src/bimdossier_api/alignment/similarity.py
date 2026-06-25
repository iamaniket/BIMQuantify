"""2-point similarity transform solver for PDF<->3D sheet alignment.

A *similarity* transform is uniform scale + rotation + translation (4 DOF, no
shear) — the industry-standard model for pinning a 2D drawing onto a model.
Given two source control points and the two matching target control points it
is fully determined.

Coordinate-space contract (important): this solver is pure 2D and space-blind.
The caller is responsible for putting *both* point pairs into the same 2D
space before calling. For sheet alignment that means:

* ``source`` — PDF page coordinates already flipped to the viewer's plan
  convention (i.e. ``(u, 1 - v)`` for normalized page coords), and
* ``target`` — the 3D model picks projected into the same plan space via the
  viewer's existing ``viewerToPlan`` (which owns the single Y-up negation).

Keeping the solver oblivious to those conventions is deliberate: the Y-up
composition lives in exactly one place (the viewer), and this module stays
trivially unit-testable. See ``tests/test_alignment_solver.py``.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from collections.abc import Sequence

Point = tuple[float, float]

# Below this baseline length (target or source) the two control points are
# treated as coincident and no transform can be derived.
_MIN_BASELINE = 1e-9


class DegeneratePointsError(ValueError):
    """The source or target control-point pair is (near-)coincident.

    A similarity needs two *distinct* points on each side to recover scale and
    rotation; coincident picks make the problem unsolvable.
    """


@dataclass(frozen=True, slots=True)
class Similarity2D:
    """A 2D similarity transform: ``q = scale * R(theta) * p + offset``."""

    scale: float
    rotation_rad: float
    offset_x: float
    offset_y: float

    def apply(self, x: float, y: float) -> Point:
        """Map a source-space point to target space."""
        cos = math.cos(self.rotation_rad)
        sin = math.sin(self.rotation_rad)
        return (
            self.scale * (cos * x - sin * y) + self.offset_x,
            self.scale * (sin * x + cos * y) + self.offset_y,
        )

    def inverse(self) -> Similarity2D:
        """Return the transform mapping target space back to source space."""
        inv_scale = 1.0 / self.scale
        inv_rot = -self.rotation_rad
        cos = math.cos(inv_rot)
        sin = math.sin(inv_rot)
        # p = (1/s) * R(-theta) * (q - t)  ->  offset = -(1/s) * R(-theta) * t
        offset_x = -inv_scale * (cos * self.offset_x - sin * self.offset_y)
        offset_y = -inv_scale * (sin * self.offset_x + cos * self.offset_y)
        return Similarity2D(
            scale=inv_scale,
            rotation_rad=inv_rot,
            offset_x=offset_x,
            offset_y=offset_y,
        )


def solve_similarity(source: Sequence[Point], target: Sequence[Point]) -> Similarity2D:
    """Solve the similarity mapping ``source`` onto ``target``.

    Both arguments must hold exactly two points in the same 2D space.

    Raises:
        ValueError: if either sequence does not hold exactly two points.
        DegeneratePointsError: if either point pair is (near-)coincident.
    """
    if len(source) != 2 or len(target) != 2:
        raise ValueError("solve_similarity requires exactly 2 source and 2 target points")

    (p1x, p1y), (p2x, p2y) = source
    (q1x, q1y), (q2x, q2y) = target

    dpx, dpy = p2x - p1x, p2y - p1y
    dqx, dqy = q2x - q1x, q2y - q1y
    src_baseline = math.hypot(dpx, dpy)
    tgt_baseline = math.hypot(dqx, dqy)
    if src_baseline < _MIN_BASELINE:
        raise DegeneratePointsError("source control points are coincident")
    if tgt_baseline < _MIN_BASELINE:
        raise DegeneratePointsError("target control points are coincident")

    scale = tgt_baseline / src_baseline
    # Normalize the angle difference to (-pi, pi] so callers get a canonical value.
    rotation = math.atan2(dqy, dqx) - math.atan2(dpy, dpx)
    rotation = math.atan2(math.sin(rotation), math.cos(rotation))

    cos = math.cos(rotation)
    sin = math.sin(rotation)
    # t = q1 - scale * R(theta) * p1
    offset_x = q1x - scale * (cos * p1x - sin * p1y)
    offset_y = q1y - scale * (sin * p1x + cos * p1y)

    return Similarity2D(
        scale=scale,
        rotation_rad=rotation,
        offset_x=offset_x,
        offset_y=offset_y,
    )
