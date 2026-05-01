"""Update rule YAML files based on sync results.

Core constraint: update-only, never remove rules.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from pathlib import Path

import yaml

from compliance_checker.sync.differ import ChangeType, DiffResult

logger = logging.getLogger(__name__)


def apply_updates(
    diffs: list[DiffResult],
    rules_dir: Path,
) -> list[str]:
    """Apply sync results to YAML rule files.

    Only updates existing rules — never removes. Returns list of updated rule IDs.
    """
    updated_ids: list[str] = []
    now = datetime.now(timezone.utc).isoformat()

    yaml_files: dict[str, Path] = {}
    for yaml_path in sorted(rules_dir.rglob("*.yaml")):
        if yaml_path.name == "manifest.yaml":
            continue
        yaml_files[str(yaml_path)] = yaml_path

    rule_to_file: dict[str, Path] = {}
    file_contents: dict[str, dict] = {}
    for path_str, yaml_path in yaml_files.items():
        raw = yaml.safe_load(yaml_path.read_text(encoding="utf-8"))
        if raw is None or "rules" not in raw:
            continue
        file_contents[path_str] = raw
        for rule_data in raw["rules"]:
            rule_id = rule_data.get("id")
            if rule_id:
                rule_to_file[rule_id] = yaml_path

    modified_files: set[str] = set()

    for diff in diffs:
        if diff.change_type == ChangeType.unchanged:
            continue

        file_path = rule_to_file.get(diff.rule_id)
        if file_path is None:
            logger.warning("Rule %s not found in any YAML file, skipping", diff.rule_id)
            continue

        path_str = str(file_path)
        raw = file_contents.get(path_str)
        if raw is None:
            continue

        for rule_data in raw["rules"]:
            if rule_data.get("id") != diff.rule_id:
                continue

            if diff.change_type == ChangeType.not_found:
                rule_data["implementation_status"] = "repealed"
                rule_data["notes"] = (
                    f"Article not found at source as of {now}. "
                    f"Marked repealed (original status preserved in git history)."
                )
                rule_data["last_synced"] = now

            elif diff.change_type in (ChangeType.updated, ChangeType.new):
                rule_data["source_text_hash"] = diff.new_hash
                rule_data["last_synced"] = now
                if diff.new_text and diff.change_type == ChangeType.updated:
                    if not rule_data.get("notes"):
                        rule_data["notes"] = ""
                    rule_data["notes"] = (
                        f"Article text changed on {now}. Review description_nl for accuracy."
                    )

            modified_files.add(path_str)
            updated_ids.append(diff.rule_id)
            break

    for path_str in modified_files:
        file_path = yaml_files.get(path_str) or Path(path_str)
        raw = file_contents[path_str]
        file_path.write_text(
            yaml.dump(raw, allow_unicode=True, sort_keys=False, default_flow_style=False),
            encoding="utf-8",
        )
        logger.info("Updated YAML file: %s", file_path)

    return updated_ids
