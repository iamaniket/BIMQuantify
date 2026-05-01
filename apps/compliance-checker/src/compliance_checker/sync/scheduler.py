"""Background scheduler for periodic wetten.overheid.nl sync."""

from __future__ import annotations

import asyncio
import logging
import threading
from dataclasses import dataclass, field
from datetime import datetime, timezone

from compliance_checker.config import Settings
from compliance_checker.rules.loader import RuleIndex
from compliance_checker.sync.differ import ChangeType, DiffResult, compare
from compliance_checker.sync.fetcher import fetch_article
from compliance_checker.sync.updater import apply_updates

logger = logging.getLogger(__name__)


@dataclass
class SyncStatus:
    last_run: str | None = None
    last_run_results: list[dict] | None = None
    pending_changes: list[DiffResult] = field(default_factory=list)
    total_checked: int = 0
    total_changed: int = 0


_sync_status = SyncStatus()


def get_sync_status() -> SyncStatus:
    return _sync_status


async def run_sync(
    rule_index: RuleIndex,
    settings: Settings,
    *,
    framework: str | None = None,
    dry_run: bool = True,
) -> list[DiffResult]:
    """Check all rules with source_url for updates from wetten.overheid.nl."""
    rules = rule_index.get_rules(framework=framework)
    rules_with_source = [r for r in rules if r.source_url]

    if not rules_with_source:
        logger.info("No rules with source_url found")
        return []

    diffs: list[DiffResult] = []
    for rule in rules_with_source:
        assert rule.source_url is not None
        content = await fetch_article(rule.source_url)
        diff = compare(rule, content)
        diffs.append(diff)

    _sync_status.last_run = datetime.now(timezone.utc).isoformat()
    _sync_status.total_checked = len(diffs)
    _sync_status.total_changed = sum(
        1 for d in diffs if d.change_type != ChangeType.unchanged
    )
    _sync_status.pending_changes = [
        d for d in diffs if d.change_type != ChangeType.unchanged
    ]
    _sync_status.last_run_results = [
        {
            "rule_id": d.rule_id,
            "article_number": d.article_number,
            "change_type": d.change_type.value,
        }
        for d in diffs
    ]

    if not dry_run:
        updated = apply_updates(diffs, settings.rules_path)
        if updated:
            rule_index.load(settings.rules_path)
            logger.info("Applied updates to %d rules, reloaded index", len(updated))
        _sync_status.pending_changes = []

    return diffs


async def _scheduler_loop(
    rule_index: RuleIndex,
    settings: Settings,
) -> None:
    interval = settings.sync_interval_hours * 3600
    while True:
        await asyncio.sleep(interval)
        try:
            dry_run = not settings.sync_auto_apply
            diffs = await run_sync(
                rule_index, settings, dry_run=dry_run,
            )
            changed = sum(1 for d in diffs if d.change_type != ChangeType.unchanged)
            if changed:
                action = "applied" if not dry_run else "detected (dry-run)"
                logger.info("Scheduled sync: %d changes %s", changed, action)
            else:
                logger.info("Scheduled sync: all rules up to date")
        except Exception:
            logger.exception("Scheduled sync failed")


def _run_scheduler_thread(
    rule_index: RuleIndex,
    settings: Settings,
) -> None:
    asyncio.run(_scheduler_loop(rule_index, settings))


def start_scheduler(
    rule_index: RuleIndex,
    settings: Settings,
) -> asyncio.Task[None] | threading.Thread | None:
    if not settings.sync_enabled:
        logger.info("Scheduled sync disabled")
        return None
    logger.info(
        "Starting scheduled sync every %d hours (auto_apply=%s)",
        settings.sync_interval_hours,
        settings.sync_auto_apply,
    )
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        thread = threading.Thread(
            target=_run_scheduler_thread,
            args=(rule_index, settings),
            name="compliance-sync-scheduler",
            daemon=True,
        )
        thread.start()
        return thread

    return loop.create_task(_scheduler_loop(rule_index, settings))
