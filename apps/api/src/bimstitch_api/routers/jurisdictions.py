"""Public jurisdictions catalog endpoint.

Lets the portal discover what countries/frameworks are supported without
hard-coding the list client-side. Read-only, no tenancy.
"""

from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel

from bimstitch_api.jurisdictions import all_jurisdictions

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


class JurisdictionResponse(BaseModel):
    country: str
    name: str
    default_locale: str
    supported_locales: list[str]
    frameworks: list[str]
    postcode_pattern: str | None
    address_id_label: str | None
    building_type_labels: dict[str, str]
    consequence_class_labels: dict[str, str]
    allowed_consequence_classes: list[str]
    instruments: list[InstrumentResponse]
    bbl_risk_category_labels: dict[str, str]
    risk_templates: dict[str, list[RiskTemplateResponse]]
    borgingsmoment_phase_labels: dict[str, str]
    borgingsmoment_templates: list[BorgingsmomentTemplateResponse]
    risk_category_to_phases: dict[str, list[str]]


class JurisdictionListResponse(BaseModel):
    items: list[JurisdictionResponse]


@router.get("", response_model=JurisdictionListResponse)
async def list_jurisdictions() -> JurisdictionListResponse:
    items = [
        JurisdictionResponse(
            country=j.country,
            name=j.name,
            default_locale=j.default_locale,
            supported_locales=list(j.supported_locales),
            frameworks=list(j.frameworks),
            postcode_pattern=j.postcode_pattern,
            address_id_label=j.address_id_label,
            building_type_labels=dict(j.building_type_labels),
            consequence_class_labels=dict(j.consequence_class_labels),
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
            bbl_risk_category_labels=dict(j.bbl_risk_category_labels),
            risk_templates={
                category: [
                    RiskTemplateResponse(
                        code=tpl.code,
                        title=tpl.title,
                        description=tpl.description,
                        default_bbl_article=tpl.default_bbl_article,
                    )
                    for tpl in templates
                ]
                for category, templates in j.risk_templates.items()
            },
            borgingsmoment_phase_labels=dict(j.borgingsmoment_phase_labels),
            borgingsmoment_templates=[
                BorgingsmomentTemplateResponse(
                    code=mt.code,
                    name=mt.name,
                    phase=mt.phase,
                    default_offset_days=mt.default_offset_days,
                    checklist=[
                        ChecklistItemTemplateResponse(
                            code=it.code,
                            description=it.description,
                            evidence_type=it.evidence_type,
                            bbl_article_ref=it.bbl_article_ref,
                            pass_fail_criteria=it.pass_fail_criteria,
                        )
                        for it in mt.checklist
                    ],
                )
                for mt in j.borgingsmoment_templates
            ],
            risk_category_to_phases={
                category: list(phases)
                for category, phases in j.risk_category_to_phases.items()
            },
        )
        for j in all_jurisdictions()
    ]
    return JurisdictionListResponse(items=items)
