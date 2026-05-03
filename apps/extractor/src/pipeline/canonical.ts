/**
 * Canonical building element taxonomy and property namespace.
 *
 * Mirrors the Python canonical module in the compliance-checker service.
 * Every file-format extractor maps its native types/properties into these
 * canonical names so the rule engine is format-agnostic.
 */

export type CanonicalElementType =
  | 'wall'
  | 'slab'
  | 'door'
  | 'window'
  | 'space'
  | 'column'
  | 'beam'
  | 'stair'
  | 'stair_flight'
  | 'ramp_flight'
  | 'railing'
  | 'roof'
  | 'covering'
  | 'curtain_wall'
  | 'plate'
  | 'member'
  | 'transport_element';

export const IFC_ENTITY_TO_CANONICAL: Record<string, CanonicalElementType> = {
  IfcWall: 'wall',
  IfcWallStandardCase: 'wall',
  IfcSlab: 'slab',
  IfcDoor: 'door',
  IfcWindow: 'window',
  IfcSpace: 'space',
  IfcColumn: 'column',
  IfcBeam: 'beam',
  IfcStair: 'stair',
  IfcStairFlight: 'stair_flight',
  IfcRampFlight: 'ramp_flight',
  IfcRailing: 'railing',
  IfcRoof: 'roof',
  IfcCovering: 'covering',
  IfcCurtainWall: 'curtain_wall',
  IfcPlate: 'plate',
  IfcMember: 'member',
  IfcTransportElement: 'transport_element',
};

export type SourceFormat = 'ifc' | 'dwg' | 'dxf' | 'pdf';

/**
 * Map IFC (property_set, property_name) to canonical "domain.property" path.
 *
 * Key format: "PsetName::PropertyName"
 */
export const IFC_PSET_PROP_TO_CANONICAL: Record<string, string> = {
  // common
  'BaseQuantities::Height': 'common.height',
  'BaseQuantities::Width': 'common.width',
  'Pset_DoorCommon::Height': 'common.height',
  'Pset_DoorCommon::Width': 'common.width',
  'Pset_DoorCommon::ClearWidth': 'common.clear_width',
  'Pset_DoorCommon::IsExternal': 'common.is_external',
  'Pset_DoorCommon::ThresholdHeight': 'common.threshold_height',
  'Pset_RoofCommon::IsExternal': 'common.is_external',
  'Pset_SlabCommon::IsExternal': 'common.is_external',
  'Pset_WallCommon::IsExternal': 'common.is_external',
  'Pset_WindowCommon::IsExternal': 'common.is_external',
  'Pset_WallCommon::LoadBearing': 'common.is_load_bearing',
  'Pset_WallCommon::Reference': 'common.reference',
  'Pset_WindowCommon::Reference': 'common.reference',
  'Pset_SpaceCommon::Reference': 'common.reference',
  'Pset_TransportElementCommon::Reference': 'common.reference',
  'Pset_SpaceCommon::OccupancyType': 'common.occupancy_type',
  'Pset_SpaceCommon::Height': 'common.height',
  'Pset_RailingCommon::Height': 'common.height',
  // fire_safety
  'Pset_DoorCommon::FireRating': 'fire_safety.fire_rating',
  'Pset_SlabCommon::FireRating': 'fire_safety.fire_rating',
  'Pset_WallCommon::FireRating': 'fire_safety.fire_rating',
  'Pset_DoorCommon::FireExit': 'fire_safety.is_fire_exit',
  'Pset_SpaceFireSafetyRequirements::FireRiskFactor': 'fire_safety.fire_risk_factor',
  'Pset_BBL_FireSafety::SmokeDetectorPresent': 'fire_safety.smoke_detector_present',
  'Pset_BBL_EmergencyLighting::Present': 'fire_safety.emergency_lighting_present',
  // thermal
  'Pset_WallCommon::ThermalTransmittance': 'thermal.thermal_transmittance',
  'Pset_SlabCommon::ThermalTransmittance': 'thermal.thermal_transmittance',
  'Pset_RoofCommon::ThermalTransmittance': 'thermal.thermal_transmittance',
  'Pset_WindowCommon::ThermalTransmittance': 'thermal.thermal_transmittance',
  'Pset_SpaceThermalRequirements::AirChangeRate': 'thermal.air_change_rate',
  'Pset_SpaceCommon::NaturalLighting': 'thermal.natural_lighting',
  // quantities
  'BaseQuantities::GrossFloorArea': 'quantities.gross_floor_area',
  'Qto_SpaceBaseQuantities::GrossFloorArea': 'quantities.gross_floor_area',
  'Qto_SpaceBaseQuantities::NetFloorArea': 'quantities.net_floor_area',
  'Qto_SpaceBaseQuantities::NetVolume': 'quantities.net_volume',
  // stair
  'Pset_StairFlightCommon::RiserHeight': 'stair.riser_height',
  'Pset_StairFlightCommon::TreadLength': 'stair.tread_length',
  'Pset_StairCommon::RequiredHeadroom': 'stair.required_headroom',
  // ramp
  'Pset_RampFlightCommon::Slope': 'ramp.slope',
  'Pset_RampFlightCommon::AccessibilityPerformance': 'ramp.accessibility_performance',
  // daylight
  'Pset_BBL_Daylight::DaylightAreaPercent': 'daylight.daylight_area_percent',
};

const EXTRA_PRODUCT_TYPES: readonly string[] = [
  'IfcFurnishingElement',
  'IfcBuildingElementProxy',
  'IfcDuctSegment',
  'IfcPipeSegment',
  'IfcFlowFitting',
  'IfcFlowTerminal',
];

export const IFC_UPPERCASE_TO_PASCAL: ReadonlyMap<string, string> = new Map([
  ...Object.keys(IFC_ENTITY_TO_CANONICAL).map(
    (k) => [k.toUpperCase(), k] as const,
  ),
  ...EXTRA_PRODUCT_TYPES.map((k) => [k.toUpperCase(), k] as const),
]);

export function ifcEntityToCanonical(ifcEntity: string): CanonicalElementType | null {
  return IFC_ENTITY_TO_CANONICAL[ifcEntity] ?? null;
}

export function ifcPsetPropToCanonical(
  psetName: string,
  propName: string,
): string | null {
  return IFC_PSET_PROP_TO_CANONICAL[`${psetName}::${propName}`] ?? null;
}
