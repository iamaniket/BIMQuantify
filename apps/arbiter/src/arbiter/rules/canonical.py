"""Canonical building element taxonomy and property namespace.

This module is the single source of truth for mapping format-specific
types and properties into format-neutral canonical names.  Rules and the
engine operate exclusively on canonical names; each file-format extractor
maps its native concepts here.

Adding a new file format (e.g. Revit, Navisworks) requires only adding a
new ``*_TO_CANONICAL`` mapping dict — rules and the engine stay unchanged.
"""

from __future__ import annotations

from enum import StrEnum


# ---------------------------------------------------------------------------
# Canonical element types
# ---------------------------------------------------------------------------

class ElementType(StrEnum):
    wall = "wall"
    slab = "slab"
    door = "door"
    window = "window"
    space = "space"
    column = "column"
    beam = "beam"
    stair = "stair"
    stair_flight = "stair_flight"
    ramp_flight = "ramp_flight"
    railing = "railing"
    roof = "roof"
    covering = "covering"
    curtain_wall = "curtain_wall"
    plate = "plate"
    member = "member"
    transport_element = "transport_element"


# ---------------------------------------------------------------------------
# Source format richness ordering
# ---------------------------------------------------------------------------

class SourceFormat(StrEnum):
    ifc = "ifc"
    dwg = "dwg"
    dxf = "dxf"
    pdf = "pdf"


FORMAT_RICHNESS: dict[SourceFormat, int] = {
    SourceFormat.pdf: 0,
    SourceFormat.dxf: 1,
    SourceFormat.dwg: 2,
    SourceFormat.ifc: 3,
}


def format_supports(source: str, required: str) -> bool:
    """Return True if *source* format is at least as rich as *required*."""
    src = FORMAT_RICHNESS.get(SourceFormat(source), 0)
    req = FORMAT_RICHNESS.get(SourceFormat(required), 0)
    return src >= req


# ---------------------------------------------------------------------------
# IFC entity → canonical element type
# ---------------------------------------------------------------------------

IFC_ENTITY_TO_CANONICAL: dict[str, ElementType] = {
    "IfcWall": ElementType.wall,
    "IfcWallStandardCase": ElementType.wall,
    "IfcSlab": ElementType.slab,
    "IfcDoor": ElementType.door,
    "IfcWindow": ElementType.window,
    "IfcSpace": ElementType.space,
    "IfcColumn": ElementType.column,
    "IfcBeam": ElementType.beam,
    "IfcStair": ElementType.stair,
    "IfcStairFlight": ElementType.stair_flight,
    "IfcRampFlight": ElementType.ramp_flight,
    "IfcRailing": ElementType.railing,
    "IfcRoof": ElementType.roof,
    "IfcCovering": ElementType.covering,
    "IfcCurtainWall": ElementType.curtain_wall,
    "IfcPlate": ElementType.plate,
    "IfcMember": ElementType.member,
    "IfcTransportElement": ElementType.transport_element,
}

CANONICAL_TO_IFC_ENTITY: dict[ElementType, list[str]] = {}
for _ifc, _canon in IFC_ENTITY_TO_CANONICAL.items():
    CANONICAL_TO_IFC_ENTITY.setdefault(_canon, []).append(_ifc)


# ---------------------------------------------------------------------------
# IFC (property_set, property_name) → canonical "domain.property" path
#
# Many-to-one: different psets for different element types map to the same
# canonical property (e.g. Pset_WallCommon.IsExternal and
# Pset_DoorCommon.IsExternal both map to "common.is_external").
# ---------------------------------------------------------------------------

IFC_PSET_PROP_TO_CANONICAL: dict[tuple[str, str], str] = {
    # -- common --
    ("BaseQuantities", "Height"): "common.height",
    ("BaseQuantities", "Width"): "common.width",
    ("Pset_DoorCommon", "Height"): "common.height",
    ("Pset_DoorCommon", "Width"): "common.width",
    ("Pset_DoorCommon", "ClearWidth"): "common.clear_width",
    ("Pset_DoorCommon", "IsExternal"): "common.is_external",
    ("Pset_RoofCommon", "IsExternal"): "common.is_external",
    ("Pset_SlabCommon", "IsExternal"): "common.is_external",
    ("Pset_WallCommon", "IsExternal"): "common.is_external",
    ("Pset_WindowCommon", "IsExternal"): "common.is_external",
    ("Pset_WallCommon", "LoadBearing"): "common.is_load_bearing",
    ("Pset_WallCommon", "Reference"): "common.reference",
    ("Pset_WindowCommon", "Reference"): "common.reference",
    ("Pset_SpaceCommon", "Reference"): "common.reference",
    ("Pset_TransportElementCommon", "Reference"): "common.reference",
    ("Pset_SpaceCommon", "OccupancyType"): "common.occupancy_type",
    ("Pset_SpaceCommon", "Height"): "common.height",
    ("Pset_RailingCommon", "Height"): "common.height",
    ("Pset_DoorCommon", "ThresholdHeight"): "common.threshold_height",
    # -- fire_safety --
    ("Pset_DoorCommon", "FireRating"): "fire_safety.fire_rating",
    ("Pset_SlabCommon", "FireRating"): "fire_safety.fire_rating",
    ("Pset_WallCommon", "FireRating"): "fire_safety.fire_rating",
    ("Pset_DoorCommon", "FireExit"): "fire_safety.is_fire_exit",
    ("Pset_SpaceFireSafetyRequirements", "FireRiskFactor"): "fire_safety.fire_risk_factor",
    ("Pset_BBL_FireSafety", "SmokeDetectorPresent"): "fire_safety.smoke_detector_present",
    ("Pset_BBL_EmergencyLighting", "Present"): "fire_safety.emergency_lighting_present",
    ("Pset_BBL_FireReaction", "FireReactionClass"): "fire_safety.fire_reaction_class",
    ("Pset_BBL_FireReaction", "FirePropagationClass"): "fire_safety.fire_propagation_class",
    ("Pset_BBL_FireReaction", "SmokeProductionClass"): "fire_safety.smoke_production_class",
    ("Pset_DoorCommon", "SelfClosing"): "fire_safety.is_self_closing",
    ("Pset_BBL_FireSafety", "IsFireBrigadeElevator"): "fire_safety.is_fire_brigade_elevator",
    ("Pset_BBL_FireSafety", "DryRiserPresent"): "fire_safety.dry_riser_present",
    ("Pset_BBL_FireSafety", "SmokeExtractionPresent"): "fire_safety.smoke_extraction_present",
    # -- thermal --
    ("Pset_WallCommon", "ThermalTransmittance"): "thermal.thermal_transmittance",
    ("Pset_SlabCommon", "ThermalTransmittance"): "thermal.thermal_transmittance",
    ("Pset_RoofCommon", "ThermalTransmittance"): "thermal.thermal_transmittance",
    ("Pset_WindowCommon", "ThermalTransmittance"): "thermal.thermal_transmittance",
    ("Pset_SpaceThermalRequirements", "AirChangeRate"): "thermal.air_change_rate",
    ("Pset_SpaceCommon", "NaturalLighting"): "thermal.natural_lighting",
    # -- quantities --
    ("BaseQuantities", "GrossFloorArea"): "quantities.gross_floor_area",
    ("Qto_SpaceBaseQuantities", "GrossFloorArea"): "quantities.gross_floor_area",
    ("Qto_SpaceBaseQuantities", "NetFloorArea"): "quantities.net_floor_area",
    ("Qto_SpaceBaseQuantities", "NetVolume"): "quantities.net_volume",
    # -- stair --
    ("Pset_StairFlightCommon", "RiserHeight"): "stair.riser_height",
    ("Pset_StairFlightCommon", "TreadLength"): "stair.tread_length",
    ("Pset_StairCommon", "RequiredHeadroom"): "stair.required_headroom",
    # -- ramp --
    ("Pset_RampFlightCommon", "Slope"): "ramp.slope",
    ("Pset_RampFlightCommon", "AccessibilityPerformance"): "ramp.accessibility_performance",
    # -- daylight --
    ("Pset_BBL_Daylight", "DaylightAreaPercent"): "daylight.daylight_area_percent",
    # -- health --
    ("Pset_BBL_Ventilation", "PurgeVentilationRate"): "health.purge_ventilation_rate",
    ("Pset_BBL_CombustionAir", "HasCombustionAppliance"): "health.has_combustion_appliance",
    ("Pset_BBL_CombustionAir", "CombustionAirSupplyRate"): "health.combustion_air_supply_rate",
    # -- accessibility --
    ("Pset_BBL_Accessibility", "WheelchairAccessible"): "accessibility.wheelchair_accessible",
    ("Pset_SpaceCommon", "PubliclyAccessible"): "common.publicly_accessible",
}


def ifc_to_canonical(property_set: str, property_name: str) -> str:
    """Map an IFC (property_set, property_name) pair to a canonical path.

    Returns a ``domain.property`` string.  Falls back to
    ``{property_set}.{property_name}`` unchanged if no mapping exists,
    so unmapped custom psets still work (just not portable).
    """
    return IFC_PSET_PROP_TO_CANONICAL.get(
        (property_set, property_name),
        f"{property_set}.{property_name}",
    )


def ifc_entity_to_canonical(ifc_entity: str) -> str:
    """Map an IFC entity type to a canonical element type string.

    Returns the IFC name unchanged if no mapping exists.
    """
    canon = IFC_ENTITY_TO_CANONICAL.get(ifc_entity)
    return canon.value if canon is not None else ifc_entity
