"""Building-type rule filtering (get_applicable_rules).

After aligning the rule vocabulary to the API's neutral codes, dwelling-specific
BBL rules are tagged `dwelling` (formerly `residential`). A project's building
type now narrows the applicable rule set: dwelling-only rules apply to dwelling
projects and `all`-tagged rules apply everywhere.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from arbiter.rules.loader import RuleIndex

# A BBL rule scoped to the woonfunctie (dwelling) — renamed from `residential`.
_DWELLING_RULE = "bbl_4_88_storage_room_area"


def _ids(rule_index: RuleIndex, building_type: str) -> set[str]:
    return {
        r.id
        for r in rule_index.get_applicable_rules(
            framework="bbl", building_type=building_type
        )
    }


def test_dwelling_rule_uses_neutral_code(rule_index: RuleIndex) -> None:
    """The storage-room rule is tagged with the API code `dwelling`."""
    rule = rule_index.get_rule(_DWELLING_RULE)
    assert rule is not None
    assert "dwelling" in rule.applicable_building_types
    assert "residential" not in rule.applicable_building_types


def test_dwelling_project_gets_dwelling_rule(rule_index: RuleIndex) -> None:
    assert _DWELLING_RULE in _ids(rule_index, "dwelling")


def test_office_project_excludes_dwelling_rule(rule_index: RuleIndex) -> None:
    office = _ids(rule_index, "office")
    assert _DWELLING_RULE not in office
    # Universal (`all`) rules still apply to office projects.
    assert len(office) > 0


def test_all_includes_dwelling_rule(rule_index: RuleIndex) -> None:
    """building_type='all' applies every implemented rule (no narrowing)."""
    all_rules = _ids(rule_index, "all")
    assert _DWELLING_RULE in all_rules
    assert _ids(rule_index, "office") < all_rules
