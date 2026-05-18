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

from bimstitch_api.jurisdictions import (
    BorgingsmomentTemplate,
    ChecklistItemTemplate,
    Instrument,
    Jurisdiction,
    RiskTemplate,
    register,
)

# Bbl seed risks for a Gk1 (woning) project. Hand-curated; update on Bbl
# revisions. Last reviewed 2026-05-18 against Bbl 2024 consolidated text.
NL_BBL_RISK_TEMPLATES: dict[str, tuple[RiskTemplate, ...]] = {
    "structural_safety": (
        RiskTemplate(
            code="fundering-bodemgesteldheid",
            title="Funderingsontwerp t.o.v. bodemgesteldheid",
            description=(
                "Controle of het funderingsontwerp overeenkomt met het "
                "actuele sonderingsrapport en de draagkracht van de bodem."
            ),
            default_bbl_article="4.13",
        ),
        RiskTemplate(
            code="constructie-belastingen",
            title="Belastingcombinaties en -afdracht hoofdconstructie",
            description=(
                "Verifiëren dat de berekende belastingcombinaties en "
                "krachtsafdracht voldoen aan NEN-EN 1990/1991."
            ),
            default_bbl_article="4.12",
        ),
        RiskTemplate(
            code="staal-aansluitingen",
            title="Detaillering staal/houtaansluitingen",
            description=(
                "Knooppuntdetails moeten reproduceerbaar zijn op tekening "
                "en aansluiten op de uitgangspunten van de berekening."
            ),
            default_bbl_article="4.14",
        ),
    ),
    "fire_safety": (
        RiskTemplate(
            code="compartimentering-woningen",
            title="Compartimentering tussen woningen",
            description=(
                "Brand- en rookcompartimenten tussen aangrenzende woningen "
                "moeten 60 minuten WBDBO halen (Gk1 standaard)."
            ),
            default_bbl_article="4.51",
        ),
        RiskTemplate(
            code="rookwerendheid-trappenhuis",
            title="Rookwerendheid trappenhuis / vluchtroute",
            description=(
                "Vluchtroute via gemeenschappelijke trap moet voldoende "
                "rookwerend zijn (Ra 30) en vrij van brandbare obstakels."
            ),
            default_bbl_article="4.55",
        ),
        RiskTemplate(
            code="brandbare-gevelmaterialen",
            title="Brandklasse gevelmaterialen",
            description=(
                "Toegepaste gevelbekleding voldoet aan de gevraagde "
                "brandklasse; let op bij EPS/HSB-constructies."
            ),
            default_bbl_article="4.69",
        ),
        RiskTemplate(
            code="rookmelders",
            title="Plaatsing rookmelders",
            description=(
                "Gekoppelde rookmelders op iedere bouwlaag met "
                "verblijfsruimte, conform NEN 2555."
            ),
            default_bbl_article="6.21",
        ),
    ),
    "health": (
        RiskTemplate(
            code="ventilatie-verblijfsruimten",
            title="Capaciteit ventilatie verblijfsruimten",
            description=(
                "Toevoer/afvoer voldoet aan de minimumcapaciteit per "
                "verblijfsruimte en is meetbaar bij oplevering."
            ),
            default_bbl_article="4.124",
        ),
        RiskTemplate(
            code="vocht-koudebruggen",
            title="Vochtwering en koudebruggen",
            description=(
                "Detaillering aansluitingen kozijn/gevel/dak moet "
                "lineaire-warmtebrug en condensvorming voorkomen."
            ),
            default_bbl_article="4.103",
        ),
        RiskTemplate(
            code="daglicht-verblijfsruimten",
            title="Daglichttoetreding verblijfsruimten",
            description=(
                "Equivalente daglichtoppervlakte per verblijfsruimte "
                "moet aantoonbaar zijn berekend en gerealiseerd."
            ),
            default_bbl_article="4.117",
        ),
    ),
    "energy_efficiency": (
        RiskTemplate(
            code="bens-eis",
            title="BENG-eisen (energieprestatie)",
            description=(
                "Aantoonbaar voldoen aan BENG 1/2/3 conform de "
                "energieprestatieberekening (EP-W of EP-G)."
            ),
            default_bbl_article="4.149",
        ),
        RiskTemplate(
            code="luchtdichtheid",
            title="Luchtdichtheid gebouwschil",
            description=(
                "Blower-door-meting bij ruwbouw-gereed; qv;10 ≤ "
                "uitgangspunt in de EP-berekening."
            ),
            default_bbl_article="4.150",
        ),
        RiskTemplate(
            code="installaties-aansluiting",
            title="Aansluiting hoofd-installaties (warmtepomp/WTW)",
            description=(
                "Plaatsing en aansluiting van warmtepomp + WTW conform "
                "fabrikantvoorschriften; geluidsnorm tot omgeving."
            ),
            default_bbl_article="4.152",
        ),
    ),
    "usability": (
        RiskTemplate(
            code="vrije-doorgang-deuren",
            title="Vrije doorgang deuren en gangen",
            description=(
                "Vrije doorgang bij toegangsdeur en verkeersroute "
                "voldoet aan de minimummaten (woning Gk1)."
            ),
            default_bbl_article="4.165",
        ),
        RiskTemplate(
            code="toilet-badruimte",
            title="Afmetingen toilet- en badruimte",
            description=(
                "Minimaal vereiste vloer- en draaicirkelafmetingen "
                "voor toilet en badruimte."
            ),
            default_bbl_article="4.169",
        ),
        RiskTemplate(
            code="bereikbaarheid-meterkast",
            title="Bereikbaarheid meterkast/installaties",
            description=(
                "Meterkast en aansluitvoorzieningen bereikbaar voor "
                "bewoner en monteur zonder gereedschap."
            ),
            default_bbl_article="4.172",
        ),
    ),
}

# TloKB register snapshot (last reviewed 2026-05-18). Each id is a stable
# slug used as Project.instrument_id; renaming an id is a breaking change
# for existing rows and requires a data migration.
# Bbl phase labels for a Gk1 woning project. The neutral codes
# (foundation/shell/roof/finishing/handover/other) live on Borgingsmoment.phase;
# Dutch labels rendered through GET /jurisdictions.
NL_PHASE_LABELS: dict[str, str] = {
    "foundation": "Fundering",
    "shell": "Ruwbouw",
    "roof": "Dak",
    "finishing": "Afbouw",
    "handover": "Oplevering",
    "other": "Overig",
}


# Gk1 baseline borgingsmoment templates. Eight moments across five active
# phases; `other` reserved for user-added ad-hoc moments. Offsets are days
# from Project.planned_start_date.
NL_BORGINGSMOMENT_TEMPLATES: tuple[BorgingsmomentTemplate, ...] = (
    BorgingsmomentTemplate(
        code="funderingsinspectie",
        name="Funderingsinspectie",
        phase="foundation",
        default_offset_days=0,
        checklist=(
            ChecklistItemTemplate(
                code="sondering-vs-ontwerp",
                description="Sonderingsrapport komt overeen met funderingsontwerp",
                evidence_type="document",
                bbl_article_ref="4.13",
                pass_fail_criteria="Sonderingen op alle posities aanwezig; draagkracht ≥ ontwerpwaarde",
            ),
            ChecklistItemTemplate(
                code="wapeningsplan",
                description="Wapeningsplan fundering controleren tegen tekening",
                evidence_type="document",
                bbl_article_ref="4.12",
                pass_fail_criteria="Diameters, hartafstanden en overlappen conform constructeur",
            ),
            ChecklistItemTemplate(
                code="betonkwaliteit-cert",
                description="Certificaat betonleverantie (sterkteklasse + milieuklasse)",
                evidence_type="certificate",
                bbl_article_ref="4.14",
            ),
            ChecklistItemTemplate(
                code="peilmaten",
                description="Peilmaten fundering ingemeten",
                evidence_type="measurement",
                pass_fail_criteria="Afwijking ≤ 10 mm t.o.v. peil",
            ),
        ),
    ),
    BorgingsmomentTemplate(
        code="wapeningsinspectie-hoofdconstructie",
        name="Wapeningsinspectie hoofdconstructie",
        phase="shell",
        default_offset_days=14,
        checklist=(
            ChecklistItemTemplate(
                code="wapening-vloer",
                description="Wapening begane-grondvloer (diameter + hartafstanden)",
                evidence_type="photo",
                bbl_article_ref="4.12",
            ),
            ChecklistItemTemplate(
                code="wapening-wanden",
                description="Wapening dragende wanden",
                evidence_type="photo",
                bbl_article_ref="4.12",
            ),
            ChecklistItemTemplate(
                code="dekking",
                description="Betondekking gemeten (minimaal 25 mm)",
                evidence_type="measurement",
                pass_fail_criteria="Dekking ≥ 25 mm op alle steekproeven",
            ),
            ChecklistItemTemplate(
                code="aansluitingen",
                description="Knooppuntdetails wapening conform berekening",
                evidence_type="photo",
                bbl_article_ref="4.14",
            ),
            ChecklistItemTemplate(
                code="betoncert-constructie",
                description="Certificaat constructiebeton",
                evidence_type="certificate",
                bbl_article_ref="4.14",
            ),
        ),
    ),
    BorgingsmomentTemplate(
        code="compartimentering-ruwbouw",
        name="Compartimentering ruwbouw",
        phase="shell",
        default_offset_days=28,
        checklist=(
            ChecklistItemTemplate(
                code="wbdbo-woningscheidend",
                description="Woningscheidende wanden voldoen aan WBDBO 60 min",
                evidence_type="document",
                bbl_article_ref="4.51",
                pass_fail_criteria="WBDBO-rapportage / certificaat aanwezig",
            ),
            ChecklistItemTemplate(
                code="doorvoeringen-leidingen",
                description="Doorvoeringen door brandwerende wanden afgedicht",
                evidence_type="photo",
                bbl_article_ref="4.51",
            ),
            ChecklistItemTemplate(
                code="trappenhuis-ra30",
                description="Trappenhuis rookwerend (Ra 30) afgedicht",
                evidence_type="photo",
                bbl_article_ref="4.55",
            ),
            ChecklistItemTemplate(
                code="brandklasse-isolatie",
                description="Brandklasse isolatiemateriaal conform bestek",
                evidence_type="certificate",
                bbl_article_ref="4.69",
            ),
            ChecklistItemTemplate(
                code="luchtdichtheid-voorlopig",
                description="Voorlopige luchtdichtheid (kierdichting controle)",
                evidence_type="photo",
                bbl_article_ref="4.150",
            ),
        ),
    ),
    BorgingsmomentTemplate(
        code="dakopbouw-folie",
        name="Dakopbouw + dampopen folie",
        phase="roof",
        default_offset_days=56,
        checklist=(
            ChecklistItemTemplate(
                code="dakisolatie-rc",
                description="Dakisolatie Rc-waarde conform berekening",
                evidence_type="certificate",
                bbl_article_ref="4.149",
            ),
            ChecklistItemTemplate(
                code="dampopen-folie",
                description="Dampopen folie correct overlapt en aangesloten",
                evidence_type="photo",
                bbl_article_ref="4.103",
            ),
            ChecklistItemTemplate(
                code="hemelwater-afvoer",
                description="Hemelwaterafvoer aangesloten + gecontroleerd op verstopping",
                evidence_type="photo",
                bbl_article_ref="4.108",
            ),
            ChecklistItemTemplate(
                code="dakrand-detail",
                description="Detaillering dakrand brandwerend + waterkerend",
                evidence_type="photo",
                bbl_article_ref="4.69",
            ),
        ),
    ),
    BorgingsmomentTemplate(
        code="brandklasse-gevel-binnen",
        name="Brandklasse gevel + binnenafwerking",
        phase="finishing",
        default_offset_days=84,
        checklist=(
            ChecklistItemTemplate(
                code="gevelbekleding-brandklasse",
                description="Gevelbekleding voldoet aan brandklasse B-s1,d0",
                evidence_type="certificate",
                bbl_article_ref="4.69",
            ),
            ChecklistItemTemplate(
                code="binnenwand-brandklasse",
                description="Wandafwerking verkeersroute / vluchtroute klasse B",
                evidence_type="certificate",
                bbl_article_ref="4.71",
            ),
            ChecklistItemTemplate(
                code="vloerafwerking-brandklasse",
                description="Vloerbedekking vluchtroute klasse Cfl-s1",
                evidence_type="certificate",
                bbl_article_ref="4.71",
            ),
            ChecklistItemTemplate(
                code="brandwerende-deuren",
                description="Brandwerende deuren correct gehangen, sluitnaden",
                evidence_type="photo",
                bbl_article_ref="4.51",
            ),
            ChecklistItemTemplate(
                code="kierdichting-deuren",
                description="Kier- en valdorpels gemonteerd",
                evidence_type="photo",
                bbl_article_ref="4.55",
            ),
        ),
    ),
    BorgingsmomentTemplate(
        code="installaties-warmtepomp-wtw",
        name="Installatie warmtepomp + WTW",
        phase="finishing",
        default_offset_days=98,
        checklist=(
            ChecklistItemTemplate(
                code="warmtepomp-plaatsing",
                description="Warmtepomp geplaatst conform fabrikant",
                evidence_type="photo",
                bbl_article_ref="4.152",
            ),
            ChecklistItemTemplate(
                code="geluidsmeting-buitenunit",
                description="Geluidsmeting buitenunit ≤ 40 dB(A) op erfgrens",
                evidence_type="measurement",
                bbl_article_ref="4.115",
                pass_fail_criteria="Geluidniveau ≤ 40 dB(A) op grens perceel",
            ),
            ChecklistItemTemplate(
                code="wtw-balans",
                description="WTW in balans (toevoer ≈ afvoer per ruimte)",
                evidence_type="measurement",
                bbl_article_ref="4.124",
            ),
            ChecklistItemTemplate(
                code="installatie-cert",
                description="Certificaat installateur + opleveringsrapport",
                evidence_type="certificate",
            ),
        ),
    ),
    BorgingsmomentTemplate(
        code="luchtdichtheidsmeting",
        name="Luchtdichtheidsmeting (blower-door)",
        phase="finishing",
        default_offset_days=112,
        checklist=(
            ChecklistItemTemplate(
                code="blowerdoor-uitgevoerd",
                description="Blower-door-meting uitgevoerd",
                evidence_type="measurement",
                bbl_article_ref="4.150",
                pass_fail_criteria="qv;10 ≤ EP-berekening uitgangspunt",
            ),
            ChecklistItemTemplate(
                code="meetrapport",
                description="Meetrapport ondertekend door gecertificeerd meter",
                evidence_type="document",
                bbl_article_ref="4.150",
            ),
            ChecklistItemTemplate(
                code="lekkages-hersteld",
                description="Aantoonbaar herstel gevonden lekken",
                evidence_type="photo",
            ),
        ),
    ),
    BorgingsmomentTemplate(
        code="eindopname-dossier",
        name="Eindopname + dossier",
        phase="handover",
        default_offset_days=140,
        checklist=(
            ChecklistItemTemplate(
                code="visuele-eindopname",
                description="Visuele eindopname woning compleet",
                evidence_type="photo",
            ),
            ChecklistItemTemplate(
                code="ventilatie-meetrapport",
                description="Meetrapport ventilatiecapaciteit per verblijfsruimte",
                evidence_type="measurement",
                bbl_article_ref="4.124",
            ),
            ChecklistItemTemplate(
                code="ep-berekening",
                description="Definitieve EP-berekening (BENG 1/2/3)",
                evidence_type="document",
                bbl_article_ref="4.149",
            ),
            ChecklistItemTemplate(
                code="rookmelders-geplaatst",
                description="Rookmelders gekoppeld + getest",
                evidence_type="photo",
                bbl_article_ref="6.21",
            ),
            ChecklistItemTemplate(
                code="opleverdossier",
                description="Opleverdossier compleet (tekeningen, certificaten, garanties)",
                evidence_type="document",
            ),
            ChecklistItemTemplate(
                code="verklaring-kb",
                description="Verklaring kwaliteitsborger ondertekend",
                evidence_type="signature",
            ),
        ),
    ),
)


# Maps RiskCategory → phases whose moments receive an extra "Beheersmaatregel"
# checklist item per project risk in that category.
NL_RISK_CATEGORY_TO_PHASES: dict[str, tuple[str, ...]] = {
    "structural_safety": ("foundation", "shell"),
    "fire_safety": ("shell", "roof", "finishing"),
    "health": ("finishing", "handover"),
    "energy_efficiency": ("finishing",),
    "usability": ("handover",),
}


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
    bbl_risk_category_labels={
        "structural_safety": "Constructieve veiligheid",
        "fire_safety": "Brandveiligheid",
        "health": "Gezondheid",
        "energy_efficiency": "Energiezuinigheid",
        "usability": "Bruikbaarheid",
    },
    risk_templates=NL_BBL_RISK_TEMPLATES,
    borgingsmoment_phase_labels=NL_PHASE_LABELS,
    borgingsmoment_templates=NL_BORGINGSMOMENT_TEMPLATES,
    risk_category_to_phases=NL_RISK_CATEGORY_TO_PHASES,
)

register(NL)
