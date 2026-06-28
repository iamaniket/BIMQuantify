"""The admitted-instrument registry + bundle-manifest builder.

Adding a real instrument adapter later = a sibling module that `register(...)`s
its `Instrument` and implements an outbound push (a `JobType.instrument_sync`
dispatch, mirroring the processor dispatch). For now every instrument shares the
same neutral manual-export manifest, so the seam is in place without committing
to any one instrument's (undocumented, partnership-gated) import schema.
"""

from __future__ import annotations

from dataclasses import dataclass

# Bump when the manifest's neutral schema changes shape, so an importer can tell.
MANIFEST_SCHEMA_VERSION = "1.0"


@dataclass(frozen=True)
class Instrument:
    """An admitted Wkb instrument (TloKB) and its operator."""

    code: str
    name: str
    operator: str


_INSTRUMENTS: dict[str, Instrument] = {}


def register(instrument: Instrument) -> None:
    _INSTRUMENTS[instrument.code] = instrument


def get_instrument(code: str | None) -> Instrument | None:
    if not code:
        return None
    return _INSTRUMENTS.get(code.lower())


def list_instruments() -> list[Instrument]:
    return list(_INSTRUMENTS.values())


# The currently-admitted NL instruments. v0 has no live integration with any of
# them; the bundle is shaped for manual import. Operators per the TloKB register.
register(Instrument(code="kik", name="KiK", operator="BRIS"))
register(Instrument(code="wki", name="WKI", operator="Woningborg"))
register(Instrument(code="kgw", name="KGW", operator="KOMO"))
register(Instrument(code="vkb", name="VKB", operator="SWK"))


def build_bundle_manifest(
    *,
    project_id: str,
    project_name: str,
    country: str,
    instrument_ref: str | None,
    finding_count: int,
    bcf_filename: str,
    json_filename: str,
) -> dict[str, object]:
    """The bundle's `manifest.json` — what's inside and how it maps to a neutral
    schema so an instrument operator can ingest it without our internal docs."""
    instrument = get_instrument(instrument_ref)
    return {
        "schema_version": MANIFEST_SCHEMA_VERSION,
        "kind": "wkb_evidence_bundle",
        "project": {"id": project_id, "name": project_name, "country": country},
        "instrument": (
            {"code": instrument.code, "name": instrument.name, "operator": instrument.operator}
            if instrument is not None
            else {"code": instrument_ref}
        ),
        "contents": [
            {
                "file": bcf_filename,
                "format": "BCF 2.1",
                "description": "Findings as BCF topics; element GlobalId in the viewpoint selection.",  # noqa: E501
            },
            {
                "file": json_filename,
                "format": "application/json",
                "description": "Findings with anchors, attachments and custom values (re-importable).",  # noqa: E501
            },
        ],
        "counts": {"findings": finding_count},
    }
