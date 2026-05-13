#!/usr/bin/env python3
"""Migrate all rule YAML files from IFC-specific to canonical format.

Transforms:
  - applicable_ifc_entities → applicable_element_types (canonical names)
  - property_set + property_name → property (dot-notation canonical path)
  - Adds min_source_format: ifc (all current rules were authored for IFC)

Reads each YAML, transforms in-place, writes back.
"""

from __future__ import annotations

import sys
from pathlib import Path

import yaml


# ── Mapping tables (mirrors canonical.py) ────────────────────────────

IFC_ENTITY_TO_CANONICAL: dict[str, str] = {
    "IfcWall": "wall",
    "IfcWallStandardCase": "wall",
    "IfcSlab": "slab",
    "IfcDoor": "door",
    "IfcWindow": "window",
    "IfcSpace": "space",
    "IfcColumn": "column",
    "IfcBeam": "beam",
    "IfcStair": "stair",
    "IfcStairFlight": "stair_flight",
    "IfcRampFlight": "ramp_flight",
    "IfcRailing": "railing",
    "IfcRoof": "roof",
    "IfcCovering": "covering",
    "IfcCurtainWall": "curtain_wall",
    "IfcPlate": "plate",
    "IfcMember": "member",
    "IfcTransportElement": "transport_element",
}

IFC_PSET_PROP_TO_CANONICAL: dict[tuple[str, str], str] = {
    ("BaseQuantities", "Height"): "common.height",
    ("BaseQuantities", "Width"): "common.width",
    ("Pset_DoorCommon", "Height"): "common.height",
    ("Pset_DoorCommon", "Width"): "common.width",
    ("Pset_DoorCommon", "ClearWidth"): "common.clear_width",
    ("Pset_DoorCommon", "IsExternal"): "common.is_external",
    ("Pset_DoorCommon", "ThresholdHeight"): "common.threshold_height",
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
    ("Pset_DoorCommon", "FireRating"): "fire_safety.fire_rating",
    ("Pset_SlabCommon", "FireRating"): "fire_safety.fire_rating",
    ("Pset_WallCommon", "FireRating"): "fire_safety.fire_rating",
    ("Pset_DoorCommon", "FireExit"): "fire_safety.is_fire_exit",
    ("Pset_SpaceFireSafetyRequirements", "FireRiskFactor"): "fire_safety.fire_risk_factor",
    ("Pset_BBL_FireSafety", "SmokeDetectorPresent"): "fire_safety.smoke_detector_present",
    ("Pset_BBL_EmergencyLighting", "Present"): "fire_safety.emergency_lighting_present",
    ("Pset_WallCommon", "ThermalTransmittance"): "thermal.thermal_transmittance",
    ("Pset_SlabCommon", "ThermalTransmittance"): "thermal.thermal_transmittance",
    ("Pset_RoofCommon", "ThermalTransmittance"): "thermal.thermal_transmittance",
    ("Pset_WindowCommon", "ThermalTransmittance"): "thermal.thermal_transmittance",
    ("Pset_SpaceThermalRequirements", "AirChangeRate"): "thermal.air_change_rate",
    ("Pset_SpaceCommon", "NaturalLighting"): "thermal.natural_lighting",
    ("BaseQuantities", "GrossFloorArea"): "quantities.gross_floor_area",
    ("Qto_SpaceBaseQuantities", "GrossFloorArea"): "quantities.gross_floor_area",
    ("Qto_SpaceBaseQuantities", "NetFloorArea"): "quantities.net_floor_area",
    ("Qto_SpaceBaseQuantities", "NetVolume"): "quantities.net_volume",
    ("Pset_StairFlightCommon", "RiserHeight"): "stair.riser_height",
    ("Pset_StairFlightCommon", "TreadLength"): "stair.tread_length",
    ("Pset_StairCommon", "RequiredHeadroom"): "stair.required_headroom",
    ("Pset_RampFlightCommon", "Slope"): "ramp.slope",
    ("Pset_RampFlightCommon", "AccessibilityPerformance"): "ramp.accessibility_performance",
    ("Pset_BBL_Daylight", "DaylightAreaPercent"): "daylight.daylight_area_percent",
}


def convert_pset_prop(pset: str, prop: str) -> str:
    canonical = IFC_PSET_PROP_TO_CANONICAL.get((pset, prop))
    if canonical is not None:
        return canonical
    return f"{pset}.{prop}"


def migrate_check(check: dict) -> dict:
    pset = check.pop("property_set", None)
    prop_name = check.pop("property_name", None)
    if pset and prop_name and "property" not in check:
        check["property"] = convert_pset_prop(pset, prop_name)
    return check


def migrate_filter(flt: dict) -> dict:
    pset = flt.pop("property_set", None)
    prop_name = flt.pop("property_name", None)
    if pset and prop_name and "property" not in flt:
        flt["property"] = convert_pset_prop(pset, prop_name)
    return flt


def migrate_rule(rule: dict) -> dict:
    ifc_entities = rule.pop("applicable_ifc_entities", None)
    if ifc_entities and "applicable_element_types" not in rule:
        canonical = []
        for e in ifc_entities:
            c = IFC_ENTITY_TO_CANONICAL.get(e)
            if c is not None:
                canonical.append(c)
            else:
                print(f"  WARNING: unmapped IFC entity '{e}', keeping as-is")
                canonical.append(e)
        rule["applicable_element_types"] = canonical

    if "min_source_format" not in rule:
        rule["min_source_format"] = "ifc"

    if "checks" in rule:
        rule["checks"] = [migrate_check(c) for c in rule["checks"]]

    if "applicability_filters" in rule:
        rule["applicability_filters"] = [
            migrate_filter(f) for f in rule["applicability_filters"]
        ]

    return rule


def migrate_file(path: Path) -> int:
    raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    if raw is None or "rules" not in raw:
        return 0

    count = 0
    for rule in raw["rules"]:
        migrate_rule(rule)
        count += 1

    path.write_text(
        yaml.dump(raw, allow_unicode=True, sort_keys=False, default_flow_style=False, width=120),
        encoding="utf-8",
    )
    return count


def main() -> None:
    rules_dir = Path(__file__).parent.parent / "rules"
    total = 0
    files = 0

    for yaml_path in sorted(rules_dir.rglob("*.yaml")):
        if yaml_path.name == "manifest.yaml":
            continue
        print(f"Migrating {yaml_path.relative_to(rules_dir)} ... ", end="")
        count = migrate_file(yaml_path)
        print(f"{count} rules")
        total += count
        files += 1

    print(f"\nDone: {total} rules across {files} files migrated to canonical format.")


if __name__ == "__main__":
    main()
