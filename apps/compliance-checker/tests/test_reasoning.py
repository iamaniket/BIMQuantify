from __future__ import annotations

from typing import TYPE_CHECKING, Any

from compliance_checker.rules.engine import evaluate

if TYPE_CHECKING:
    from compliance_checker.rules.loader import RuleIndex


def test_pass_result_has_reasoning(
    rule_index: RuleIndex,
    sample_metadata: dict[str, Any],
    sample_properties: dict[str, Any],
) -> None:
    rule = rule_index.get_rule("bbl_4_27_stair_riser_height")
    assert rule is not None
    result = evaluate(
        properties=sample_properties,
        metadata=sample_metadata,
        rules=[rule],
        file_id="test",
    )
    pass_results = [r for r in result.details if r.status == "pass"]
    assert pass_results
    r = pass_results[0]
    assert r.reasoning is not None
    assert r.reasoning.article_number == "4.27"
    assert "≤" in r.reasoning.verdict or "Satisfied" in r.reasoning.verdict
    assert "Satisfied" in r.reasoning.verdict
    assert r.reasoning.legal_text_nl is not None


def test_fail_result_has_reasoning_with_inverted_symbol(
    rule_index: RuleIndex,
    sample_metadata: dict[str, Any],
    sample_properties: dict[str, Any],
) -> None:
    rule = rule_index.get_rule("bbl_4_27_stair_riser_height")
    assert rule is not None
    result = evaluate(
        properties=sample_properties,
        metadata=sample_metadata,
        rules=[rule],
        file_id="test",
    )
    fail_results = [r for r in result.details if r.status == "fail"]
    assert fail_results
    r = fail_results[0]
    assert r.reasoning is not None
    assert "Violated" in r.reasoning.verdict
    # rule operator is lte (≤); violation means observed > threshold
    assert ">" in r.reasoning.verdict


def test_skip_has_no_reasoning(
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
    skipped = [r for r in result.details if r.status == "skip"]
    assert skipped
    assert all(r.reasoning is None for r in skipped)


def test_warn_result_has_reasoning(
    rule_index: RuleIndex,
    sample_metadata: dict[str, Any],
    sample_properties: dict[str, Any],
) -> None:
    rule = rule_index.get_rule("bbl_4_105_elevator_presence")
    assert rule is not None
    result = evaluate(
        properties=sample_properties,
        metadata=sample_metadata,
        rules=[rule],
        file_id="test",
    )
    pass_or_warn = [r for r in result.details if r.status in ("pass", "warn")]
    assert pass_or_warn
    for r in pass_or_warn:
        assert r.reasoning is not None
        assert r.reasoning.article_number == "4.105"


def test_reasoning_includes_source_url(
    rule_index: RuleIndex,
    sample_metadata: dict[str, Any],
    sample_properties: dict[str, Any],
) -> None:
    rule = rule_index.get_rule("bbl_4_28_ramp_slope")
    assert rule is not None
    result = evaluate(
        properties=sample_properties,
        metadata=sample_metadata,
        rules=[rule],
        file_id="test",
    )
    decided = [r for r in result.details if r.reasoning is not None]
    assert decided
    assert any(
        r.reasoning is not None
        and r.reasoning.source_url is not None
        and "wetten.overheid.nl" in r.reasoning.source_url
        for r in decided
    )


def test_legacy_rule_has_reasoning_without_legal_text(
    rule_index: RuleIndex,
    sample_metadata: dict[str, Any],
    sample_properties: dict[str, Any],
) -> None:
    """Existing rules without legal_text_nl should still get reasoning."""
    rule = rule_index.get_rule("bbl_4_85_room_height_new")
    assert rule is not None
    result = evaluate(
        properties=sample_properties,
        metadata=sample_metadata,
        rules=[rule],
        file_id="test",
    )
    decided = [r for r in result.details if r.status in ("pass", "fail")]
    assert decided
    assert all(r.reasoning is not None for r in decided)
    assert all(r.reasoning.article_number == "4.85" for r in decided if r.reasoning)
