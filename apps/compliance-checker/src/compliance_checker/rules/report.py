from __future__ import annotations

from collections import defaultdict
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from compliance_checker.rules.engine import CheckResult, ComplianceResult
    from compliance_checker.rules.loader import RuleIndex
    from compliance_checker.rules.schema import RuleDefinition

_PASS_ICON = "✅"  # white heavy check mark
_FAIL_ICON = "❌"  # cross mark
_WARN_ICON = "⚠️"  # warning sign
_SKIP_ICON = "-"
_ERROR_ICON = "\U0001f6d1"  # stop sign

_STATUS_ICON = {
    "pass": _PASS_ICON,
    "fail": _FAIL_ICON,
    "warn": _WARN_ICON,
    "skip": _SKIP_ICON,
    "error": _ERROR_ICON,
}

_STATUS_LABEL = {
    "pass": "Satisfied",
    "fail": "Violated",
    "warn": "Warning",
    "skip": "Skipped",
    "error": "Error",
}


def _element_label(detail: CheckResult) -> str:
    name = detail.element_name or detail.element_global_id
    etype = detail.element_type or "?"
    return f"**{name}** (`{detail.element_global_id}`, {etype})"


def _bullet(detail: CheckResult) -> str:
    icon = _STATUS_ICON.get(detail.status, "•")
    label = _STATUS_LABEL.get(detail.status, detail.status)
    reasoning = detail.reasoning

    if reasoning is not None:
        return (
            f"- {icon} {_element_label(detail)}: observed "
            f"{reasoning.observed}. **{label}** — {reasoning.verdict}."
        )
    return f"- {icon} {_element_label(detail)}: {detail.message}"


def _rule_section(rule: RuleDefinition, details: list[CheckResult]) -> str:
    lines: list[str] = []
    nl_title = rule.titles.get("nl") or rule.title_nl or rule.titles.get("en", "")
    en_title = rule.titles.get("en") or rule.title or ""
    lines.append(f"## {rule.article} — {nl_title}")
    lines.append("")
    lines.append(f"*{en_title}*")
    lines.append("")

    if rule.legal_text_nl:
        lines.append(f"> *\"{rule.legal_text_nl}\"*")
        if rule.source_url:
            lines.append(">")
            lines.append(f"> — [wetten.overheid.nl]({rule.source_url})")
        lines.append("")
    elif rule.source_url:
        lines.append(f"Source: [wetten.overheid.nl]({rule.source_url})")
        lines.append("")

    if rule.legal_text_en and rule.legal_text_en != rule.legal_text_nl:
        lines.append(f"> *(EN)* {rule.legal_text_en}")
        lines.append("")

    if rule.requirement_summary:
        lines.append(f"**Requirement:** {rule.requirement_summary}")
        lines.append("")

    counts = _count_statuses(details)
    summary_bits = []
    if counts["pass"]:
        summary_bits.append(f"{counts['pass']} satisfied")
    if counts["fail"]:
        summary_bits.append(f"{counts['fail']} violated")
    if counts["warn"]:
        summary_bits.append(f"{counts['warn']} warnings")
    if counts["skip"]:
        summary_bits.append(f"{counts['skip']} skipped")
    if counts["error"]:
        summary_bits.append(f"{counts['error']} errors")
    if summary_bits:
        lines.append(f"**Result:** {', '.join(summary_bits)}.")
        lines.append("")

    if not details:
        lines.append("_No applicable elements in this model._")
        lines.append("")
        return "\n".join(lines)

    for detail in details:
        lines.append(_bullet(detail))
    lines.append("")
    return "\n".join(lines)


def _count_statuses(details: list[CheckResult]) -> dict[str, int]:
    counts: dict[str, int] = defaultdict(int)
    for d in details:
        counts[d.status] += 1
    return counts


def build_markdown(
    result: ComplianceResult,
    rule_index: RuleIndex,
    *,
    include_passes: bool = True,
    rule_id_filter: str | None = None,
) -> str:
    """Render a ComplianceResult as a narrative Markdown report.

    Sections are grouped by rule. Each section quotes the article text
    (when available) and lists every element with a verdict bullet.
    """
    by_rule: dict[str, list[CheckResult]] = defaultdict(list)
    for detail in result.details:
        if not include_passes and detail.status == "pass":
            continue
        if rule_id_filter and detail.rule_id != rule_id_filter:
            continue
        by_rule[detail.rule_id].append(detail)

    rule_ids = list(by_rule.keys())
    if rule_id_filter and rule_id_filter not in rule_ids:
        rule_ids = [rule_id_filter]

    lines: list[str] = []
    lines.append("# Compliance Report")
    lines.append("")
    lines.append(f"- **File:** `{result.file_id}`")
    if result.framework:
        lines.append(f"- **Framework:** {result.framework.upper()}")
    lines.append(f"- **Checked at:** {result.checked_at}")
    lines.append(f"- **Rules evaluated:** {result.total_rules}")
    lines.append(f"- **Elements inspected:** {result.total_elements_checked}")
    lines.append("")

    if not rule_ids:
        lines.append("_No rule results to report._")
        return "\n".join(lines)

    for rule_id in rule_ids:
        rule = rule_index.get_rule(rule_id)
        if rule is None:
            continue
        lines.append(_rule_section(rule, by_rule.get(rule_id, [])))

    return "\n".join(lines).rstrip() + "\n"


def build_payload(
    result: ComplianceResult,
    rule_index: RuleIndex,
    *,
    include_passes: bool = True,
    rule_id_filter: str | None = None,
) -> dict[str, Any]:
    return {
        "file_id": result.file_id,
        "framework": result.framework,
        "checked_at": result.checked_at,
        "markdown": build_markdown(
            result,
            rule_index,
            include_passes=include_passes,
            rule_id_filter=rule_id_filter,
        ),
    }
