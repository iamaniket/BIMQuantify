"""Public jurisdictions catalog endpoint.

Lets the portal discover what countries/frameworks are supported without
hard-coding the list client-side. Read-only, no tenancy.

Each jurisdiction stores labels and template strings as LocaleMaps
(`{"nl": "...", "en": "..."}`) so the same registry serves both
languages. The endpoint flattens those maps to plain `{code: str}` for
the locale requested via `?locale=` — the wire shape stays a plain
string lookup so portal Zod schemas don't need to know about locales.
"""

from __future__ import annotations

import holidays as _holidays
from fastapi import APIRouter, Query, Response
from pydantic import BaseModel

from bimstitch_api.cache import CACHE_TTL_JURISDICTIONS, cache_response
from bimstitch_api.jurisdictions import (
    all_jurisdictions,
    localize_map,
    pick_label,
)

router = APIRouter(prefix="/jurisdictions", tags=["jurisdictions"])


class InstrumentResponse(BaseModel):
    id: str
    name: str
    provider: str
    methodology_url: str | None


class RiskTemplateResponse(BaseModel):
    code: str
    title: str
    description: str
    default_bbl_article: str | None


class ChecklistItemTemplateResponse(BaseModel):
    code: str
    description: str
    evidence_type: str
    bbl_article_ref: str | None
    pass_fail_criteria: str | None


class BorgingsmomentTemplateResponse(BaseModel):
    code: str
    name: str
    phase: str
    default_offset_days: int
    checklist: list[ChecklistItemTemplateResponse]


class DossierRequirementTemplateResponse(BaseModel):
    code: str
    category: str
    label: str
    required: bool
    source_kind: str
    source_value: str


class DeadlineRuleResponse(BaseModel):
    deadline_type: str
    label: str
    source_field: str
    offset_days: int
    use_working_days: bool
    direction: str
    legal_reference: str | None
    default_reminder_days: list[int]
    default_recipient_roles: list[str]
    required_dossier_codes: list[str]


class JurisdictionResponse(BaseModel):
    country: str
    name: str
    default_locale: str
    supported_locales: list[str]
    frameworks: list[str]
    postcode_pattern: str | None
    address_id_label: str | None
    notes: dict[str, str]
    building_type_labels: dict[str, str]
    consequence_class_labels: dict[str, str]
    status_labels: dict[str, str]
    phase_labels: dict[str, str]
    allowed_consequence_classes: list[str]
    instruments: list[InstrumentResponse]
    bbl_risk_category_labels: dict[str, str]
    risk_templates: dict[str, list[RiskTemplateResponse]]
    borgingsmoment_phase_labels: dict[str, str]
    borgingsmoment_templates: list[BorgingsmomentTemplateResponse]
    deadline_rules: list[DeadlineRuleResponse]
    risk_category_to_phases: dict[str, list[str]]
    dossier_requirement_templates: dict[str, list[DossierRequirementTemplateResponse]]
    dossier_category_labels: dict[str, str]


class JurisdictionListResponse(BaseModel):
    items: list[JurisdictionResponse]


@router.get("", response_model=JurisdictionListResponse)
async def list_jurisdictions(
    response: Response,
    locale: str = Query(
        "nl",
        description=(
            "Locale tag for label/template strings. Falls back to the "
            "jurisdiction's default_locale when the requested locale has "
            "no value for a given key."
        ),
        max_length=10,
    ),
) -> JurisdictionListResponse:
    cache_response(response, CACHE_TTL_JURISDICTIONS, is_public=True)
    items: list[JurisdictionResponse] = []
    for j in all_jurisdictions():
        default = j.default_locale
        items.append(
            JurisdictionResponse(
                country=j.country,
                name=j.name,
                default_locale=j.default_locale,
                supported_locales=list(j.supported_locales),
                frameworks=list(j.frameworks),
                postcode_pattern=j.postcode_pattern,
                address_id_label=j.address_id_label,
                notes=localize_map(j.notes, locale, default),
                building_type_labels=localize_map(
                    j.building_type_labels, locale, default
                ),
                consequence_class_labels=localize_map(
                    j.consequence_class_labels, locale, default
                ),
                status_labels=localize_map(j.status_labels, locale, default),
                phase_labels=localize_map(j.phase_labels, locale, default),
                allowed_consequence_classes=list(j.allowed_consequence_classes),
                instruments=[
                    InstrumentResponse(
                        id=inst.id,
                        name=inst.name,
                        provider=inst.provider,
                        methodology_url=inst.methodology_url,
                    )
                    for inst in j.instruments
                ],
                bbl_risk_category_labels=localize_map(
                    j.bbl_risk_category_labels, locale, default
                ),
                risk_templates={
                    category: [
                        RiskTemplateResponse(
                            code=tpl.code,
                            title=pick_label(tpl.title, locale, default),
                            description=pick_label(tpl.description, locale, default),
                            default_bbl_article=tpl.default_bbl_article,
                        )
                        for tpl in templates
                    ]
                    for category, templates in j.risk_templates.items()
                },
                borgingsmoment_phase_labels=localize_map(
                    j.borgingsmoment_phase_labels, locale, default
                ),
                borgingsmoment_templates=[
                    BorgingsmomentTemplateResponse(
                        code=mt.code,
                        name=pick_label(mt.name, locale, default),
                        phase=mt.phase,
                        default_offset_days=mt.default_offset_days,
                        checklist=[
                            ChecklistItemTemplateResponse(
                                code=it.code,
                                description=pick_label(
                                    it.description, locale, default
                                ),
                                evidence_type=it.evidence_type,
                                bbl_article_ref=it.bbl_article_ref,
                                pass_fail_criteria=(
                                    pick_label(
                                        it.pass_fail_criteria, locale, default
                                    )
                                    if it.pass_fail_criteria is not None
                                    else None
                                ),
                            )
                            for it in mt.checklist
                        ],
                    )
                    for mt in j.borgingsmoment_templates
                ],
                deadline_rules=[
                    DeadlineRuleResponse(
                        deadline_type=r.deadline_type,
                        label=pick_label(r.label, locale, default),
                        source_field=r.source_field,
                        offset_days=r.offset_days,
                        use_working_days=r.use_working_days,
                        direction=r.direction,
                        legal_reference=r.legal_reference,
                        default_reminder_days=list(r.default_reminder_days),
                        default_recipient_roles=list(r.default_recipient_roles),
                        required_dossier_codes=list(r.required_dossier_codes),
                    )
                    for r in j.deadline_rules
                ],
                risk_category_to_phases={
                    category: list(phases)
                    for category, phases in j.risk_category_to_phases.items()
                },
                dossier_requirement_templates={
                    building_type: [
                        DossierRequirementTemplateResponse(
                            code=req.code,
                            category=req.category,
                            label=pick_label(req.label, locale, default),
                            required=req.required,
                            source_kind=req.source_kind,
                            source_value=req.source_value,
                        )
                        for req in requirements
                    ]
                    for building_type, requirements in j.dossier_requirement_templates.items()
                },
                dossier_category_labels=localize_map(
                    j.dossier_category_labels, locale, default
                ),
            )
        )
    return JurisdictionListResponse(items=items)


# ---------------------------------------------------------------------------
# Public holidays
#
# Reuses the same `holidays` library the deadline working-day engine uses
# (`deadlines/working_days.py`), so the calendar's holiday markers can never
# drift from the dates that actually shift deadlines. Pass-through to the
# library means every country it implements works for free — a country it
# doesn't implement returns an empty list rather than erroring.
# ---------------------------------------------------------------------------


class HolidayResponse(BaseModel):
    # ISO `YYYY-MM-DD`. A plain string (not `datetime.date`) keeps the wire
    # shape a simple string the portal Zod schema reads directly, and avoids a
    # type-only datetime import.
    date: str
    name: str


class HolidayListResponse(BaseModel):
    items: list[HolidayResponse]


def _resolve_holiday_language(locale: str, supported: tuple[str, ...]) -> str | None:
    """Map a portal locale (`en`, `nl`, …) onto a language the holidays library
    ships for this country. Falls back to the country's default (``None``) when
    there's no match, so an unsupported locale degrades to default-language
    names rather than 500-ing."""
    if not supported:
        return None
    if locale in supported:
        return locale
    base = locale.split("_")[0].split("-")[0].lower()
    for lang in supported:
        if lang.split("_")[0].lower() == base:
            return lang
    return None


@router.get("/{country}/holidays", response_model=HolidayListResponse)
async def list_holidays(
    response: Response,
    country: str,
    year: int = Query(..., ge=1900, le=2200, description="Calendar year."),
    locale: str = Query(
        "nl",
        max_length=10,
        description=(
            "Locale tag for holiday names. Falls back to the country's default "
            "language when the requested locale isn't supported."
        ),
    ),
) -> HolidayListResponse:
    cache_response(response, CACHE_TTL_JURISDICTIONS, is_public=True)
    code = country.upper()
    try:
        probe = _holidays.country_holidays(code, years=year)
    except (NotImplementedError, KeyError):
        # Country not implemented by the library → no markers, not an error.
        return HolidayListResponse(items=[])

    supported = tuple(getattr(probe, "supported_languages", ()) or ())
    language = _resolve_holiday_language(locale, supported)
    calendar = (
        _holidays.country_holidays(code, years=year, language=language)
        if language is not None
        else probe
    )
    items = [
        HolidayResponse(date=day.isoformat(), name=name)
        for day, name in sorted(calendar.items())
    ]
    return HolidayListResponse(items=items)
