from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any, Literal

from pydantic import BaseModel

from compliance_checker.rules.schema import (
    ApplicabilityFilter,
    Operator,
    PropertyCheck,
    RuleDefinition,
    Severity,
)

PSET_TO_IFC_TYPE: dict[str, str] = {
    "Pset_WallCommon": "IfcWall",
    "Pset_SlabCommon": "IfcSlab",
    "Pset_DoorCommon": "IfcDoor",
    "Pset_WindowCommon": "IfcWindow",
    "Pset_SpaceCommon": "IfcSpace",
    "Pset_ColumnCommon": "IfcColumn",
    "Pset_BeamCommon": "IfcBeam",
    "Pset_StairCommon": "IfcStair",
    "Pset_StairFlightCommon": "IfcStairFlight",
    "Pset_RoofCommon": "IfcRoof",
    "Pset_RampCommon": "IfcRamp",
    "Pset_RampFlightCommon": "IfcRampFlight",
    "Pset_CoveringCommon": "IfcCovering",
    "Pset_CurtainWallCommon": "IfcCurtainWall",
    "Pset_RailingCommon": "IfcRailing",
    "Pset_PlateCommon": "IfcPlate",
    "Pset_MemberCommon": "IfcMember",
    "Pset_BuildingStoreyCommon": "IfcBuildingStorey",
    "Pset_TransportElementCommon": "IfcTransportElement",
    "Qto_WallBaseQuantities": "IfcWall",
    "Qto_SlabBaseQuantities": "IfcSlab",
    "Qto_DoorBaseQuantities": "IfcDoor",
    "Qto_WindowBaseQuantities": "IfcWindow",
    "Qto_SpaceBaseQuantities": "IfcSpace",
}


_OPERATOR_SYMBOL: dict[Operator, str] = {
    Operator.gte: "≥",
    Operator.gt: ">",
    Operator.lte: "≤",
    Operator.lt: "<",
    Operator.eq: "=",
    Operator.neq: "≠",
    Operator.contains: "contains",
    Operator.matches: "matches",
    Operator.exists: "is present",
    Operator.in_list: "in",
}


class CheckReasoning(BaseModel):
    article_number: str
    article_full: str
    legal_text_nl: str | None = None
    legal_text_en: str | None = None
    requirement: str
    observed: str
    verdict: str
    source_url: str | None = None


class CheckResult(BaseModel):
    rule_id: str
    article: str
    element_global_id: str
    element_type: str | None = None
    element_name: str | None = None
    status: Literal["pass", "fail", "warn", "skip", "error"]
    message: str
    actual_value: str | float | int | bool | None = None
    expected_value: str | float | int | bool | None = None
    property_set: str | None = None
    property_name: str | None = None
    severity: Severity
    reasoning: CheckReasoning | None = None


class RuleSummary(BaseModel):
    rule_id: str
    article: str
    titles: dict[str, str]
    title: str | None = None
    title_nl: str | None = None
    category: str
    severity: str
    total_checked: int
    passed: int
    failed: int
    warned: int
    skipped: int
    errors: int


class CategorySummary(BaseModel):
    category: str
    total_rules: int
    total_checks: int
    passed: int
    failed: int
    warned: int


class ComplianceResult(BaseModel):
    file_id: str
    framework: str | None = None
    checked_at: str
    total_rules: int
    total_elements_checked: int
    rules_summary: list[RuleSummary]
    details: list[CheckResult]
    category_summary: list[CategorySummary]


def infer_element_type(
    element_props: dict[str, dict[str, Any]],
) -> str | None:
    for pset_name in element_props:
        if pset_name in PSET_TO_IFC_TYPE:
            return PSET_TO_IFC_TYPE[pset_name]
    return None


_FIRE_RATING_RE = re.compile(r"(\d+)")


def parse_fire_rating_minutes(value: Any) -> float | None:
    if isinstance(value, int | float):
        return float(value)
    if isinstance(value, str):
        match = _FIRE_RATING_RE.search(value)
        if match:
            return float(match.group(1))
    return None


_UNIT_TO_MM: dict[str, float] = {
    "m": 1000.0,
    "metre": 1000.0,
    "meter": 1000.0,
    "cm": 10.0,
    "mm": 1.0,
    "ft": 304.8,
    "in": 25.4,
    "inch": 25.4,
}

_UNIT_TO_M2: dict[str, float] = {
    "m2": 1.0,
    "m²": 1.0,
    "mm2": 1e-6,
    "mm²": 1e-6,
    "cm2": 1e-4,
    "cm²": 1e-4,
    "ft2": 0.092903,
    "ft²": 0.092903,
}


def convert_to_rule_unit(
    value: float,
    rule_unit: str | None,
    model_length_unit: str | None,
) -> float:
    if rule_unit is None or model_length_unit is None:
        return value

    rule_unit_lower = rule_unit.lower()
    model_unit_lower = model_length_unit.lower()

    if rule_unit_lower == "mm":
        factor = _UNIT_TO_MM.get(model_unit_lower)
        if factor is not None:
            return value * factor
    elif rule_unit_lower in ("m2", "m²"):
        factor = _UNIT_TO_M2.get(model_unit_lower)
        if factor is not None:
            return value * factor
    elif rule_unit_lower == "min":
        return value

    return value


def _evaluate_check(
    value: Any,
    check: PropertyCheck,
) -> bool:
    if check.operator == Operator.exists:
        return value is not None

    if value is None:
        return False

    threshold = check.threshold

    if check.property_name in ("FireRating",) and isinstance(value, str):
        parsed = parse_fire_rating_minutes(value)
        if parsed is None:
            return False
        value = parsed

    if isinstance(threshold, str) and check.operator in (
        Operator.gte,
        Operator.gt,
        Operator.lte,
        Operator.lt,
    ):
        try:
            threshold = float(threshold)
        except ValueError:
            return False

    if isinstance(value, str) and isinstance(threshold, float | int):
        try:
            value = float(value)
        except ValueError:
            return False

    if check.operator == Operator.gte:
        return float(value) >= float(threshold)  # type: ignore[arg-type]
    if check.operator == Operator.gt:
        return float(value) > float(threshold)  # type: ignore[arg-type]
    if check.operator == Operator.lte:
        return float(value) <= float(threshold)  # type: ignore[arg-type]
    if check.operator == Operator.lt:
        return float(value) < float(threshold)  # type: ignore[arg-type]
    if check.operator == Operator.eq:
        return value == threshold
    if check.operator == Operator.neq:
        return value != threshold
    if check.operator == Operator.contains:
        return isinstance(value, str) and isinstance(threshold, str) and threshold in value
    if check.operator == Operator.matches:
        return isinstance(value, str) and isinstance(threshold, str) and bool(
            re.search(threshold, value)
        )
    if check.operator == Operator.in_list:
        return isinstance(threshold, list) and str(value) in threshold

    return False


def _filter_passes(
    element_psets: dict[str, Any],
    flt: ApplicabilityFilter,
) -> bool:
    pset = element_psets.get(flt.property_set)
    if not isinstance(pset, dict):
        return False
    raw = pset.get(flt.property_name)
    proxy = PropertyCheck(
        property_set=flt.property_set,
        property_name=flt.property_name,
        operator=flt.operator,
        threshold=flt.value,
    )
    try:
        return _evaluate_check(raw, proxy)
    except Exception:
        return False


def _format_value(value: Any) -> str:
    if isinstance(value, float):
        if value.is_integer():
            return str(int(value))
        return f"{value:g}"
    if isinstance(value, bool):
        return "true" if value else "false"
    if value is None:
        return "—"
    return str(value)


def _build_reasoning(
    rule: RuleDefinition,
    check: PropertyCheck,
    actual_value: Any,
    passed: bool,
    *,
    converted_for_unit: bool,
) -> CheckReasoning:
    symbol = _OPERATOR_SYMBOL.get(check.operator, check.operator.value)
    unit_suffix = f" {check.unit}" if check.unit else ""

    if check.operator == Operator.exists:
        requirement = (
            f"{check.property_set}.{check.property_name} must be present"
        )
        observed_label = "present" if actual_value is not None else "missing"
        observed = (
            f"{check.property_set}.{check.property_name} = {observed_label}"
        )
        verdict = "Satisfied: property present" if passed else "Violated: property missing"
    else:
        threshold_str = _format_value(check.threshold)
        actual_str = _format_value(actual_value)
        requirement = (
            f"{check.property_set}.{check.property_name} {symbol} "
            f"{threshold_str}{unit_suffix}"
        )
        observed_unit = unit_suffix if converted_for_unit else ""
        observed = (
            f"{check.property_set}.{check.property_name} = {actual_str}"
            f"{observed_unit}"
        )
        if passed:
            verdict = f"Satisfied: {actual_str} {symbol} {threshold_str}"
        else:
            inverse = {
                "≥": "<",
                ">": "≤",
                "≤": ">",
                "<": "≥",
                "=": "≠",
                "≠": "=",
            }.get(symbol, f"not {symbol}")
            verdict = f"Violated: {actual_str} {inverse} {threshold_str}"

    return CheckReasoning(
        article_number=rule.article_number,
        article_full=rule.article,
        legal_text_nl=rule.legal_text_nl,
        legal_text_en=rule.legal_text_en,
        requirement=rule.requirement_summary or requirement,
        observed=observed,
        verdict=verdict,
        source_url=rule.source_url,
    )


def evaluate(
    *,
    properties: dict[str, Any],
    metadata: dict[str, Any],
    rules: list[RuleDefinition],
    file_id: str,
    framework: str | None = None,
) -> ComplianceResult:
    model_length_unit = (
        metadata.get("project", {}).get("lengthUnit")
        if isinstance(metadata, dict)
        else None
    )

    all_results: list[CheckResult] = []
    rule_summaries: list[RuleSummary] = []
    checked_elements: set[str] = set()

    for rule in rules:
        passed_count = 0
        failed = 0
        warned = 0
        skipped = 0
        errors = 0

        for element_gid, element_psets in properties.items():
            if not isinstance(element_psets, dict):
                continue

            element_type = infer_element_type(element_psets)

            if element_type not in rule.applicable_ifc_entities:
                continue

            if rule.applicability_filters and not all(
                _filter_passes(element_psets, flt)
                for flt in rule.applicability_filters
            ):
                continue

            checked_elements.add(element_gid)

            for check in rule.checks:
                pset_data = element_psets.get(check.property_set)
                if not isinstance(pset_data, dict):
                    skipped += 1
                    all_results.append(
                        CheckResult(
                            rule_id=rule.id,
                            article=rule.article,
                            element_global_id=element_gid,
                            element_type=element_type,
                            status="skip",
                            message=f"Property set '{check.property_set}' not found",
                            property_set=check.property_set,
                            property_name=check.property_name,
                            severity=rule.severity,
                        )
                    )
                    continue

                raw_value = pset_data.get(check.property_name)
                if raw_value is None and check.operator != Operator.exists:
                    skipped += 1
                    all_results.append(
                        CheckResult(
                            rule_id=rule.id,
                            article=rule.article,
                            element_global_id=element_gid,
                            element_type=element_type,
                            status="skip",
                            message=f"Property '{check.property_name}' not found in '{check.property_set}'",
                            property_set=check.property_set,
                            property_name=check.property_name,
                            severity=rule.severity,
                        )
                    )
                    continue

                actual_value = raw_value
                converted_for_unit = False
                if (
                    isinstance(raw_value, int | float)
                    and check.unit is not None
                    and check.unit.lower() != "min"
                ):
                    actual_value = convert_to_rule_unit(
                        float(raw_value), check.unit, model_length_unit
                    )
                    converted_for_unit = True

                try:
                    check_ok = _evaluate_check(actual_value, check)
                except Exception:
                    errors += 1
                    all_results.append(
                        CheckResult(
                            rule_id=rule.id,
                            article=rule.article,
                            element_global_id=element_gid,
                            element_type=element_type,
                            status="error",
                            message="Evaluation error",
                            actual_value=str(raw_value),
                            expected_value=str(check.threshold),
                            property_set=check.property_set,
                            property_name=check.property_name,
                            severity=rule.severity,
                        )
                    )
                    continue

                reasoning = _build_reasoning(
                    rule,
                    check,
                    actual_value,
                    check_ok,
                    converted_for_unit=converted_for_unit,
                )

                if check_ok:
                    passed_count += 1
                    all_results.append(
                        CheckResult(
                            rule_id=rule.id,
                            article=rule.article,
                            element_global_id=element_gid,
                            element_type=element_type,
                            status="pass",
                            message=f"{check.property_name} = {actual_value} meets requirement",
                            actual_value=actual_value if not isinstance(actual_value, dict) else str(actual_value),
                            expected_value=check.threshold if not isinstance(check.threshold, list) else str(check.threshold),
                            property_set=check.property_set,
                            property_name=check.property_name,
                            severity=rule.severity,
                            reasoning=reasoning,
                        )
                    )
                else:
                    if rule.severity == Severity.warning:
                        warned += 1
                        status: Literal["pass", "fail", "warn", "skip", "error"] = "warn"
                    else:
                        failed += 1
                        status = "fail"

                    all_results.append(
                        CheckResult(
                            rule_id=rule.id,
                            article=rule.article,
                            element_global_id=element_gid,
                            element_type=element_type,
                            status=status,
                            message=f"{check.property_name} = {actual_value}, required {check.operator} {check.threshold}",
                            actual_value=actual_value if not isinstance(actual_value, dict) else str(actual_value),
                            expected_value=check.threshold if not isinstance(check.threshold, list) else str(check.threshold),
                            property_set=check.property_set,
                            property_name=check.property_name,
                            severity=rule.severity,
                            reasoning=reasoning,
                        )
                    )

        rule_summaries.append(
            RuleSummary(
                rule_id=rule.id,
                article=rule.article,
                titles=rule.titles,
                title=rule.title,
                title_nl=rule.title_nl,
                category=rule.category,
                severity=rule.severity,
                total_checked=passed_count + failed + warned + skipped + errors,
                passed=passed_count,
                failed=failed,
                warned=warned,
                skipped=skipped,
                errors=errors,
            )
        )

    cat_map: dict[str, CategorySummary] = {}
    for rs in rule_summaries:
        if rs.category not in cat_map:
            cat_map[rs.category] = CategorySummary(
                category=rs.category,
                total_rules=0,
                total_checks=0,
                passed=0,
                failed=0,
                warned=0,
            )
        cs = cat_map[rs.category]
        cs.total_rules += 1
        cs.total_checks += rs.total_checked
        cs.passed += rs.passed
        cs.failed += rs.failed
        cs.warned += rs.warned

    return ComplianceResult(
        file_id=file_id,
        framework=framework,
        checked_at=datetime.now(timezone.utc).isoformat(),
        total_rules=len(rules),
        total_elements_checked=len(checked_elements),
        rules_summary=rule_summaries,
        details=all_results,
        category_summary=list(cat_map.values()),
    )
