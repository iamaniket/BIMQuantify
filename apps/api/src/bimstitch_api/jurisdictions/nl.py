"""Netherlands jurisdiction definition.

NL is the default jurisdiction. Adding a second country is a sibling
module that calls `register(...)` with its own Jurisdiction instance.
"""

from __future__ import annotations

from bimstitch_api.jurisdictions import Jurisdiction, register

NL = Jurisdiction(
    country="NL",
    name="Netherlands",
    default_locale="nl",
    supported_locales=("nl", "en"),
    frameworks=("bbl", "wkb"),
    postcode_pattern=r"^\d{4}\s?[A-Za-z]{2}$",
    address_id_label="BAG ID",
    notes={
        "bbl": "Bouwbesluit Leefomgeving (Dutch building decree)",
        "wkb": "Wet kwaliteitsborging voor het bouwen",
    },
)

register(NL)
