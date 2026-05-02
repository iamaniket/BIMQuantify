from __future__ import annotations

import json
import logging
from typing import Any

from mcp.server.fastmcp import FastMCP

from compliance_checker.config import get_settings
from compliance_checker.rules.engine import evaluate
from compliance_checker.rules.loader import RuleIndex
from compliance_checker.rules.report import build_payload
from compliance_checker.storage import ArtifactReader
from compliance_checker.sync.scheduler import get_sync_status, run_sync, start_scheduler

logger = logging.getLogger("compliance_checker")

settings = get_settings()

mcp = FastMCP(
    "compliance-checker",
    host=settings.host,
    port=settings.port,
    json_response=True,
    stateless_http=True,
)

rule_index = RuleIndex()
rule_index.load(settings.rules_path)
logger.info("Loaded %d compliance rules", len(rule_index.all_rules))

artifact_reader = ArtifactReader(settings)


# ── Tools ──────────────────────────────────────────────────────────────


@mcp.tool()
def list_rules(
    framework: str | None = None,
    category: str | None = None,
    chapter: str | None = None,
    status: str | None = None,
) -> list[dict[str, Any]]:
    """List compliance rules with their implementation status.

    Args:
        framework: Filter by regulation framework (bbl, wkb). Default: all frameworks.
        category: Filter by category (e.g. fire_safety, usability, completeness, documentation)
        chapter: Filter by chapter number
        status: Filter by implementation status (implemented, partial, planned, not_automatable, repealed)
    """
    rules = rule_index.get_rules(
        framework=framework, category=category, chapter=chapter, status=status,
    )
    return [
        {
            "id": r.id,
            "framework": r.framework,
            "article": r.article,
            "article_number": r.article_number,
            "title": r.title,
            "title_nl": r.title_nl,
            "category": r.category,
            "chapter": r.chapter,
            "severity": r.severity.value,
            "implementation_status": r.implementation_status.value,
        }
        for r in rules
    ]


@mcp.tool()
def get_rule_details(rule_id: str) -> dict[str, Any]:
    """Get the full definition of a specific compliance rule including its checks.

    Args:
        rule_id: The unique rule identifier (e.g. bbl_4_85_room_height, wkb_2_01_wall_classification)
    """
    rule = rule_index.get_rule(rule_id)
    if rule is None:
        return {"error": f"Rule '{rule_id}' not found"}
    return rule.model_dump(mode="json")


@mcp.tool()
async def check_compliance(
    metadata_key: str,
    properties_key: str,
    file_id: str,
    building_type: str = "all",
    categories: str | None = None,
    framework: str | None = None,
) -> dict[str, Any]:
    """Run applicable compliance rules against a model's extracted data.

    Reads metadata.json and properties.json from S3 storage, evaluates
    all implemented rules for the chosen framework, and returns structured results.

    Args:
        metadata_key: S3 storage key for the metadata.json artifact
        properties_key: S3 storage key for the properties.json artifact
        file_id: UUID of the ProjectFile being checked
        building_type: Building usage type for rule filtering (default: all)
        categories: Comma-separated list of categories to check (default: all)
        framework: Regulation framework to check (bbl, wkb). Default: all frameworks.
    """
    metadata = await artifact_reader.get_json(metadata_key)
    properties = await artifact_reader.get_json(properties_key)

    category_list = categories.split(",") if categories else None

    applicable_rules = rule_index.get_applicable_rules(
        framework=framework,
        building_type=building_type,
        categories=category_list,
    )

    if not isinstance(metadata, dict) or not isinstance(properties, dict):
        return {"error": "Invalid artifact format: expected JSON objects"}

    result = evaluate(
        properties=properties,
        metadata=metadata,
        rules=applicable_rules,
        file_id=file_id,
        framework=framework,
    )
    return result.model_dump(mode="json")


@mcp.tool()
async def check_rule(
    rule_id: str,
    metadata_key: str,
    properties_key: str,
    file_id: str,
) -> dict[str, Any]:
    """Run a specific compliance rule against a model's extracted data.

    Args:
        rule_id: The unique rule identifier to check
        metadata_key: S3 storage key for the metadata.json artifact
        properties_key: S3 storage key for the properties.json artifact
        file_id: UUID of the ProjectFile being checked
    """
    rule = rule_index.get_rule(rule_id)
    if rule is None:
        return {"error": f"Rule '{rule_id}' not found"}

    metadata = await artifact_reader.get_json(metadata_key)
    properties = await artifact_reader.get_json(properties_key)

    if not isinstance(metadata, dict) or not isinstance(properties, dict):
        return {"error": "Invalid artifact format: expected JSON objects"}

    result = evaluate(
        properties=properties,
        metadata=metadata,
        rules=[rule],
        file_id=file_id,
        framework=rule.framework,
    )
    return result.model_dump(mode="json")


@mcp.tool()
async def get_compliance_report(
    metadata_key: str,
    properties_key: str,
    file_id: str,
    report_format: str = "summary",
    framework: str | None = None,
) -> dict[str, Any]:
    """Get a formatted compliance report for a model.

    Args:
        metadata_key: S3 storage key for the metadata.json artifact
        properties_key: S3 storage key for the properties.json artifact
        file_id: UUID of the ProjectFile being checked
        report_format: Report detail level - summary, detailed, or issues_only
        framework: Regulation framework to check (bbl, wkb). Default: all frameworks.
    """
    metadata = await artifact_reader.get_json(metadata_key)
    properties = await artifact_reader.get_json(properties_key)

    if not isinstance(metadata, dict) or not isinstance(properties, dict):
        return {"error": "Invalid artifact format: expected JSON objects"}

    applicable_rules = rule_index.get_applicable_rules(framework=framework)

    result = evaluate(
        properties=properties,
        metadata=metadata,
        rules=applicable_rules,
        file_id=file_id,
        framework=framework,
    )

    if report_format == "issues_only":
        issues = [d for d in result.details if d.status in ("fail", "warn")]
        return {
            "file_id": result.file_id,
            "framework": result.framework,
            "checked_at": result.checked_at,
            "total_issues": len(issues),
            "issues": [i.model_dump(mode="json") for i in issues],
        }

    if report_format == "detailed":
        return result.model_dump(mode="json")

    if report_format == "narrative":
        return build_payload(result, rule_index)

    return {
        "file_id": result.file_id,
        "framework": result.framework,
        "checked_at": result.checked_at,
        "total_rules": result.total_rules,
        "total_elements_checked": result.total_elements_checked,
        "category_summary": [c.model_dump(mode="json") for c in result.category_summary],
        "rules_summary": [r.model_dump(mode="json") for r in result.rules_summary],
    }


@mcp.tool()
async def explain_compliance(
    metadata_key: str,
    properties_key: str,
    file_id: str,
    framework: str | None = None,
    rule_id: str | None = None,
    include_passes: bool = True,
) -> dict[str, Any]:
    """Markdown narrative explaining each rule's verdict per element.

    Each rule section quotes the article text (when stored on the rule)
    and renders one bullet per checked element with a satisfied/violated
    verdict and the observed value.

    Args:
        metadata_key: S3 storage key for the metadata.json artifact
        properties_key: S3 storage key for the properties.json artifact
        file_id: UUID of the ProjectFile being checked
        framework: Regulation framework filter (bbl, wkb). Default: all.
        rule_id: Restrict the report to a single rule id. Default: all rules.
        include_passes: Include passing elements (default True). Set to False
                        for a violations-only narrative.
    """
    metadata = await artifact_reader.get_json(metadata_key)
    properties = await artifact_reader.get_json(properties_key)

    if not isinstance(metadata, dict) or not isinstance(properties, dict):
        return {"error": "Invalid artifact format: expected JSON objects"}

    effective_framework: str | None
    if rule_id is not None:
        rule = rule_index.get_rule(rule_id)
        if rule is None:
            return {"error": f"Rule '{rule_id}' not found"}
        applicable_rules = [rule]
        effective_framework = framework or str(rule.framework)
    else:
        applicable_rules = rule_index.get_applicable_rules(framework=framework)
        effective_framework = framework

    result = evaluate(
        properties=properties,
        metadata=metadata,
        rules=applicable_rules,
        file_id=file_id,
        framework=effective_framework,
    )
    return build_payload(
        result,
        rule_index,
        include_passes=include_passes,
        rule_id_filter=rule_id,
    )


# ── Resources ──────────────────────────────────────────────────────────


@mcp.resource("compliance://{framework}/rules/{category}")
def rules_by_framework_category(framework: str, category: str) -> str:
    """Get all rule definitions for a specific framework and category."""
    rules = rule_index.get_rules(framework=framework, category=category)
    return json.dumps(
        [r.model_dump(mode="json") for r in rules],
        indent=2,
        ensure_ascii=False,
    )


@mcp.resource("compliance://{framework}/rules/article/{article_number}")
def rule_by_framework_article(framework: str, article_number: str) -> str:
    """Get rule definitions for a specific framework and article number."""
    rules = [
        r for r in rule_index.get_rules(framework=framework)
        if r.article_number == article_number
    ]
    return json.dumps(
        [r.model_dump(mode="json") for r in rules],
        indent=2,
        ensure_ascii=False,
    )


@mcp.resource("compliance://{framework}/status")
def framework_status(framework: str) -> str:
    """Get the implementation status of rules for a specific framework."""
    rules = rule_index.get_rules(framework=framework)
    return _build_status_json(rules)


@mcp.resource("compliance://status")
def overall_status() -> str:
    """Get the implementation status of all compliance rules across frameworks."""
    rules = rule_index.all_rules
    by_framework: dict[str, int] = {}
    for r in rules:
        by_framework[r.framework] = by_framework.get(r.framework, 0) + 1
    status_data = json.loads(_build_status_json(rules))
    status_data["by_framework"] = by_framework
    return json.dumps(status_data, indent=2)


# backward-compat aliases
@mcp.resource("bbl://rules/{category}")
def bbl_rules_by_category(category: str) -> str:
    """Get all BBL rule definitions for a specific category (legacy URI)."""
    return rules_by_framework_category("bbl", category)


@mcp.resource("bbl://rules/article/{article_number}")
def bbl_rule_by_article(article_number: str) -> str:
    """Get BBL rule definitions for a specific article number (legacy URI)."""
    return rule_by_framework_article("bbl", article_number)


@mcp.resource("bbl://status")
def bbl_status() -> str:
    """Get the implementation status of BBL rules (legacy URI)."""
    return framework_status("bbl")


def _build_status_json(rules: list[Any]) -> str:
    by_status: dict[str, int] = {}
    by_category: dict[str, dict[str, int]] = {}
    for r in rules:
        st = r.implementation_status if isinstance(r.implementation_status, str) else r.implementation_status.value
        by_status[st] = by_status.get(st, 0) + 1
        cat = r.category if isinstance(r.category, str) else r.category.value
        if cat not in by_category:
            by_category[cat] = {}
        by_category[cat][st] = by_category[cat].get(st, 0) + 1
    return json.dumps(
        {
            "total_rules": len(rules),
            "by_status": by_status,
            "by_category": by_category,
        },
        indent=2,
    )


# ── Sync tools ────────────────────────────────────────────────────────


@mcp.tool()
async def sync_rules(
    framework: str | None = None,
    dry_run: bool = True,
) -> dict[str, Any]:
    """Check wetten.overheid.nl for regulation updates.

    Compares current rule article references against the live legislation text.
    Only rules with a source_url are checked.

    Args:
        framework: Limit sync to a specific framework (bbl, wkb). Default: all.
        dry_run: If True (default), only report changes without applying them.
                 Set to False to update rule YAML files.
    """
    diffs = await run_sync(
        rule_index, settings, framework=framework, dry_run=dry_run,
    )
    return {
        "dry_run": dry_run,
        "total_checked": len(diffs),
        "results": [
            {
                "rule_id": d.rule_id,
                "article_number": d.article_number,
                "change_type": d.change_type.value,
            }
            for d in diffs
        ],
    }


@mcp.tool()
def sync_status() -> dict[str, Any]:
    """Show the latest sync status with wetten.overheid.nl."""
    status = get_sync_status()
    return {
        "last_run": status.last_run,
        "total_checked": status.total_checked,
        "total_changed": status.total_changed,
        "pending_changes": [
            {
                "rule_id": d.rule_id,
                "article_number": d.article_number,
                "change_type": d.change_type.value,
            }
            for d in status.pending_changes
        ],
    }


@mcp.resource("compliance://sync/status")
def sync_status_resource() -> str:
    """Last sync timestamps, pending changes, and change history."""
    status = get_sync_status()
    return json.dumps(
        {
            "last_run": status.last_run,
            "total_checked": status.total_checked,
            "total_changed": status.total_changed,
            "pending_changes": [
                {
                    "rule_id": d.rule_id,
                    "article_number": d.article_number,
                    "change_type": d.change_type.value,
                }
                for d in status.pending_changes
            ],
        },
        indent=2,
    )


# ── Entry point ────────────────────────────────────────────────────────


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    logger.info("Starting Compliance Checker MCP server on %s:%d", settings.host, settings.port)
    start_scheduler(rule_index, settings)
    mcp.run(transport="streamable-http")


if __name__ == "__main__":
    main()
