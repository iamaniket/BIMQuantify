"""Netherlands jurisdiction definition.

NL is the default jurisdiction. Adding a second country is a sibling
module that calls `register(...)` with its own Jurisdiction instance.

Maintaining the instruments list
--------------------------------
`NL_INSTRUMENTS` mirrors the TloKB register
(https://www.tlokb.nl/register) of toegelaten instrumenten. The register
changes ~twice per year as instruments are admitted or withdrawn. To
update: edit the tuple below — add/remove an `Instrument(...)` and bump
the TloKB-checked date in the comment above the list. Do NOT scrape the
register at runtime; the manual review is the point.
"""

from __future__ import annotations

from bimstitch_api.jurisdictions import Instrument, Jurisdiction, register

# TloKB register snapshot (last reviewed 2026-05-18). Each id is a stable
# slug used as Project.instrument_id; renaming an id is a breaking change
# for existing rows and requires a data migration.
NL_INSTRUMENTS: tuple[Instrument, ...] = (
    Instrument(
        id="kik",
        name="KiK",
        provider="Stichting Kwaliteitsborging in de Bouw (KiK)",
        methodology_url="https://www.tlokb.nl/register",
    ),
    Instrument(
        id="tis-kwaliteitsborger-wkb",
        name="TIS Kwaliteitsborger Wkb",
        provider="SWK (Stichting Waarborgfonds Koopwoningen)",
        methodology_url="https://www.tlokb.nl/register",
    ),
    Instrument(
        id="wki-gk1",
        name="WKI-GK1",
        provider="Stichting Wkb-instrumenten",
        methodology_url="https://www.tlokb.nl/register",
    ),
    Instrument(
        id="adp-bouwkwaliteit",
        name="ADP-Bouwkwaliteit",
        provider="ADP Bouwkwaliteit",
        methodology_url="https://www.tlokb.nl/register",
    ),
)

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
    instruments=NL_INSTRUMENTS,
)

register(NL)
