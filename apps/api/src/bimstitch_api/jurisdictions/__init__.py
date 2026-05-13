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
class Jurisdiction:
    country: str  # ISO 3166-1 alpha-2
    name: str
    default_locale: str
    supported_locales: tuple[str, ...]
    frameworks: tuple[str, ...]  # compliance regulation identifiers
    postcode_pattern: str | None = None
    address_id_label: str | None = None  # e.g. "BAG ID", "Kataster"
    notes: dict[str, str] = field(default_factory=dict)


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
