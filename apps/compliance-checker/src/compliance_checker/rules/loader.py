from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING

import yaml

from compliance_checker.rules.schema import (
    ImplementationStatus,
    RegulationFramework,
    RuleFile,
)

if TYPE_CHECKING:
    from compliance_checker.rules.schema import RuleDefinition

_FRAMEWORK_VALUES = {f.value for f in RegulationFramework}


class RuleIndex:
    """In-memory index of compliance rules loaded from YAML files."""

    def __init__(self) -> None:
        self._rules: dict[str, RuleDefinition] = {}

    def load(self, rules_dir: Path) -> None:
        self._rules.clear()
        for yaml_path in sorted(rules_dir.rglob("*.yaml")):
            if yaml_path.name == "manifest.yaml":
                continue
            raw = yaml.safe_load(yaml_path.read_text(encoding="utf-8"))
            if raw is None:
                continue

            inferred_fw = self._infer_framework(yaml_path, rules_dir)
            if inferred_fw and "framework" not in raw:
                raw["framework"] = inferred_fw

            rule_file = RuleFile.model_validate(raw)
            for rule in rule_file.rules:
                if rule.id in self._rules:
                    raise ValueError(
                        f"Duplicate rule id '{rule.id}' in {yaml_path} "
                        f"(first seen in rules index)"
                    )
                self._rules[rule.id] = rule

    @staticmethod
    def _infer_framework(yaml_path: Path, rules_dir: Path) -> str | None:
        try:
            rel = yaml_path.relative_to(rules_dir)
        except ValueError:
            return None
        if rel.parts:
            first_dir = rel.parts[0]
            if first_dir in _FRAMEWORK_VALUES:
                return first_dir
        return None

    @property
    def all_rules(self) -> list[RuleDefinition]:
        return list(self._rules.values())

    def get_rule(self, rule_id: str) -> RuleDefinition | None:
        return self._rules.get(rule_id)

    def get_rules(
        self,
        *,
        framework: str | None = None,
        category: str | None = None,
        chapter: str | None = None,
        status: ImplementationStatus | str | None = None,
    ) -> list[RuleDefinition]:
        result = self.all_rules
        if framework is not None:
            result = [r for r in result if r.framework == framework]
        if category is not None:
            result = [r for r in result if r.category == category]
        if chapter is not None:
            result = [r for r in result if r.chapter == chapter]
        if status is not None:
            result = [r for r in result if r.implementation_status == status]
        return result

    def get_applicable_rules(
        self,
        *,
        framework: str | None = None,
        building_type: str = "all",
        categories: list[str] | None = None,
    ) -> list[RuleDefinition]:
        rules = self.get_rules(
            framework=framework,
            status=ImplementationStatus.implemented,
        )
        if categories:
            rules = [r for r in rules if r.category in categories]
        if building_type != "all":
            rules = [
                r
                for r in rules
                if "all" in r.applicable_building_types
                or building_type in r.applicable_building_types
            ]
        return rules
