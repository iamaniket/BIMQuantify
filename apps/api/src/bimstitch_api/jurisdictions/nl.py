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
    building_type_labels={
        "dwelling": "Woning",
        "commercial": "Bedrijfspand",
        "other": "Anders",
    },
    consequence_class_labels={
        "cc1": "Gevolgklasse 1 (GK1)",
        "cc2": "Gevolgklasse 2 (GK2)",
        "cc3": "Gevolgklasse 3 (GK3)",
    },
    # NL Wkb today: only Gk1 is in scope. GK2/GK3 are roadmap.
    allowed_consequence_classes=("cc1",),
)

register(NL)
