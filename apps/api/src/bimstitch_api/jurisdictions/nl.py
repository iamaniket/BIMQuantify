"""Netherlands jurisdiction definition.

NL is the default jurisdiction. Adding a second country is a sibling
module that calls `register(...)` with its own Jurisdiction instance.

Every user-facing string is a LocaleMap (`{"nl": "...", "en": "..."}`)
so the portal can render Dutch or English without a translation round
trip. The English copy here is professional construction-industry
translation of the Dutch source — keep both sides in sync when editing.

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
    DeadlineRule,
    DossierRequirementTemplate,
    Instrument,
    Jurisdiction,
    LocaleMap,
    RiskTemplate,
    register,
)

# Wkb notification deadlines. Three formal meldingen required per project.
# Construction notification (bouwmelding): 4 weeks (28 calendar days) before
#     planned start.
# Information obligation (informatieplicht): 2 working days before planned
#     start.
# Completion notification (gereedmelding): 10 working days after delivery.
#
# `deadline_type` keys are English for EU-wide scope. Dutch display names
# live in the `label` LocaleMap.
NL_DEADLINE_RULES: tuple[DeadlineRule, ...] = (
    DeadlineRule(
        deadline_type="construction_notification",
        label={"nl": "Bouwmelding", "en": "Construction notification"},
        source_field="planned_start_date",
        offset_days=28,
        use_working_days=False,
        direction="before",
        legal_reference="Wkb art. 2.21",
    ),
    DeadlineRule(
        deadline_type="information_obligation",
        label={"nl": "Informatieplicht", "en": "Information obligation"},
        source_field="planned_start_date",
        offset_days=2,
        use_working_days=True,
        direction="before",
        legal_reference="Wkb art. 2.21",
        default_reminder_days=(3, 1),
    ),
    DeadlineRule(
        deadline_type="completion_notification",
        label={"nl": "Gereedmelding", "en": "Completion notification"},
        source_field="delivery_date",
        offset_days=10,
        use_working_days=True,
        direction="after",
        legal_reference="Wkb art. 2.21",
    ),
)

# Bbl seed risks for a Gk1 (woning) project. Hand-curated; update on Bbl
# revisions. Last reviewed 2026-05-18 against Bbl 2024 consolidated text.
NL_BBL_RISK_TEMPLATES: dict[str, tuple[RiskTemplate, ...]] = {
    "structural_safety": (
        RiskTemplate(
            code="fundering-bodemgesteldheid",
            title={
                "nl": "Funderingsontwerp t.o.v. bodemgesteldheid",
                "en": "Foundation design vs. soil conditions",
            },
            description={
                "nl": (
                    "Controle of het funderingsontwerp overeenkomt met het "
                    "actuele sonderingsrapport en de draagkracht van de bodem."
                ),
                "en": (
                    "Verify the foundation design matches the current CPT "
                    "(sondering) report and the soil bearing capacity."
                ),
            },
            default_bbl_article="4.13",
        ),
        RiskTemplate(
            code="constructie-belastingen",
            title={
                "nl": "Belastingcombinaties en -afdracht hoofdconstructie",
                "en": "Load combinations and load paths in the main structure",
            },
            description={
                "nl": (
                    "Verifiëren dat de berekende belastingcombinaties en "
                    "krachtsafdracht voldoen aan NEN-EN 1990/1991."
                ),
                "en": (
                    "Verify that the calculated load combinations and force "
                    "transfer comply with NEN-EN 1990/1991."
                ),
            },
            default_bbl_article="4.12",
        ),
        RiskTemplate(
            code="staal-aansluitingen",
            title={
                "nl": "Detaillering staal/houtaansluitingen",
                "en": "Detailing of steel/timber connections",
            },
            description={
                "nl": (
                    "Knooppuntdetails moeten reproduceerbaar zijn op tekening "
                    "en aansluiten op de uitgangspunten van de berekening."
                ),
                "en": (
                    "Joint details must be reproducible from the drawings "
                    "and consistent with the calculation assumptions."
                ),
            },
            default_bbl_article="4.14",
        ),
    ),
    "fire_safety": (
        RiskTemplate(
            code="compartimentering-woningen",
            title={
                "nl": "Compartimentering tussen woningen",
                "en": "Compartmentation between dwellings",
            },
            description={
                "nl": (
                    "Brand- en rookcompartimenten tussen aangrenzende woningen "
                    "moeten 60 minuten WBDBO halen (Gk1 standaard)."
                ),
                "en": (
                    "Fire and smoke compartments between adjoining dwellings "
                    "must achieve 60-minute WBDBO (Gk1 baseline)."
                ),
            },
            default_bbl_article="4.51",
        ),
        RiskTemplate(
            code="rookwerendheid-trappenhuis",
            title={
                "nl": "Rookwerendheid trappenhuis / vluchtroute",
                "en": "Smoke resistance of stairwell / escape route",
            },
            description={
                "nl": (
                    "Vluchtroute via gemeenschappelijke trap moet voldoende "
                    "rookwerend zijn (Ra 30) en vrij van brandbare obstakels."
                ),
                "en": (
                    "Escape route via the shared stair must be sufficiently "
                    "smoke-tight (Ra 30) and free of combustible obstacles."
                ),
            },
            default_bbl_article="4.55",
        ),
        RiskTemplate(
            code="brandbare-gevelmaterialen",
            title={
                "nl": "Brandklasse gevelmaterialen",
                "en": "Fire class of facade materials",
            },
            description={
                "nl": (
                    "Toegepaste gevelbekleding voldoet aan de gevraagde "
                    "brandklasse; let op bij EPS/HSB-constructies."
                ),
                "en": (
                    "Installed facade cladding meets the required fire class; "
                    "pay attention to EPS / timber-frame assemblies."
                ),
            },
            default_bbl_article="4.69",
        ),
        RiskTemplate(
            code="rookmelders",
            title={
                "nl": "Plaatsing rookmelders",
                "en": "Smoke detector placement",
            },
            description={
                "nl": (
                    "Gekoppelde rookmelders op iedere bouwlaag met "
                    "verblijfsruimte, conform NEN 2555."
                ),
                "en": (
                    "Interconnected smoke detectors on every storey with a "
                    "habitable space, per NEN 2555."
                ),
            },
            default_bbl_article="6.21",
        ),
    ),
    "health": (
        RiskTemplate(
            code="ventilatie-verblijfsruimten",
            title={
                "nl": "Capaciteit ventilatie verblijfsruimten",
                "en": "Ventilation capacity of habitable rooms",
            },
            description={
                "nl": (
                    "Toevoer/afvoer voldoet aan de minimumcapaciteit per "
                    "verblijfsruimte en is meetbaar bij oplevering."
                ),
                "en": (
                    "Supply/exhaust meets the minimum capacity per habitable "
                    "room and is measurable at handover."
                ),
            },
            default_bbl_article="4.124",
        ),
        RiskTemplate(
            code="vocht-koudebruggen",
            title={
                "nl": "Vochtwering en koudebruggen",
                "en": "Moisture barrier and thermal bridges",
            },
            description={
                "nl": (
                    "Detaillering aansluitingen kozijn/gevel/dak moet "
                    "lineaire-warmtebrug en condensvorming voorkomen."
                ),
                "en": (
                    "Window-frame / facade / roof junction detailing must "
                    "prevent linear thermal bridges and condensation."
                ),
            },
            default_bbl_article="4.103",
        ),
        RiskTemplate(
            code="daglicht-verblijfsruimten",
            title={
                "nl": "Daglichttoetreding verblijfsruimten",
                "en": "Daylight admission for habitable rooms",
            },
            description={
                "nl": (
                    "Equivalente daglichtoppervlakte per verblijfsruimte "
                    "moet aantoonbaar zijn berekend en gerealiseerd."
                ),
                "en": (
                    "Equivalent daylight area per habitable room must be "
                    "demonstrably calculated and delivered."
                ),
            },
            default_bbl_article="4.117",
        ),
    ),
    "energy_efficiency": (
        RiskTemplate(
            code="bens-eis",
            title={
                "nl": "BENG-eisen (energieprestatie)",
                "en": "BENG requirements (energy performance)",
            },
            description={
                "nl": (
                    "Aantoonbaar voldoen aan BENG 1/2/3 conform de "
                    "energieprestatieberekening (EP-W of EP-G)."
                ),
                "en": (
                    "Demonstrable compliance with BENG 1/2/3 per the "
                    "energy-performance calculation (EP-W or EP-G)."
                ),
            },
            default_bbl_article="4.149",
        ),
        RiskTemplate(
            code="luchtdichtheid",
            title={
                "nl": "Luchtdichtheid gebouwschil",
                "en": "Air tightness of the building envelope",
            },
            description={
                "nl": (
                    "Blower-door-meting bij ruwbouw-gereed; qv;10 ≤ "
                    "uitgangspunt in de EP-berekening."
                ),
                "en": (
                    "Blower-door test at shell-complete; qv;10 ≤ the value "
                    "assumed in the EP calculation."
                ),
            },
            default_bbl_article="4.150",
        ),
        RiskTemplate(
            code="installaties-aansluiting",
            title={
                "nl": "Aansluiting hoofd-installaties (warmtepomp/WTW)",
                "en": "Main HVAC hookup (heat pump / heat-recovery unit)",
            },
            description={
                "nl": (
                    "Plaatsing en aansluiting van warmtepomp + WTW conform "
                    "fabrikantvoorschriften; geluidsnorm tot omgeving."
                ),
                "en": (
                    "Heat-pump and heat-recovery unit placement and hookup "
                    "per manufacturer; noise threshold to neighbours."
                ),
            },
            default_bbl_article="4.152",
        ),
    ),
    "usability": (
        RiskTemplate(
            code="vrije-doorgang-deuren",
            title={
                "nl": "Vrije doorgang deuren en gangen",
                "en": "Clear width of doors and corridors",
            },
            description={
                "nl": (
                    "Vrije doorgang bij toegangsdeur en verkeersroute "
                    "voldoet aan de minimummaten (woning Gk1)."
                ),
                "en": (
                    "Clear width of the entrance door and circulation route "
                    "meets the minimum dimensions (Gk1 dwelling)."
                ),
            },
            default_bbl_article="4.165",
        ),
        RiskTemplate(
            code="toilet-badruimte",
            title={
                "nl": "Afmetingen toilet- en badruimte",
                "en": "Dimensions of toilet and bathroom",
            },
            description={
                "nl": (
                    "Minimaal vereiste vloer- en draaicirkelafmetingen "
                    "voor toilet en badruimte."
                ),
                "en": (
                    "Minimum required floor area and turning-circle "
                    "dimensions for toilet and bathroom."
                ),
            },
            default_bbl_article="4.169",
        ),
        RiskTemplate(
            code="bereikbaarheid-meterkast",
            title={
                "nl": "Bereikbaarheid meterkast/installaties",
                "en": "Accessibility of meter cupboard / utilities",
            },
            description={
                "nl": (
                    "Meterkast en aansluitvoorzieningen bereikbaar voor "
                    "bewoner en monteur zonder gereedschap."
                ),
                "en": (
                    "Meter cupboard and utility connections accessible to "
                    "resident and technician without tools."
                ),
            },
            default_bbl_article="4.172",
        ),
    ),
}

# TloKB register snapshot (last reviewed 2026-05-18). Each id is a stable
# slug used as Project.instrument_id; renaming an id is a breaking change
# for existing rows and requires a data migration.
# Bbl phase labels for a Gk1 woning project. The neutral codes
# (foundation/shell/roof/finishing/handover/other) live on Borgingsmoment.phase;
# Dutch + English labels rendered through GET /jurisdictions.
NL_PHASE_LABELS: dict[str, dict[str, str]] = {
    "foundation": {"nl": "Fundering", "en": "Foundation"},
    "shell": {"nl": "Ruwbouw", "en": "Shell"},
    "roof": {"nl": "Dak", "en": "Roof"},
    "finishing": {"nl": "Afbouw", "en": "Finishing"},
    "handover": {"nl": "Oplevering", "en": "Handover"},
    "other": {"nl": "Overig", "en": "Other"},
}


# Gk1 baseline borgingsmoment templates. Eight moments across five active
# phases; `other` reserved for user-added ad-hoc moments. Offsets are days
# from Project.planned_start_date.
NL_BORGINGSMOMENT_TEMPLATES: tuple[BorgingsmomentTemplate, ...] = (
    BorgingsmomentTemplate(
        code="funderingsinspectie",
        name={"nl": "Funderingsinspectie", "en": "Foundation inspection"},
        phase="foundation",
        default_offset_days=0,
        checklist=(
            ChecklistItemTemplate(
                code="sondering-vs-ontwerp",
                description={
                    "nl": "Sonderingsrapport komt overeen met funderingsontwerp",
                    "en": "CPT (sondering) report matches the foundation design",
                },
                evidence_type="document",
                bbl_article_ref="4.13",
                pass_fail_criteria={
                    "nl": (
                        "Sonderingen op alle posities aanwezig; "
                        "draagkracht ≥ ontwerpwaarde"
                    ),
                    "en": (
                        "CPTs taken at every position; "
                        "bearing capacity ≥ design value"
                    ),
                },
            ),
            ChecklistItemTemplate(
                code="wapeningsplan",
                description={
                    "nl": "Wapeningsplan fundering controleren tegen tekening",
                    "en": "Verify foundation reinforcement plan against drawings",
                },
                evidence_type="document",
                bbl_article_ref="4.12",
                pass_fail_criteria={
                    "nl": (
                        "Diameters, hartafstanden en overlappen conform constructeur"
                    ),
                    "en": (
                        "Bar diameters, centre-to-centre spacing and laps "
                        "match the structural engineer's design"
                    ),
                },
            ),
            ChecklistItemTemplate(
                code="betonkwaliteit-cert",
                description={
                    "nl": "Certificaat betonleverantie (sterkteklasse + milieuklasse)",
                    "en": "Concrete delivery certificate (strength + exposure class)",
                },
                evidence_type="certificate",
                bbl_article_ref="4.14",
            ),
            ChecklistItemTemplate(
                code="peilmaten",
                description={
                    "nl": "Peilmaten fundering ingemeten",
                    "en": "Foundation level dimensions surveyed",
                },
                evidence_type="measurement",
                pass_fail_criteria={
                    "nl": "Afwijking ≤ 10 mm t.o.v. peil",
                    "en": "Deviation ≤ 10 mm from datum level",
                },
            ),
        ),
    ),
    BorgingsmomentTemplate(
        code="wapeningsinspectie-hoofdconstructie",
        name={
            "nl": "Wapeningsinspectie hoofdconstructie",
            "en": "Reinforcement inspection of main structure",
        },
        phase="shell",
        default_offset_days=14,
        checklist=(
            ChecklistItemTemplate(
                code="wapening-vloer",
                description={
                    "nl": "Wapening begane-grondvloer (diameter + hartafstanden)",
                    "en": "Ground-floor slab reinforcement (diameter + spacing)",
                },
                evidence_type="photo",
                bbl_article_ref="4.12",
            ),
            ChecklistItemTemplate(
                code="wapening-wanden",
                description={
                    "nl": "Wapening dragende wanden",
                    "en": "Reinforcement of load-bearing walls",
                },
                evidence_type="photo",
                bbl_article_ref="4.12",
            ),
            ChecklistItemTemplate(
                code="dekking",
                description={
                    "nl": "Betondekking gemeten (minimaal 25 mm)",
                    "en": "Concrete cover measured (minimum 25 mm)",
                },
                evidence_type="measurement",
                pass_fail_criteria={
                    "nl": "Dekking ≥ 25 mm op alle steekproeven",
                    "en": "Cover ≥ 25 mm at every sample point",
                },
            ),
            ChecklistItemTemplate(
                code="aansluitingen",
                description={
                    "nl": "Knooppuntdetails wapening conform berekening",
                    "en": "Reinforcement joint details per the calculation",
                },
                evidence_type="photo",
                bbl_article_ref="4.14",
            ),
            ChecklistItemTemplate(
                code="betoncert-constructie",
                description={
                    "nl": "Certificaat constructiebeton",
                    "en": "Structural concrete certificate",
                },
                evidence_type="certificate",
                bbl_article_ref="4.14",
            ),
        ),
    ),
    BorgingsmomentTemplate(
        code="compartimentering-ruwbouw",
        name={
            "nl": "Compartimentering ruwbouw",
            "en": "Shell-stage compartmentation",
        },
        phase="shell",
        default_offset_days=28,
        checklist=(
            ChecklistItemTemplate(
                code="wbdbo-woningscheidend",
                description={
                    "nl": "Woningscheidende wanden voldoen aan WBDBO 60 min",
                    "en": "Party walls meet 60-minute WBDBO",
                },
                evidence_type="document",
                bbl_article_ref="4.51",
                pass_fail_criteria={
                    "nl": "WBDBO-rapportage / certificaat aanwezig",
                    "en": "WBDBO report / certificate on file",
                },
            ),
            ChecklistItemTemplate(
                code="doorvoeringen-leidingen",
                description={
                    "nl": "Doorvoeringen door brandwerende wanden afgedicht",
                    "en": "Penetrations through fire walls properly sealed",
                },
                evidence_type="photo",
                bbl_article_ref="4.51",
            ),
            ChecklistItemTemplate(
                code="trappenhuis-ra30",
                description={
                    "nl": "Trappenhuis rookwerend (Ra 30) afgedicht",
                    "en": "Stairwell smoke-sealed (Ra 30)",
                },
                evidence_type="photo",
                bbl_article_ref="4.55",
            ),
            ChecklistItemTemplate(
                code="brandklasse-isolatie",
                description={
                    "nl": "Brandklasse isolatiemateriaal conform bestek",
                    "en": "Insulation fire class as specified",
                },
                evidence_type="certificate",
                bbl_article_ref="4.69",
            ),
            ChecklistItemTemplate(
                code="luchtdichtheid-voorlopig",
                description={
                    "nl": "Voorlopige luchtdichtheid (kierdichting controle)",
                    "en": "Preliminary air tightness (gap-sealing check)",
                },
                evidence_type="photo",
                bbl_article_ref="4.150",
            ),
        ),
    ),
    BorgingsmomentTemplate(
        code="dakopbouw-folie",
        name={
            "nl": "Dakopbouw + dampopen folie",
            "en": "Roof build-up + vapour-permeable membrane",
        },
        phase="roof",
        default_offset_days=56,
        checklist=(
            ChecklistItemTemplate(
                code="dakisolatie-rc",
                description={
                    "nl": "Dakisolatie Rc-waarde conform berekening",
                    "en": "Roof insulation Rc value per the calculation",
                },
                evidence_type="certificate",
                bbl_article_ref="4.149",
            ),
            ChecklistItemTemplate(
                code="dampopen-folie",
                description={
                    "nl": "Dampopen folie correct overlapt en aangesloten",
                    "en": "Vapour-permeable membrane correctly lapped and joined",
                },
                evidence_type="photo",
                bbl_article_ref="4.103",
            ),
            ChecklistItemTemplate(
                code="hemelwater-afvoer",
                description={
                    "nl": (
                        "Hemelwaterafvoer aangesloten + gecontroleerd op verstopping"
                    ),
                    "en": "Rainwater downpipes connected + checked for blockages",
                },
                evidence_type="photo",
                bbl_article_ref="4.108",
            ),
            ChecklistItemTemplate(
                code="dakrand-detail",
                description={
                    "nl": "Detaillering dakrand brandwerend + waterkerend",
                    "en": "Roof-edge detailing fire-resistant + watertight",
                },
                evidence_type="photo",
                bbl_article_ref="4.69",
            ),
        ),
    ),
    BorgingsmomentTemplate(
        code="brandklasse-gevel-binnen",
        name={
            "nl": "Brandklasse gevel + binnenafwerking",
            "en": "Facade + interior finish fire class",
        },
        phase="finishing",
        default_offset_days=84,
        checklist=(
            ChecklistItemTemplate(
                code="gevelbekleding-brandklasse",
                description={
                    "nl": "Gevelbekleding voldoet aan brandklasse B-s1,d0",
                    "en": "Facade cladding meets fire class B-s1,d0",
                },
                evidence_type="certificate",
                bbl_article_ref="4.69",
            ),
            ChecklistItemTemplate(
                code="binnenwand-brandklasse",
                description={
                    "nl": "Wandafwerking verkeersroute / vluchtroute klasse B",
                    "en": "Class-B wall finish on circulation / escape route",
                },
                evidence_type="certificate",
                bbl_article_ref="4.71",
            ),
            ChecklistItemTemplate(
                code="vloerafwerking-brandklasse",
                description={
                    "nl": "Vloerbedekking vluchtroute klasse Cfl-s1",
                    "en": "Escape-route floor covering class Cfl-s1",
                },
                evidence_type="certificate",
                bbl_article_ref="4.71",
            ),
            ChecklistItemTemplate(
                code="brandwerende-deuren",
                description={
                    "nl": "Brandwerende deuren correct gehangen, sluitnaden",
                    "en": "Fire doors correctly hung, sealing gaps verified",
                },
                evidence_type="photo",
                bbl_article_ref="4.51",
            ),
            ChecklistItemTemplate(
                code="kierdichting-deuren",
                description={
                    "nl": "Kier- en valdorpels gemonteerd",
                    "en": "Gap seals and drop-down thresholds installed",
                },
                evidence_type="photo",
                bbl_article_ref="4.55",
            ),
        ),
    ),
    BorgingsmomentTemplate(
        code="installaties-warmtepomp-wtw",
        name={
            "nl": "Installatie warmtepomp + WTW",
            "en": "Heat-pump + heat-recovery unit installation",
        },
        phase="finishing",
        default_offset_days=98,
        checklist=(
            ChecklistItemTemplate(
                code="warmtepomp-plaatsing",
                description={
                    "nl": "Warmtepomp geplaatst conform fabrikant",
                    "en": "Heat pump installed per manufacturer instructions",
                },
                evidence_type="photo",
                bbl_article_ref="4.152",
            ),
            ChecklistItemTemplate(
                code="geluidsmeting-buitenunit",
                description={
                    "nl": "Geluidsmeting buitenunit ≤ 40 dB(A) op erfgrens",
                    "en": "Outdoor-unit sound ≤ 40 dB(A) at property boundary",
                },
                evidence_type="measurement",
                bbl_article_ref="4.115",
                pass_fail_criteria={
                    "nl": "Geluidniveau ≤ 40 dB(A) op grens perceel",
                    "en": "Sound level ≤ 40 dB(A) at the plot boundary",
                },
            ),
            ChecklistItemTemplate(
                code="wtw-balans",
                description={
                    "nl": "WTW in balans (toevoer ≈ afvoer per ruimte)",
                    "en": "Heat-recovery unit balanced (supply ≈ exhaust per room)",
                },
                evidence_type="measurement",
                bbl_article_ref="4.124",
            ),
            ChecklistItemTemplate(
                code="installatie-cert",
                description={
                    "nl": "Certificaat installateur + opleveringsrapport",
                    "en": "Installer certificate + commissioning report",
                },
                evidence_type="certificate",
            ),
        ),
    ),
    BorgingsmomentTemplate(
        code="luchtdichtheidsmeting",
        name={
            "nl": "Luchtdichtheidsmeting (blower-door)",
            "en": "Air-tightness test (blower door)",
        },
        phase="finishing",
        default_offset_days=112,
        checklist=(
            ChecklistItemTemplate(
                code="blowerdoor-uitgevoerd",
                description={
                    "nl": "Blower-door-meting uitgevoerd",
                    "en": "Blower-door test performed",
                },
                evidence_type="measurement",
                bbl_article_ref="4.150",
                pass_fail_criteria={
                    "nl": "qv;10 ≤ EP-berekening uitgangspunt",
                    "en": "qv;10 ≤ the value assumed in the EP calculation",
                },
            ),
            ChecklistItemTemplate(
                code="meetrapport",
                description={
                    "nl": "Meetrapport ondertekend door gecertificeerd meter",
                    "en": "Measurement report signed by certified tester",
                },
                evidence_type="document",
                bbl_article_ref="4.150",
            ),
            ChecklistItemTemplate(
                code="lekkages-hersteld",
                description={
                    "nl": "Aantoonbaar herstel gevonden lekken",
                    "en": "Documented repair of detected air leaks",
                },
                evidence_type="photo",
            ),
        ),
    ),
    BorgingsmomentTemplate(
        code="eindopname-dossier",
        name={
            "nl": "Eindopname + dossier",
            "en": "Final inspection + dossier",
        },
        phase="handover",
        default_offset_days=140,
        checklist=(
            ChecklistItemTemplate(
                code="visuele-eindopname",
                description={
                    "nl": "Visuele eindopname woning compleet",
                    "en": "Visual final inspection of dwelling complete",
                },
                evidence_type="photo",
            ),
            ChecklistItemTemplate(
                code="ventilatie-meetrapport",
                description={
                    "nl": "Meetrapport ventilatiecapaciteit per verblijfsruimte",
                    "en": (
                        "Measurement report of ventilation capacity per "
                        "habitable room"
                    ),
                },
                evidence_type="measurement",
                bbl_article_ref="4.124",
            ),
            ChecklistItemTemplate(
                code="ep-berekening",
                description={
                    "nl": "Definitieve EP-berekening (BENG 1/2/3)",
                    "en": "Final EP calculation (BENG 1/2/3)",
                },
                evidence_type="document",
                bbl_article_ref="4.149",
            ),
            ChecklistItemTemplate(
                code="rookmelders-geplaatst",
                description={
                    "nl": "Rookmelders gekoppeld + getest",
                    "en": "Smoke detectors interconnected + tested",
                },
                evidence_type="photo",
                bbl_article_ref="6.21",
            ),
            ChecklistItemTemplate(
                code="opleverdossier",
                description={
                    "nl": (
                        "Opleverdossier compleet (tekeningen, certificaten, garanties)"
                    ),
                    "en": (
                        "Handover dossier complete "
                        "(drawings, certificates, warranties)"
                    ),
                },
                evidence_type="document",
            ),
            ChecklistItemTemplate(
                code="verklaring-kb",
                description={
                    "nl": "Verklaring kwaliteitsborger ondertekend",
                    "en": "Quality-assurance officer's declaration signed",
                },
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

# Dossier-bevoegd-gezag completeness checklist. Hand-curated for the
# aannemer-first flow; KB-layer items (borgingsplan / verklaring) are optional
# until a kwaliteitsborger joins the project. Document items map to a
# DossierSlot, certificate items to a CertificateType, progress items to a
# derived signal. Last reviewed 2026-05-31.
NL_DOSSIER_CATEGORY_LABELS: dict[str, LocaleMap] = {
    "documents": {"nl": "Documenten", "en": "Documents"},
    "installations": {"nl": "Installaties", "en": "Installations"},
    "certificates": {"nl": "Certificaten", "en": "Certificates"},
    "assurance": {"nl": "Kwaliteitsborging", "en": "Quality assurance"},
    "evidence": {"nl": "Bewijslast", "en": "Evidence"},
    "quality": {"nl": "Voortgang", "en": "Progress"},
}

_NL_DOSSIER_BASE: tuple[DossierRequirementTemplate, ...] = (
    DossierRequirementTemplate(
        code="drawings",
        category="documents",
        label={"nl": "Tekeningen", "en": "Drawings"},
        source_kind="attachment_slot",
        source_value="drawings",
    ),
    DossierRequirementTemplate(
        code="structural-calculations",
        category="documents",
        label={"nl": "Constructieberekeningen", "en": "Structural calculations"},
        source_kind="attachment_slot",
        source_value="structural_calculations",
    ),
    DossierRequirementTemplate(
        code="fire-safety-docs",
        category="documents",
        label={"nl": "Brandveiligheidsdocumenten", "en": "Fire-safety documents"},
        source_kind="attachment_slot",
        source_value="fire_safety",
    ),
    DossierRequirementTemplate(
        code="energy-performance",
        category="documents",
        label={"nl": "BENG-berekening", "en": "Energy performance (BENG)"},
        source_kind="attachment_slot",
        source_value="energy_performance",
    ),
    DossierRequirementTemplate(
        code="installation-docs",
        category="installations",
        label={"nl": "Installatiedocumenten", "en": "Installation documents"},
        source_kind="attachment_slot",
        source_value="installations",
    ),
    DossierRequirementTemplate(
        code="product-certificates",
        category="certificates",
        label={"nl": "Productcertificaten", "en": "Product certificates"},
        source_kind="certificate_type",
        source_value="product",
    ),
    DossierRequirementTemplate(
        code="inspection-certificates",
        category="certificates",
        label={"nl": "Keuringsrapporten", "en": "Test / inspection reports"},
        source_kind="certificate_type",
        source_value="installation_test",
    ),
    DossierRequirementTemplate(
        code="assurance-docs",
        category="assurance",
        label={
            "nl": "KB-documenten (borgingsplan)",
            "en": "Assurance documents (assurance plan)",
        },
        required=False,
        source_kind="attachment_slot",
        source_value="assurance",
    ),
    DossierRequirementTemplate(
        code="inspection-evidence",
        category="evidence",
        label={"nl": "Inspectie-bewijslast", "en": "Inspection evidence"},
        required=False,
        source_kind="attachment_slot",
        source_value="inspection_evidence",
    ),
    DossierRequirementTemplate(
        code="findings-resolved",
        category="quality",
        label={"nl": "Bevindingen opgelost", "en": "Findings resolved"},
        source_kind="derived",
        source_value="findings",
    ),
    DossierRequirementTemplate(
        code="deadlines-on-track",
        category="quality",
        label={"nl": "Meldingen op schema", "en": "Deadlines on track"},
        source_kind="derived",
        source_value="deadlines",
    ),
)

# Commercial projects additionally benefit from a coordinated 3D model in the
# dossier (optional). Dwelling/other reuse the base set.
NL_DOSSIER_REQUIREMENT_TEMPLATES: dict[str, tuple[DossierRequirementTemplate, ...]] = {
    "dwelling": _NL_DOSSIER_BASE,
    "commercial": _NL_DOSSIER_BASE
    + (
        DossierRequirementTemplate(
            code="model-present",
            category="quality",
            label={"nl": "3D-model aanwezig", "en": "3D model present"},
            required=False,
            source_kind="derived",
            source_value="models",
        ),
    ),
    "other": _NL_DOSSIER_BASE,
}


NL = Jurisdiction(
    country="NL",
    name="Netherlands",
    default_locale="nl",
    supported_locales=("nl", "en"),
    frameworks=("bbl", "wkb"),
    postcode_pattern=r"^\d{4}\s?[A-Za-z]{2}$",
    address_id_label="BAG ID",
    notes={
        "bbl": {
            "nl": "Besluit bouwwerken leefomgeving (Bbl)",
            "en": "Bouwbesluit Leefomgeving (Dutch building decree)",
        },
        "wkb": {
            "nl": "Wet kwaliteitsborging voor het bouwen",
            "en": "Wkb — Dutch Building Quality Assurance Act",
        },
    },
    building_type_labels={
        "dwelling": {"nl": "Woning", "en": "Dwelling"},
        "commercial": {"nl": "Bedrijfspand", "en": "Commercial building"},
        "other": {"nl": "Anders", "en": "Other"},
    },
    consequence_class_labels={
        "cc1": {
            "nl": "Gevolgklasse 1 (GK1)",
            "en": "Consequence class 1 (CC1 / Gk1)",
        },
        "cc2": {
            "nl": "Gevolgklasse 2 (GK2)",
            "en": "Consequence class 2 (CC2 / Gk2)",
        },
        "cc3": {
            "nl": "Gevolgklasse 3 (GK3)",
            "en": "Consequence class 3 (CC3 / Gk3)",
        },
    },
    status_labels={
        "planning": {"nl": "Planning", "en": "Planning"},
        "design": {"nl": "Ontwerp", "en": "Design"},
        "permit_review": {"nl": "Vergunning", "en": "Permit review"},
        "construction": {"nl": "Uitvoering", "en": "Construction"},
        "handover": {"nl": "Oplevering", "en": "Handover"},
        "complete": {"nl": "Gereed", "en": "Completed"},
        "on_hold": {"nl": "On hold", "en": "On hold"},
    },
    phase_labels={
        "design": {"nl": "Ontwerp", "en": "Design"},
        "tender": {"nl": "Bestek", "en": "Tender"},
        "work_prep": {"nl": "Werkvoorbereiding", "en": "Work preparation"},
        "shell": {"nl": "Ruwbouw", "en": "Shell"},
        "finishing": {"nl": "Afbouw", "en": "Finishing"},
        "handover": {"nl": "Oplevering", "en": "Handover"},
    },
    # NL Wkb today: only Gk1 is in scope. GK2/GK3 are roadmap.
    allowed_consequence_classes=("cc1",),
    instruments=NL_INSTRUMENTS,
    bbl_risk_category_labels={
        "structural_safety": {
            "nl": "Constructieve veiligheid",
            "en": "Structural safety",
        },
        "fire_safety": {"nl": "Brandveiligheid", "en": "Fire safety"},
        "health": {"nl": "Gezondheid", "en": "Health"},
        "energy_efficiency": {"nl": "Energiezuinigheid", "en": "Energy efficiency"},
        "usability": {"nl": "Bruikbaarheid", "en": "Usability"},
    },
    risk_templates=NL_BBL_RISK_TEMPLATES,
    borgingsmoment_phase_labels=NL_PHASE_LABELS,
    borgingsmoment_templates=NL_BORGINGSMOMENT_TEMPLATES,
    risk_category_to_phases=NL_RISK_CATEGORY_TO_PHASES,
    deadline_rules=NL_DEADLINE_RULES,
    dossier_requirement_templates=NL_DOSSIER_REQUIREMENT_TEMPLATES,
    dossier_category_labels=NL_DOSSIER_CATEGORY_LABELS,
)

register(NL)
