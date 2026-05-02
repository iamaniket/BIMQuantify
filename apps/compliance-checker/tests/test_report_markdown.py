from __future__ import annotations

from typing import TYPE_CHECKING, Any

from compliance_checker.rules.engine import evaluate
from compliance_checker.rules.report import build_markdown, build_payload

if TYPE_CHECKING:
    from compliance_checker.rules.loader import RuleIndex


def _result_for(rule_id: str, rule_index, metadata, properties):
    rule = rule_index.get_rule(rule_id)
    assert rule is not None
    return evaluate(
        properties=properties,
        metadata=metadata,
        rules=[rule],
        file_id="report-test",
    )


def test_markdown_has_section_header(
    rule_index: RuleIndex,
    sample_metadata: dict[str, Any],
    sample_properties: dict[str, Any],
) -> None:
    result = _result_for(
        "bbl_4_27_stair_riser_height", rule_index, sample_metadata, sample_properties
    )
    md = build_markdown(result, rule_index)
    assert "# Compliance Report" in md
    assert "BBL Afd. 4.5, Art. 4.27" in md
    assert "## " in md


def test_markdown_quotes_legal_text(
    rule_index: RuleIndex,
    sample_metadata: dict[str, Any],
    sample_properties: dict[str, Any],
) -> None:
    result = _result_for(
        "bbl_4_18_railing_height", rule_index, sample_metadata, sample_properties
    )
    md = build_markdown(result, rule_index)
    rule = rule_index.get_rule("bbl_4_18_railing_height")
    assert rule is not None and rule.legal_text_nl is not None
    snippet = rule.legal_text_nl[:30]
    assert snippet in md
    assert "wetten.overheid.nl" in md


def test_markdown_includes_pass_and_fail_icons(
    rule_index: RuleIndex,
    sample_metadata: dict[str, Any],
    sample_properties: dict[str, Any],
) -> None:
    result = _result_for(
        "bbl_4_28_ramp_slope", rule_index, sample_metadata, sample_properties
    )
    md = build_markdown(result, rule_index)
    assert "✅" in md
    assert "❌" in md
    assert "Satisfied" in md
    assert "Violated" in md


def test_markdown_respects_include_passes_false(
    rule_index: RuleIndex,
    sample_metadata: dict[str, Any],
    sample_properties: dict[str, Any],
) -> None:
    result = _result_for(
        "bbl_4_28_ramp_slope", rule_index, sample_metadata, sample_properties
    )
    md_no_passes = build_markdown(result, rule_index, include_passes=False)
    assert "✅" not in md_no_passes
    assert "❌" in md_no_passes


def test_markdown_filters_by_rule_id(
    rule_index: RuleIndex,
    sample_metadata: dict[str, Any],
    sample_properties: dict[str, Any],
) -> None:
    rules = rule_index.get_applicable_rules(framework="bbl")
    result = evaluate(
        properties=sample_properties,
        metadata=sample_metadata,
        rules=rules,
        file_id="multi",
    )
    md = build_markdown(
        result, rule_index, rule_id_filter="bbl_4_27_stair_riser_height"
    )
    assert "Art. 4.27" in md
    assert "Art. 4.85" not in md
    assert "Art. 4.30" not in md


def test_payload_shape(
    rule_index: RuleIndex,
    sample_metadata: dict[str, Any],
    sample_properties: dict[str, Any],
) -> None:
    result = _result_for(
        "bbl_4_27_stair_riser_height", rule_index, sample_metadata, sample_properties
    )
    payload = build_payload(result, rule_index)
    assert set(payload.keys()) == {"file_id", "framework", "checked_at", "markdown"}
    assert payload["file_id"] == "report-test"
    assert isinstance(payload["markdown"], str)
    assert payload["markdown"].startswith("# Compliance Report")
