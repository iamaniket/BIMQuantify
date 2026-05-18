"""Jurisdiction registry.

A jurisdiction = ISO 3166-1 alpha-2 country code + the bundle of regulation
frameworks, default locale, and address-format expectations that apply to
projects within that country.

NL is the only registered jurisdiction today. Adding DE / BE / FR is a
matter of dropping a new module under this package and registering it with
the same `_REGISTRY` map — no schema changes required.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class Instrument:
    """A "toegelaten instrument" entry from a country's instrument register.

    NL: the TloKB register (toegelaten instrumenten Wkb). Each country maps
    a stable `id` (used as Project.instrument_id) to a human name, the
    instrumentaanbieder (provider), and a URL pointing at the official
    methodology. The list changes ~twice a year and is hand-maintained.
    """

    id: str
    name: str
    provider: str
    methodology_url: str | None = None


@dataclass(frozen=True)
class Jurisdiction:
    country: str  # ISO 3166-1 alpha-2
    name: str
    default_locale: str
    supported_locales: tuple[str, ...]
    frameworks: tuple[str, ...]  # compliance regulation identifiers
    postcode_pattern: str | None = None
    address_id_label: str | None = None  # e.g. "BAG ID", "Kataster"
    notes: dict[str, str] = field(default_factory=dict)
    # Localized labels for the neutral BuildingType / ConsequenceClass codes
    # stored on Project. The portal pulls these via GET /jurisdictions so
    # NL renders "Woning", DE "Wohngebäude", etc. without touching schema.
    building_type_labels: dict[str, str] = field(default_factory=dict)
    consequence_class_labels: dict[str, str] = field(default_factory=dict)
    # Subset of ConsequenceClass values valid for this country's current
    # framework scope. NL Wkb today only certifies Gk1 (= CC1) work;
    # the API rejects projects that try to declare CC2/CC3.
    allowed_consequence_classes: tuple[str, ...] = ("cc1", "cc2", "cc3")
    # Toegelaten instrumenten for this country's quality-assurance regime
    # (NL: TloKB register). The portal renders the dropdown from this list;
    # the API rejects Project.instrument_id values that aren't here.
    instruments: tuple[Instrument, ...] = ()


def find_instrument(country: str, instrument_id: str) -> Instrument | None:
    j = _REGISTRY.get(country.upper())
    if j is None:
        return None
    for inst in j.instruments:
        if inst.id == instrument_id:
            return inst
    return None


_REGISTRY: dict[str, Jurisdiction] = {}


def register(jurisdiction: Jurisdiction) -> None:
    _REGISTRY[jurisdiction.country.upper()] = jurisdiction


def get(country: str) -> Jurisdiction | None:
    return _REGISTRY.get(country.upper())


def require(country: str) -> Jurisdiction:
    j = get(country)
    if j is None:
        raise KeyError(f"No jurisdiction registered for country '{country}'")
    return j


def all_jurisdictions() -> list[Jurisdiction]:
    return list(_REGISTRY.values())


def supported_countries() -> set[str]:
    return set(_REGISTRY.keys())


def is_supported_framework(country: str, framework: str) -> bool:
    j = get(country)
    return j is not None and framework in j.frameworks


# Register built-ins.
from bimstitch_api.jurisdictions import nl as _nl  # noqa: E402,F401
