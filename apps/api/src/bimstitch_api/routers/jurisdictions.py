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
        )
        for j in all_jurisdictions()
    ]
    return JurisdictionListResponse(items=items)
