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
