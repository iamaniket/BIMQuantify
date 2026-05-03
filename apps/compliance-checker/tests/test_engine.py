from __future__ import annotations

from typing import Any

import pytest

from compliance_checker.rules.engine import (
    ComplianceResult,
    convert_to_rule_unit,
    evaluate,
    parse_fire_rating_minutes,
)
from compliance_checker.rules.loader import RuleIndex


class TestFireRatingParsing:
    def test_numeric_int(self) -> None:
        assert parse_fire_rating_minutes(60) == 60.0

    def test_numeric_float(self) -> None:
        assert parse_fire_rating_minutes(90.0) == 90.0

    def test_rei_string(self) -> None:
        assert parse_fire_rating_minutes("REI120") == 120.0

    def test_ei_string(self) -> None:
        assert parse_fire_rating_minutes("EI60") == 60.0

    def test_r_string(self) -> None:
        assert parse_fire_rating_minutes("R30") == 30.0

    def test_no_numbers(self) -> None:
        assert parse_fire_rating_minutes("none") is None

    def test_none_value(self) -> None:
        assert parse_fire_rating_minutes(None) is None

    def test_ei_with_dash(self) -> None:
        assert parse_fire_rating_minutes("EI-30") == 30.0


class TestUnitConversion:
    def test_mm_to_mm(self) -> None:
        assert convert_to_rule_unit(2600, "mm", "mm") == 2600.0

    def test_m_to_mm(self) -> None:
        assert convert_to_rule_unit(2.6, "mm", "m") == 2600.0

    def test_ft_to_mm(self) -> None:
        result = convert_to_rule_unit(1.0, "mm", "ft")
        assert abs(result - 304.8) < 0.01

    def test_no_conversion_when_unit_none(self) -> None:
        assert convert_to_rule_unit(2600, None, "mm") == 2600.0

    def test_min_unit_passthrough(self) -> None:
        assert convert_to_rule_unit(60, "min", "mm") == 60.0


class TestCanonicalPropertyResolution:
    def test_canonical_wall(self) -> None:
        props = {"elem1": {"_element_type": "wall", "fire_safety": {"fire_rating": "REI60"}}}
        rules_from_fixture = rule_index_fixture()
        rule = rules_from_fixture.get_rule("bbl_4_30_wall_fire_rating")
        assert rule is not None
        result = evaluate(
            properties=props,
            metadata={"source_format": "ifc", "project": {"lengthUnit": "mm"}},
            rules=[rule],
            file_id="test",
        )
        assert any(r.status == "pass" for r in result.details)

    def test_format_gating_skips_ifc_rules_for_pdf(self) -> None:
        props = {"elem1": {"_element_type": "wall", "common": {"is_external": True}}}
        rules_from_fixture = rule_index_fixture()
        rules = rules_from_fixture.get_applicable_rules(framework="bbl")
        result = evaluate(
            properties=props,
            metadata={"source_format": "pdf", "project": {}},
            rules=rules,
            file_id="test",
        )
        assert result.format_coverage is not None
        assert result.format_coverage.source_format == "pdf"
        assert result.format_coverage.rules_skipped_format == len(rules)

    def test_format_coverage_present(self) -> None:
        result = evaluate(
            properties={},
            metadata={"source_format": "ifc", "project": {}},
            rules=[],
            file_id="test",
        )
        assert result.format_coverage is not None
        assert result.format_coverage.source_format == "ifc"


def rule_index_fixture() -> RuleIndex:
    from pathlib import Path
    idx = RuleIndex()
    idx.load(Path(__file__).parent.parent / "rules")
    return idx


class TestRuleLoading:
    def test_loads_rules(self, rule_index: RuleIndex) -> None:
        assert len(rule_index.all_rules) > 0

    def test_all_rules_have_unique_ids(self, rule_index: RuleIndex) -> None:
        ids = [r.id for r in rule_index.all_rules]
        assert len(ids) == len(set(ids))

    def test_filter_by_category(self, rule_index: RuleIndex) -> None:
        fire_rules = rule_index.get_rules(category="fire_safety")
        assert all(r.category == "fire_safety" for r in fire_rules)
        assert len(fire_rules) > 0

    def test_get_applicable_rules(self, rule_index: RuleIndex) -> None:
        rules = rule_index.get_applicable_rules()
        assert all(r.implementation_status == "implemented" for r in rules)

    def test_bbl_implemented_count(self, rule_index: RuleIndex) -> None:
        bbl = rule_index.get_applicable_rules(framework="bbl")
        # Floor reflects the standing catalog of "implemented"-status BBL rules.
        # Bump this when authoring more rules; partial-status rules are excluded
        # by get_applicable_rules.
        assert len(bbl) == 54

    def test_get_rule_by_id(self, rule_index: RuleIndex) -> None:
        rule = rule_index.get_rule("bbl_4_85_room_height_new")
        assert rule is not None
        assert rule.article_number == "4.85"

    def test_get_missing_rule(self, rule_index: RuleIndex) -> None:
        assert rule_index.get_rule("nonexistent") is None


class TestEvaluation:
    def test_full_compliance_check(
        self,
        rule_index: RuleIndex,
        sample_metadata: dict[str, Any],
        sample_properties: dict[str, Any],
    ) -> None:
        rules = rule_index.get_applicable_rules()
        result = evaluate(
            properties=sample_properties,
            metadata=sample_metadata,
            rules=rules,
            file_id="test-file-001",
        )
        assert isinstance(result, ComplianceResult)
        assert result.file_id == "test-file-001"
        assert result.total_rules == len(rules)
        assert result.total_elements_checked > 0
        assert len(result.rules_summary) == len(rules)
        assert len(result.details) > 0

    def test_room_height_pass(
        self,
        rule_index: RuleIndex,
        sample_metadata: dict[str, Any],
        sample_properties: dict[str, Any],
    ) -> None:
        rule = rule_index.get_rule("bbl_4_85_room_height_new")
        assert rule is not None
        result = evaluate(
            properties=sample_properties,
            metadata=sample_metadata,
            rules=[rule],
            file_id="test",
        )
        living_results = [
            r for r in result.details if r.element_global_id == "space-living-001"
        ]
        assert any(r.status == "pass" for r in living_results)

    def test_room_height_fail(
        self,
        rule_index: RuleIndex,
        sample_metadata: dict[str, Any],
        sample_properties: dict[str, Any],
    ) -> None:
        rule = rule_index.get_rule("bbl_4_85_room_height_new")
        assert rule is not None
        result = evaluate(
            properties=sample_properties,
            metadata=sample_metadata,
            rules=[rule],
            file_id="test",
        )
        small_results = [
            r for r in result.details if r.element_global_id == "space-small-003"
        ]
        assert any(r.status == "fail" for r in small_results)

    def test_door_width_fail(
        self,
        rule_index: RuleIndex,
        sample_metadata: dict[str, Any],
        sample_properties: dict[str, Any],
    ) -> None:
        rule = rule_index.get_rule("bbl_4_24_door_width")
        assert rule is not None
        result = evaluate(
            properties=sample_properties,
            metadata=sample_metadata,
            rules=[rule],
            file_id="test",
        )
        narrow_door_results = [
            r
            for r in result.details
            if r.element_global_id == "door-internal-002" and r.status == "fail"
        ]
        assert len(narrow_door_results) > 0

    def test_fire_rating_pass_rei_string(
        self,
        rule_index: RuleIndex,
        sample_metadata: dict[str, Any],
        sample_properties: dict[str, Any],
    ) -> None:
        rule = rule_index.get_rule("bbl_4_30_wall_fire_rating")
        assert rule is not None
        result = evaluate(
            properties=sample_properties,
            metadata=sample_metadata,
            rules=[rule],
            file_id="test",
        )
        ext_wall = [
            r for r in result.details if r.element_global_id == "wall-ext-001"
        ]
        assert any(r.status == "pass" for r in ext_wall)

    def test_fire_rating_fail(
        self,
        rule_index: RuleIndex,
        sample_metadata: dict[str, Any],
        sample_properties: dict[str, Any],
    ) -> None:
        rule = rule_index.get_rule("bbl_4_30_wall_fire_rating")
        assert rule is not None
        result = evaluate(
            properties=sample_properties,
            metadata=sample_metadata,
            rules=[rule],
            file_id="test",
        )
        partition = [
            r for r in result.details if r.element_global_id == "wall-partition-003"
        ]
        assert any(r.status == "fail" for r in partition)

    def test_missing_fire_rating_skips(
        self,
        rule_index: RuleIndex,
        sample_metadata: dict[str, Any],
        sample_properties: dict[str, Any],
    ) -> None:
        rule = rule_index.get_rule("bbl_4_30_wall_fire_rating")
        assert rule is not None
        result = evaluate(
            properties=sample_properties,
            metadata=sample_metadata,
            rules=[rule],
            file_id="test",
        )
        no_rating = [
            r for r in result.details if r.element_global_id == "wall-no-rating-004"
        ]
        assert any(r.status == "skip" for r in no_rating)

    def test_category_summary(
        self,
        rule_index: RuleIndex,
        sample_metadata: dict[str, Any],
        sample_properties: dict[str, Any],
    ) -> None:
        rules = rule_index.get_applicable_rules()
        result = evaluate(
            properties=sample_properties,
            metadata=sample_metadata,
            rules=rules,
            file_id="test",
        )
        categories = {c.category for c in result.category_summary}
        assert "fire_safety" in categories
        assert "usability" in categories

    def test_slab_fire_rating(
        self,
        rule_index: RuleIndex,
        sample_metadata: dict[str, Any],
        sample_properties: dict[str, Any],
    ) -> None:
        rule = rule_index.get_rule("bbl_4_30_slab_fire_rating")
        assert rule is not None
        result = evaluate(
            properties=sample_properties,
            metadata=sample_metadata,
            rules=[rule],
            file_id="test",
        )
        floor_slab = [
            r for r in result.details if r.element_global_id == "slab-floor-001"
        ]
        assert any(r.status == "pass" for r in floor_slab)
        roof_slab = [
            r for r in result.details if r.element_global_id == "slab-roof-002"
        ]
        assert any(r.status == "fail" for r in roof_slab)

    def test_smoke_compartment_rule(
        self,
        rule_index: RuleIndex,
        sample_metadata: dict[str, Any],
        sample_properties: dict[str, Any],
    ) -> None:
        rule = rule_index.get_rule("bbl_4_51_smoke_compartment_wall")
        assert rule is not None
        result = evaluate(
            properties=sample_properties,
            metadata=sample_metadata,
            rules=[rule],
            file_id="test",
        )
        ext_wall = [
            r for r in result.details if r.element_global_id == "wall-ext-001"
        ]
        assert any(r.status == "pass" for r in ext_wall)

        partition = [
            r for r in result.details if r.element_global_id == "wall-partition-003"
        ]
        assert any(r.status == "fail" for r in partition)

    def test_empty_properties(
        self,
        rule_index: RuleIndex,
        sample_metadata: dict[str, Any],
    ) -> None:
        rules = rule_index.get_applicable_rules()
        result = evaluate(
            properties={},
            metadata=sample_metadata,
            rules=rules,
            file_id="test",
        )
        assert result.total_elements_checked == 0
        assert all(rs.total_checked == 0 for rs in result.rules_summary)
