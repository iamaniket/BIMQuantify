"""Admitted-Wkb-instrument registry + evidence-bundle manifest.

Mirrors the `jurisdictions/` registry pattern. v0 is a *manual* export bridge: we
have no live KiK/WKI API relationship yet, so the bundle endpoint packages the
findings (as BCF + JSON) with a `manifest.json` that documents the neutral schema
a kwaliteitsborger imports into their instrument by hand. The per-instrument
adapter modules (`kik.py`, `wki.py`) that turn this into a live push land here the
day a partnership does — this package is that seam.
"""

from bimdossier_api.instruments.registry import (
    MANIFEST_SCHEMA_VERSION,
    Instrument,
    build_bundle_manifest,
    get_instrument,
    list_instruments,
    register,
)

__all__ = [
    "MANIFEST_SCHEMA_VERSION",
    "Instrument",
    "build_bundle_manifest",
    "get_instrument",
    "list_instruments",
    "register",
]
