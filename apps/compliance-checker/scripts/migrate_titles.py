"""One-time migration: promote title/title_nl and description/description_nl
into titles: {en, nl} and descriptions: {en, nl} maps in all rule YAML files.

Usage:
    python scripts/migrate_titles.py          # dry-run (prints diffs)
    python scripts/migrate_titles.py --write  # rewrite files in-place
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import yaml


def migrate_rule(rule: dict) -> bool:
    changed = False

    if "titles" not in rule and ("title" in rule or "title_nl" in rule):
        rule["titles"] = {}
        if "title" in rule:
            rule["titles"]["en"] = rule.pop("title")
        if "title_nl" in rule:
            rule["titles"]["nl"] = rule.pop("title_nl")
        changed = True

    if "descriptions" not in rule and ("description" in rule or "description_nl" in rule):
        rule["descriptions"] = {}
        if "description" in rule:
            rule["descriptions"]["en"] = rule.pop("description")
        if "description_nl" in rule:
            rule["descriptions"]["nl"] = rule.pop("description_nl")
        changed = True

    return changed


def migrate_file(path: Path, *, write: bool) -> int:
    with open(path) as f:
        data = yaml.safe_load(f)

    if not isinstance(data, dict) or "rules" not in data:
        return 0

    count = 0
    for rule in data["rules"]:
        if migrate_rule(rule):
            count += 1

    if count > 0:
        if write:
            with open(path, "w", encoding="utf-8") as f:
                yaml.dump(data, f, default_flow_style=False, allow_unicode=True, sort_keys=False, width=120)
            print(f"  WROTE {path} ({count} rules migrated)")
        else:
            print(f"  WOULD migrate {path} ({count} rules)")

    return count


def main() -> None:
    parser = argparse.ArgumentParser(description="Migrate rule titles to localized maps")
    parser.add_argument("--write", action="store_true", help="Write changes to files")
    args = parser.parse_args()

    rules_dir = Path(__file__).resolve().parent.parent / "rules"
    if not rules_dir.is_dir():
        print(f"Rules directory not found: {rules_dir}", file=sys.stderr)
        sys.exit(1)

    total = 0
    for yaml_path in sorted(rules_dir.rglob("*.yaml")):
        if yaml_path.name == "manifest.yaml":
            continue
        total += migrate_file(yaml_path, write=args.write)

    action = "Migrated" if args.write else "Would migrate"
    print(f"\n{action} {total} rules across all YAML files.")
    if not args.write and total > 0:
        print("Run with --write to apply changes.")


if __name__ == "__main__":
    main()
