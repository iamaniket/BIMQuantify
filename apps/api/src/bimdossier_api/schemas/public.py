from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

SystemStatus = Literal["normal", "degraded", "down"]


class ProjectsMapPoint(BaseModel):
    """A single anonymized location marker for the pre-login NL map.

    Aggregated across all organizations. No org or project names are exposed
    — just city, average lat/lng, and an approximate count of projects in
    that city. `count` is floored to one significant figure (e.g. 14 -> 10,
    121 -> 100) for values >= 10; below 10 it is exact.
    """

    city: str
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    count: int = Field(ge=0)


class SystemStatusResponse(BaseModel):
    """Live platform health + real capability figures for the login/marketing
    surfaces. The ``*_checks`` counts are the implemented automated rule counts
    per framework (honest coverage, not a made-up version string); ``ifc_schemas``
    is exactly what the IFC parser accepts."""

    status: SystemStatus
    region: str
    node: str
    wkb_checks: int
    bbl_checks: int
    ifc_schemas: list[str] = Field(default_factory=list)
    checks: dict[str, bool] = Field(default_factory=dict)
