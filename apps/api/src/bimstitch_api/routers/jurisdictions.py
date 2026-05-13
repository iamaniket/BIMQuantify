"""Public jurisdictions catalog endpoint.

Lets the portal discover what countries/frameworks are supported without
hard-coding the list client-side. Read-only, no tenancy.
"""

from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel

from bimstitch_api.jurisdictions import all_jurisdictions

router = APIRouter(prefix="/jurisdictions", tags=["jurisdictions"])


class JurisdictionResponse(BaseModel):
    country: str
    name: str
    default_locale: str
    supported_locales: list[str]
    frameworks: list[str]
    postcode_pattern: str | None
    address_id_label: str | None


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
        )
        for j in all_jurisdictions()
    ]
    return JurisdictionListResponse(items=items)
