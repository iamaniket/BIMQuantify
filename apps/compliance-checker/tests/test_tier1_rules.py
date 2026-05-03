from __future__ import annotations

from typing import TYPE_CHECKING, Any

from compliance_checker.rules.engine import evaluate

if TYPE_CHECKING:
    from compliance_checker.rules.loader import RuleIndex


def _run(
    rule_id: str,
    rule_index: RuleIndex,
    metadata: dict[str, Any],
    properties: dict[str, Any],
) -> Any:
    rule = rule_index.get_rule(rule_id)
    assert rule is not None, f"Rule {rule_id} not loaded"
    return evaluate(
        properties=properties,
        metadata=metadata,
        rules=[rule],
        file_id="tier1-test",
    )


class TestCirculationHeight:
    rule_id = "bbl_4_25_circulation_height"

    def test_pass(self, rule_index, sample_metadata, sample_properties):
        result = _run(self.rule_id, rule_index, sample_metadata, sample_properties)
        corridor = [r for r in result.details if r.element_global_id == "space-corridor-004"]
        assert any(r.status == "pass" for r in corridor)

    def test_fail(self, rule_index, sample_metadata, sample_properties):
        result = _run(self.rule_id, rule_index, sample_metadata, sample_properties)
        hallway = [r for r in result.details if r.element_global_id == "space-hallway-005"]
        assert any(r.status == "fail" for r in hallway)

    def test_filter_excludes_non_circulation(self, rule_index, sample_metadata, sample_properties):
        result = _run(self.rule_id, rule_index, sample_metadata, sample_properties)
        living = [r for r in result.details if r.element_global_id == "space-living-001"]
        assert living == []


class TestStairRiserHeight:
    rule_id = "bbl_4_27_stair_riser_height"

    def test_pass(self, rule_index, sample_metadata, sample_properties):
        result = _run(self.rule_id, rule_index, sample_metadata, sample_properties)
        good = [r for r in result.details if r.element_global_id == "stairflight-good-001"]
        assert any(r.status == "pass" for r in good)

    def test_fail(self, rule_index, sample_metadata, sample_properties):
        result = _run(self.rule_id, rule_index, sample_metadata, sample_properties)
        bad = [r for r in result.details if r.element_global_id == "stairflight-bad-002"]
        assert any(r.status == "fail" for r in bad)


class TestStairTreadLength:
    rule_id = "bbl_4_27_stair_tread_length"

    def test_pass(self, rule_index, sample_metadata, sample_properties):
        result = _run(self.rule_id, rule_index, sample_metadata, sample_properties)
        good = [r for r in result.details if r.element_global_id == "stairflight-good-001"]
        assert any(r.status == "pass" for r in good)

    def test_fail(self, rule_index, sample_metadata, sample_properties):
        result = _run(self.rule_id, rule_index, sample_metadata, sample_properties)
        bad = [r for r in result.details if r.element_global_id == "stairflight-bad-002"]
        assert any(r.status == "fail" for r in bad)


class TestRampSlope:
    rule_id = "bbl_4_28_ramp_slope"

    def test_pass(self, rule_index, sample_metadata, sample_properties):
        result = _run(self.rule_id, rule_index, sample_metadata, sample_properties)
        good = [r for r in result.details if r.element_global_id == "rampflight-good-001"]
        assert any(r.status == "pass" for r in good)

    def test_fail(self, rule_index, sample_metadata, sample_properties):
        result = _run(self.rule_id, rule_index, sample_metadata, sample_properties)
        bad = [r for r in result.details if r.element_global_id == "rampflight-bad-002"]
        assert any(r.status == "fail" for r in bad)


class TestRailingHeight:
    rule_id = "bbl_4_18_railing_height"

    def test_pass(self, rule_index, sample_metadata, sample_properties):
        result = _run(self.rule_id, rule_index, sample_metadata, sample_properties)
        good = [r for r in result.details if r.element_global_id == "railing-good-001"]
        assert any(r.status == "pass" for r in good)

    def test_fail(self, rule_index, sample_metadata, sample_properties):
        result = _run(self.rule_id, rule_index, sample_metadata, sample_properties)
        bad = [r for r in result.details if r.element_global_id == "railing-bad-002"]
        assert any(r.status == "fail" for r in bad)


class TestExternalWallUValue:
    rule_id = "bbl_4_163_external_wall_u_value"

    def test_pass(self, rule_index, sample_metadata, sample_properties):
        result = _run(self.rule_id, rule_index, sample_metadata, sample_properties)
        good = [r for r in result.details if r.element_global_id == "wall-ext-001"]
        assert any(r.status == "pass" for r in good)

    def test_fail(self, rule_index, sample_metadata, sample_properties):
        result = _run(self.rule_id, rule_index, sample_metadata, sample_properties)
        bad = [r for r in result.details if r.element_global_id == "wall-ext-poor-005"]
        assert any(r.status == "fail" for r in bad)

    def test_internal_walls_excluded(self, rule_index, sample_metadata, sample_properties):
        result = _run(self.rule_id, rule_index, sample_metadata, sample_properties)
        internal = [r for r in result.details if r.element_global_id == "wall-int-002"]
        assert internal == []


class TestElevatorPresence:
    rule_id = "bbl_4_105_elevator_presence"

    def test_pass(self, rule_index, sample_metadata, sample_properties):
        result = _run(self.rule_id, rule_index, sample_metadata, sample_properties)
        elevator = [r for r in result.details if r.element_global_id == "elevator-001"]
        assert any(r.status == "pass" for r in elevator)

    def test_severity_warning(self, rule_index):
        rule = rule_index.get_rule(self.rule_id)
        assert rule is not None
        assert rule.severity == "warning"


class TestFireReactionClass:
    rule_id = "bbl_4_14_interior_surface_fire_reaction"

    def test_pass(self, rule_index, sample_metadata, sample_properties):
        result = _run(self.rule_id, rule_index, sample_metadata, sample_properties)
        good = [r for r in result.details if r.element_global_id == "wall-fire-class-good-001"]
        assert any(r.status == "pass" for r in good)

    def test_fail(self, rule_index, sample_metadata, sample_properties):
        result = _run(self.rule_id, rule_index, sample_metadata, sample_properties)
        bad = [r for r in result.details if r.element_global_id == "wall-fire-class-bad-002"]
        assert any(r.status == "fail" for r in bad)

    def test_covering_pass(self, rule_index, sample_metadata, sample_properties):
        result = _run(self.rule_id, rule_index, sample_metadata, sample_properties)
        covering = [r for r in result.details if r.element_global_id == "covering-fire-class-003"]
        assert any(r.status == "pass" for r in covering)


class TestFirePropagationClass:
    rule_id = "bbl_4_15_fire_propagation_class"

    def test_pass(self, rule_index, sample_metadata, sample_properties):
        result = _run(self.rule_id, rule_index, sample_metadata, sample_properties)
        good = [r for r in result.details if r.element_global_id == "wall-fire-class-good-001"]
        assert any(r.status == "pass" for r in good)

    def test_fail(self, rule_index, sample_metadata, sample_properties):
        result = _run(self.rule_id, rule_index, sample_metadata, sample_properties)
        bad = [r for r in result.details if r.element_global_id == "wall-fire-class-bad-002"]
        assert any(r.status == "fail" for r in bad)

    def test_external_walls_excluded(self, rule_index, sample_metadata, sample_properties):
        result = _run(self.rule_id, rule_index, sample_metadata, sample_properties)
        external = [r for r in result.details if r.element_global_id == "wall-ext-001"]
        assert external == []


class TestSmokeProductionClass:
    rule_id = "bbl_4_16_smoke_production_class"

    def test_pass(self, rule_index, sample_metadata, sample_properties):
        result = _run(self.rule_id, rule_index, sample_metadata, sample_properties)
        good = [r for r in result.details if r.element_global_id == "wall-fire-class-good-001"]
        assert any(r.status == "pass" for r in good)

    def test_fail(self, rule_index, sample_metadata, sample_properties):
        result = _run(self.rule_id, rule_index, sample_metadata, sample_properties)
        bad = [r for r in result.details if r.element_global_id == "wall-fire-class-bad-002"]
        assert any(r.status == "fail" for r in bad)


class TestSubCompartmentArea:
    rule_id = "bbl_4_32_sub_compartment_max_area"

    def test_pass(self, rule_index, sample_metadata, sample_properties):
        result = _run(self.rule_id, rule_index, sample_metadata, sample_properties)
        good = [r for r in result.details if r.element_global_id == "space-fire-compartment-006"]
        assert any(r.status == "pass" for r in good)

    def test_fail(self, rule_index, sample_metadata, sample_properties):
        result = _run(self.rule_id, rule_index, sample_metadata, sample_properties)
        bad = [r for r in result.details if r.element_global_id == "space-fire-compartment-007"]
        assert any(r.status in ("fail", "warn") for r in bad)

    def test_filter_excludes_non_fire_classified(self, rule_index, sample_metadata, sample_properties):
        result = _run(self.rule_id, rule_index, sample_metadata, sample_properties)
        living = [r for r in result.details if r.element_global_id == "space-living-001"]
        assert living == []


class TestEscapeDoorSelfClosing:
    rule_id = "bbl_4_41_escape_door_self_closing"

    def test_pass(self, rule_index, sample_metadata, sample_properties):
        result = _run(self.rule_id, rule_index, sample_metadata, sample_properties)
        good = [r for r in result.details if r.element_global_id == "door-fire-self-closing-004"]
        assert any(r.status == "pass" for r in good)

    def test_fail(self, rule_index, sample_metadata, sample_properties):
        result = _run(self.rule_id, rule_index, sample_metadata, sample_properties)
        bad = [r for r in result.details if r.element_global_id == "door-fire-not-closing-005"]
        assert any(r.status == "fail" for r in bad)

    def test_filter_excludes_non_fire_exit(self, rule_index, sample_metadata, sample_properties):
        result = _run(self.rule_id, rule_index, sample_metadata, sample_properties)
        regular = [r for r in result.details if r.element_global_id == "door-internal-002"]
        assert regular == []


class TestVentilationOtherRooms:
    rule_id = "bbl_4_134_ventilation_other_rooms"

    def test_pass(self, rule_index, sample_metadata, sample_properties):
        result = _run(self.rule_id, rule_index, sample_metadata, sample_properties)
        good = [r for r in result.details if r.element_global_id == "space-toilet-008"]
        assert any(r.status == "pass" for r in good)

    def test_fail(self, rule_index, sample_metadata, sample_properties):
        result = _run(self.rule_id, rule_index, sample_metadata, sample_properties)
        bad = [r for r in result.details if r.element_global_id == "space-kitchen-009"]
        assert any(r.status == "fail" for r in bad)

    def test_filter_excludes_non_matching_rooms(self, rule_index, sample_metadata, sample_properties):
        result = _run(self.rule_id, rule_index, sample_metadata, sample_properties)
        living = [r for r in result.details if r.element_global_id == "space-living-001"]
        assert living == []


class TestEmergencyLightingPresent:
    rule_id = "bbl_4_42_emergency_lighting_present"

    def test_pass(self, rule_index, sample_metadata, sample_properties):
        result = _run(self.rule_id, rule_index, sample_metadata, sample_properties)
        good = [r for r in result.details if r.element_global_id == "space-escape-route-010"]
        assert any(r.status == "pass" for r in good)

    def test_warn_when_absent(self, rule_index, sample_metadata, sample_properties):
        result = _run(self.rule_id, rule_index, sample_metadata, sample_properties)
        absent = [r for r in result.details if r.element_global_id == "space-escape-route-011"]
        assert any(r.status == "warn" for r in absent)

    def test_filter_excludes_non_escape(self, rule_index, sample_metadata, sample_properties):
        result = _run(self.rule_id, rule_index, sample_metadata, sample_properties)
        living = [r for r in result.details if r.element_global_id == "space-living-001"]
        assert living == []


class TestSmokeDetectorPresent:
    rule_id = "bbl_4_45_smoke_detector_present"

    def test_pass(self, rule_index, sample_metadata, sample_properties):
        result = _run(self.rule_id, rule_index, sample_metadata, sample_properties)
        good = [r for r in result.details if r.element_global_id == "space-living-hab-012"]
        assert any(r.status == "pass" for r in good)

    def test_warn_when_absent(self, rule_index, sample_metadata, sample_properties):
        result = _run(self.rule_id, rule_index, sample_metadata, sample_properties)
        absent = [r for r in result.details if r.element_global_id == "space-living-hab-013"]
        assert any(r.status == "warn" for r in absent)

    def test_filter_excludes_non_living(self, rule_index, sample_metadata, sample_properties):
        result = _run(self.rule_id, rule_index, sample_metadata, sample_properties)
        bathroom = [r for r in result.details if r.element_global_id == "space-bathroom-002"]
        assert bathroom == []


class TestSmokeExtractionPresent:
    rule_id = "bbl_4_52_smoke_extraction_present"

    def test_pass(self, rule_index, sample_metadata, sample_properties):
        result = _run(self.rule_id, rule_index, sample_metadata, sample_properties)
        good = [r for r in result.details if r.element_global_id == "space-parking-014"]
        assert any(r.status == "pass" for r in good)

    def test_warn_when_absent(self, rule_index, sample_metadata, sample_properties):
        result = _run(self.rule_id, rule_index, sample_metadata, sample_properties)
        absent = [r for r in result.details if r.element_global_id == "space-parking-015"]
        assert any(r.status == "warn" for r in absent)

    def test_filter_excludes_non_parking(self, rule_index, sample_metadata, sample_properties):
        result = _run(self.rule_id, rule_index, sample_metadata, sample_properties)
        living = [r for r in result.details if r.element_global_id == "space-living-001"]
        assert living == []


class TestEntranceThresholdHeight:
    rule_id = "bbl_4_23_entrance_threshold_height"

    def test_pass(self, rule_index, sample_metadata, sample_properties):
        result = _run(self.rule_id, rule_index, sample_metadata, sample_properties)
        good = [r for r in result.details if r.element_global_id == "door-ext-threshold-low-006"]
        assert any(r.status == "pass" for r in good)

    def test_fail(self, rule_index, sample_metadata, sample_properties):
        result = _run(self.rule_id, rule_index, sample_metadata, sample_properties)
        bad = [r for r in result.details if r.element_global_id == "door-ext-threshold-high-007"]
        assert any(r.status == "warn" for r in bad)

    def test_filter_excludes_internal_doors(self, rule_index, sample_metadata, sample_properties):
        result = _run(self.rule_id, rule_index, sample_metadata, sample_properties)
        internal = [r for r in result.details if r.element_global_id == "door-internal-002"]
        assert internal == []


class TestAccessibilityRampSlope:
    rule_id = "bbl_4_104_ramp_height_difference_slope"

    def test_pass(self, rule_index, sample_metadata, sample_properties):
        result = _run(self.rule_id, rule_index, sample_metadata, sample_properties)
        good = [r for r in result.details if r.element_global_id == "rampflight-accessible-good-003"]
        assert any(r.status == "pass" for r in good)

    def test_fail(self, rule_index, sample_metadata, sample_properties):
        result = _run(self.rule_id, rule_index, sample_metadata, sample_properties)
        bad = [r for r in result.details if r.element_global_id == "rampflight-accessible-bad-004"]
        assert any(r.status == "fail" for r in bad)

    def test_filter_excludes_non_accessibility_ramps(self, rule_index, sample_metadata, sample_properties):
        result = _run(self.rule_id, rule_index, sample_metadata, sample_properties)
        regular = [r for r in result.details if r.element_global_id == "rampflight-good-001"]
        assert regular == []


class TestDaylightPresence:
    rule_id = "bbl_4_141_daylight_presence"

    def test_pass(self, rule_index, sample_metadata, sample_properties):
        result = _run(self.rule_id, rule_index, sample_metadata, sample_properties)
        good = [r for r in result.details if r.element_global_id == "space-habitable-daylight-016"]
        assert any(r.status == "pass" for r in good)

    def test_warn_when_absent(self, rule_index, sample_metadata, sample_properties):
        result = _run(self.rule_id, rule_index, sample_metadata, sample_properties)
        absent = [r for r in result.details if r.element_global_id == "space-habitable-nodaylight-017"]
        assert any(r.status == "warn" for r in absent)


class TestDaylightAreaRatio:
    rule_id = "bbl_4_142_daylight_area_ratio"

    def test_pass(self, rule_index, sample_metadata, sample_properties):
        result = _run(self.rule_id, rule_index, sample_metadata, sample_properties)
        good = [r for r in result.details if r.element_global_id == "space-habitable-daylight-016"]
        assert any(r.status == "pass" for r in good)

    def test_fail(self, rule_index, sample_metadata, sample_properties):
        result = _run(self.rule_id, rule_index, sample_metadata, sample_properties)
        bad = [r for r in result.details if r.element_global_id == "space-habitable-nodaylight-017"]
        assert any(r.status == "warn" for r in bad)


class TestPurgeVentilationRate:
    rule_id = "bbl_4_131_purge_ventilation_rate"

    def test_pass(self, rule_index, sample_metadata, sample_properties):
        result = _run(self.rule_id, rule_index, sample_metadata, sample_properties)
        good = [r for r in result.details if r.element_global_id == "space-habitable-purge-018"]
        assert any(r.status == "pass" for r in good)

    def test_fail(self, rule_index, sample_metadata, sample_properties):
        result = _run(self.rule_id, rule_index, sample_metadata, sample_properties)
        bad = [r for r in result.details if r.element_global_id == "space-habitable-purge-019"]
        assert any(r.status == "fail" for r in bad)


class TestFireBrigadeElevator:
    rule_id = "bbl_4_37_fire_brigade_elevator"

    def test_pass_tall_building(self, rule_index, sample_metadata_tall, sample_properties):
        result = _run(self.rule_id, rule_index, sample_metadata_tall, sample_properties)
        good = [r for r in result.details if r.element_global_id == "elevator-fire-002"]
        assert any(r.status == "pass" for r in good)

    def test_not_applicable_short_building(self, rule_index, sample_metadata, sample_properties):
        result = _run(self.rule_id, rule_index, sample_metadata, sample_properties)
        assert result.details == []


class TestDryRiserPresent:
    rule_id = "bbl_4_47_dry_riser_present"

    def test_pass_tall_building(self, rule_index, sample_metadata_tall, sample_properties):
        result = _run(self.rule_id, rule_index, sample_metadata_tall, sample_properties)
        good = [r for r in result.details if r.element_global_id == "space-stairwell-020"]
        assert any(r.status == "pass" for r in good)

    def test_warn_when_absent(self, rule_index, sample_metadata_tall, sample_properties):
        result = _run(self.rule_id, rule_index, sample_metadata_tall, sample_properties)
        absent = [r for r in result.details if r.element_global_id == "space-stairwell-021"]
        assert any(r.status == "warn" for r in absent)

    def test_not_applicable_short_building(self, rule_index, sample_metadata, sample_properties):
        result = _run(self.rule_id, rule_index, sample_metadata, sample_properties)
        assert result.details == []

    def test_filter_excludes_non_stairwell(self, rule_index, sample_metadata_tall, sample_properties):
        result = _run(self.rule_id, rule_index, sample_metadata_tall, sample_properties)
        living = [r for r in result.details if r.element_global_id == "space-living-001"]
        assert living == []


class TestCombustionAirSupply:
    rule_id = "bbl_4_135_combustion_air_supply"

    def test_pass(self, rule_index, sample_metadata, sample_properties):
        result = _run(self.rule_id, rule_index, sample_metadata, sample_properties)
        good = [r for r in result.details if r.element_global_id == "space-combustion-022"]
        assert any(r.status == "pass" for r in good)

    def test_fail(self, rule_index, sample_metadata, sample_properties):
        result = _run(self.rule_id, rule_index, sample_metadata, sample_properties)
        bad = [r for r in result.details if r.element_global_id == "space-combustion-023"]
        assert any(r.status == "fail" for r in bad)

    def test_filter_excludes_non_combustion_spaces(self, rule_index, sample_metadata, sample_properties):
        result = _run(self.rule_id, rule_index, sample_metadata, sample_properties)
        living = [r for r in result.details if r.element_global_id == "space-living-001"]
        assert living == []


class TestResidentialDoorWidth:
    rule_id = "bbl_4_101_residential_door_width"

    def test_pass(self, rule_index, sample_metadata, sample_properties):
        result = _run(self.rule_id, rule_index, sample_metadata, sample_properties)
        good = [r for r in result.details if r.element_global_id == "door-main-001"]
        assert any(r.status == "pass" for r in good)

    def test_fail(self, rule_index, sample_metadata, sample_properties):
        result = _run(self.rule_id, rule_index, sample_metadata, sample_properties)
        bad = [r for r in result.details if r.element_global_id == "door-internal-002"]
        assert any(r.status == "fail" for r in bad)


class TestNonResidentialDoorWidth:
    rule_id = "bbl_4_102_non_residential_door_width"

    def test_pass(self, rule_index, sample_metadata, sample_properties):
        result = _run(self.rule_id, rule_index, sample_metadata, sample_properties)
        good = [r for r in result.details if r.element_global_id == "door-public-good-008"]
        assert any(r.status == "pass" for r in good)

    def test_fail(self, rule_index, sample_metadata, sample_properties):
        result = _run(self.rule_id, rule_index, sample_metadata, sample_properties)
        bad = [r for r in result.details if r.element_global_id == "door-public-narrow-009"]
        assert any(r.status == "fail" for r in bad)

    def test_filter_excludes_non_public(self, rule_index, sample_metadata, sample_properties):
        result = _run(self.rule_id, rule_index, sample_metadata, sample_properties)
        internal = [r for r in result.details if r.element_global_id == "door-internal-002"]
        assert internal == []


class TestWheelchairDoorRequirements:
    rule_id = "bbl_4_103_wheelchair_door_clear_width"

    def test_pass(self, rule_index, sample_metadata, sample_properties):
        result = _run(self.rule_id, rule_index, sample_metadata, sample_properties)
        good = [r for r in result.details if r.element_global_id == "door-wheelchair-good-010"]
        assert any(r.status == "pass" for r in good)

    def test_fail_width(self, rule_index, sample_metadata, sample_properties):
        result = _run(self.rule_id, rule_index, sample_metadata, sample_properties)
        bad = [r for r in result.details if r.element_global_id == "door-wheelchair-narrow-011"]
        assert any(r.status == "fail" for r in bad)

    def test_filter_excludes_non_wheelchair(self, rule_index, sample_metadata, sample_properties):
        result = _run(self.rule_id, rule_index, sample_metadata, sample_properties)
        internal = [r for r in result.details if r.element_global_id == "door-internal-002"]
        assert internal == []
