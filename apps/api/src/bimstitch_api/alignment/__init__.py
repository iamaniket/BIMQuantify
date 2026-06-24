"""Geometry helpers for aligning 2D drawings to 3D models."""

from bimstitch_api.alignment.similarity import (
    DegeneratePointsError,
    Similarity2D,
    solve_similarity,
)

__all__ = ["DegeneratePointsError", "Similarity2D", "solve_similarity"]
