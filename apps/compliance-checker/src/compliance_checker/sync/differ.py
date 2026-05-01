"""Compare fetched article text with stored rule metadata."""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum

from compliance_checker.rules.schema import RuleDefinition
from compliance_checker.sync.fetcher import ArticleContent


class ChangeType(StrEnum):
    unchanged = "unchanged"
    updated = "updated"
    not_found = "not_found"
    new = "new"


@dataclass(frozen=True)
class DiffResult:
    rule_id: str
    article_number: str
    source_url: str
    change_type: ChangeType
    old_hash: str | None
    new_hash: str | None
    new_text: str | None = None


def compare(rule: RuleDefinition, content: ArticleContent | None) -> DiffResult:
    """Compare a rule's stored hash against freshly fetched content."""
    if content is None:
        return DiffResult(
            rule_id=rule.id,
            article_number=rule.article_number,
            source_url=rule.source_url or "",
            change_type=ChangeType.not_found,
            old_hash=rule.source_text_hash,
            new_hash=None,
        )

    if rule.source_text_hash is None:
        return DiffResult(
            rule_id=rule.id,
            article_number=rule.article_number,
            source_url=content.url,
            change_type=ChangeType.new,
            old_hash=None,
            new_hash=content.text_hash,
            new_text=content.text,
        )

    if content.text_hash == rule.source_text_hash:
        return DiffResult(
            rule_id=rule.id,
            article_number=rule.article_number,
            source_url=content.url,
            change_type=ChangeType.unchanged,
            old_hash=rule.source_text_hash,
            new_hash=content.text_hash,
        )

    return DiffResult(
        rule_id=rule.id,
        article_number=rule.article_number,
        source_url=content.url,
        change_type=ChangeType.updated,
        old_hash=rule.source_text_hash,
        new_hash=content.text_hash,
        new_text=content.text,
    )
