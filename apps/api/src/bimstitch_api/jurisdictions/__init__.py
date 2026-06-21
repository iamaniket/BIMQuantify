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

# Locale -> human-readable label. Every user-facing label that lives on a
# Jurisdiction is stored as a LocaleMap so the portal can render either NL
# or EN copy without hitting the server for translations. Keep at least
# {"nl": ..., "en": ...} entries; a missing locale falls back to the
# jurisdiction's default_locale via `pick_label()`.
LocaleMap = dict[str, str]


def pick_label(
    label_map: LocaleMap | None,
    locale: str,
    default_locale: str,
) -> str:
    """Pick the best label from a LocaleMap.

    Tries `locale` first, then `default_locale`, then any remaining value
    in the map. Returns an empty string if `label_map` is empty/None so
    callers don't have to guard against missing keys.
    """
    if not label_map:
        return ""
    if locale in label_map:
        return label_map[locale]
    if default_locale in label_map:
        return label_map[default_locale]
    return next(iter(label_map.values()), "")


def localize_map(
    map_of_locale_maps: dict[str, LocaleMap],
    locale: str,
    default_locale: str,
) -> dict[str, str]:
    """Flatten `dict[code, LocaleMap]` to `dict[code, str]` for one locale."""
    return {
        code: pick_label(loc_map, locale, default_locale)
        for code, loc_map in map_of_locale_maps.items()
    }


@dataclass(frozen=True)
class DeadlineRule:
    """A formal deadline rule for a jurisdiction's notification regime.

    NL: the Wkb requires three meldingen (bouwmelding, informatieplicht,
    gereedmelding) with specific lead/lag times relative to construction
    dates. Each rule computes a due_date from a project date field.

    `deadline_type` is stored as `String(50)` in the DB (not a Postgres
    ENUM) because different jurisdictions have different notification
    types — DE will have entirely different deadlines.
    """

    deadline_type: str  # stable English DB key, e.g. "construction_notification"
    label: LocaleMap  # {"nl": "Bouwmelding", "en": "Construction notification"}
    source_field: str  # "planned_start_date" | "delivery_date"
    offset_days: int  # absolute value
    use_working_days: bool  # True → skip weekends + holidays
    direction: str  # "before" | "after"
    legal_reference: str | None = None
    # Reminder tiers (days before due_date) the sweep fires at, most-distant
    # first. T-30 gives the team a month's notice on the formal meldingen;
    # the engine fires one email per tier as each threshold is crossed.
    default_reminder_days: tuple[int, ...] = (30, 14, 7, 3, 1)
    default_recipient_roles: tuple[str, ...] = ("owner", "editor", "contractor")
    required_dossier_codes: tuple[str, ...] = ()  # dossier requirement codes needed to file


def get_deadline_rules(country: str) -> tuple[DeadlineRule, ...]:
    """Return the deadline rules for a country, or empty tuple if unknown."""
    j = get(country)
    if j is None:
        return ()
    return j.deadline_rules


@dataclass(frozen=True)
class RiskTemplate:
    """A seed risk for a Bbl risk-assessment category.

    Drives the "Voeg toe uit sjabloon" pickers on the portal Risicobeoordeling
    section. The portal uses (country, category, code) to determine which
    templates have already been adopted on a given project.
    """

    code: str
    title: LocaleMap
    description: LocaleMap
    default_bbl_article: str | None = None


@dataclass(frozen=True)
class ChecklistItemTemplate:
    """A seed checklist item for a Borgingsmoment template.

    Drives the items that pre-populate a generated borgingsplan. `code` is a
    stable slug per (moment, country) so re-generation can keep user-added
    items distinct from template-derived ones in the future.
    """

    code: str
    description: LocaleMap
    evidence_type: str  # one of EvidenceType (photo / certificate / measurement / document / signature)
    bbl_article_ref: str | None = None
    pass_fail_criteria: LocaleMap | None = None


@dataclass(frozen=True)
class BorgingsmomentTemplate:
    """A seed borgingsmoment (planned inspection event) for a phase.

    `default_offset_days` is added to Project.planned_start_date to produce
    the suggested `planned_date`; if the project has no planned start, the
    server falls back to today() + offset.
    """

    code: str
    name: LocaleMap
    phase: str  # one of BorgingsmomentPhase (foundation / shell / roof / finishing / handover / other)
    default_offset_days: int
    checklist: tuple[ChecklistItemTemplate, ...] = ()


@dataclass(frozen=True)
class DossierRequirementTemplate:
    """One required item in the "dossier bevoegd gezag" completeness checklist.

    Drives the per-building-type checklist the aannemer works through before
    gereedmelding. Each requirement is satisfied by one source:

    - ``source_kind="attachment_slot"``     → a document tagged with the
      ``DossierSlot`` named in ``source_value`` (e.g. "structural_calculations")
    - ``source_kind="certificate_type"``    → a Certificate whose
      ``certificate_type`` equals ``source_value`` (e.g. "product")
    - ``source_kind="model"``               → at least one BIM model is present
      (``source_value="models"``)
    - ``source_kind="attachment_or_model"`` → satisfied by either an attachment in
      the ``source_value`` slot (e.g. "drawings") OR a BIM model being present
    - ``source_kind="derived"``             → a computed signal in ``source_value``
      ("models" present / "findings" all resolved / "deadlines" on track)

    `category` groups rows under a section header localized via
    `Jurisdiction.dossier_category_labels`.
    """

    code: str
    category: str
    label: LocaleMap
    required: bool = True
    # "attachment_slot" | "certificate_type" | "model" | "attachment_or_model" | "derived"
    source_kind: str = "attachment_slot"
    source_value: str = ""


@dataclass(frozen=True)
class Jurisdiction:
    country: str  # ISO 3166-1 alpha-2
    name: str
    default_locale: str
    supported_locales: tuple[str, ...]
    frameworks: tuple[str, ...]  # compliance regulation identifiers
    postcode_pattern: str | None = None
    address_id_label: str | None = None  # e.g. "BAG ID", "Kataster"
    # Per-framework descriptive note keyed by locale.
    notes: dict[str, LocaleMap] = field(default_factory=dict)
    # Localized labels for the neutral BuildingType codes stored on Project.
    # The portal pulls these via GET /jurisdictions so NL renders "Woning",
    # DE "Wohngebäude", etc. without touching schema.
    building_type_labels: dict[str, LocaleMap] = field(default_factory=dict)
    # Localized labels for the neutral ProjectPhase codes. The wizard overlays
    # these on its English fallback list.
    phase_labels: dict[str, LocaleMap] = field(default_factory=dict)
    # Localized labels for the neutral RiskCategory codes stored on Risk
    # (`structural_safety`, `fire_safety`, …). Country-specific because the
    # Bbl categories don't align 1:1 with other building-code regimes.
    bbl_risk_category_labels: dict[str, LocaleMap] = field(default_factory=dict)
    # Hand-curated seed risks per RiskCategory code. The portal renders these
    # as a "Voeg toe uit sjabloon" picker.
    risk_templates: dict[str, tuple[RiskTemplate, ...]] = field(default_factory=dict)
    # Localized labels for the neutral BorgingsmomentPhase codes stored on
    # Borgingsmoment. NL renders Fundering/Ruwbouw/Dak/Afbouw/Oplevering/Overig.
    borgingsmoment_phase_labels: dict[str, LocaleMap] = field(default_factory=dict)
    # Seed moments (ordered by (phase, default_offset_days)) used by the
    # "Genereer borgingsplan vanuit sjabloon" action. Each carries its own
    # initial checklist items.
    borgingsmoment_templates: tuple[BorgingsmomentTemplate, ...] = ()
    # Maps a RiskCategory code to the phases whose generated moments should
    # receive an extra "Beheersmaatregel" checklist item derived from each
    # project risk in that category. Lets fire_safety risks attach to shell,
    # roof and finishing inspections, etc.
    risk_category_to_phases: dict[str, tuple[str, ...]] = field(default_factory=dict)
    # Formal notification deadlines for this country's quality-assurance
    # regime. NL: Wkb meldingen (construction_notification,
    # information_obligation, completion_notification). The API computes
    # due_dates from project date fields using these rules. Adding a
    # country = register its own rules.
    deadline_rules: tuple[DeadlineRule, ...] = ()
    # Dossier-completeness checklist templates keyed by BuildingType code
    # (dwelling / commercial / other). The aannemer works through these before
    # gereedmelding; the portal computes met/missing against tagged documents,
    # certificates, and derived signals. A missing key falls back to the
    # "other" set (see `get_dossier_requirements`).
    dossier_requirement_templates: dict[str, tuple[DossierRequirementTemplate, ...]] = field(
        default_factory=dict
    )
    # Localized section headers for the `category` codes used by the dossier
    # requirement templates (e.g. "documents" → {"nl": "Documenten", ...}).
    dossier_category_labels: dict[str, LocaleMap] = field(default_factory=dict)


def get_dossier_requirements(
    country: str, building_type: str | None
) -> tuple[DossierRequirementTemplate, ...]:
    """Dossier checklist for a (country, building_type), with fallback.

    Falls back to the "other" template set when the building type is unknown,
    null, or has no dedicated template — so a project always gets a checklist.
    """
    j = get(country)
    if j is None:
        return ()
    templates = j.dossier_requirement_templates
    if building_type and building_type in templates:
        return templates[building_type]
    return templates.get("other", ())


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
