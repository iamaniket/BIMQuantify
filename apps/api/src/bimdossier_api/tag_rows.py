"""Helper for the normalized per-entity tag tables (Tier 3).

``org_certificate_tags``, ``bcf_topic_labels`` and ``blog_post_tags`` replace the
old ``tags`` / ``labels`` JSONB arrays. The wire contract is unchanged — endpoints
still accept and return ``tags`` / ``labels`` as ``list[str]``; this helper
translates that list into rows.
"""

from __future__ import annotations

from typing import Protocol, TypeVar


class _TagRow(Protocol):
    """Structural type for a tag row (OrgCertificateTag / BcfTopicLabel / ...)."""

    name: str
    position: int


# Generic over the concrete tag class so callers can pass the invariant
# `list[OrgCertificateTag]` / `list[BlogPostTag]` relationship collections.
_TagT = TypeVar("_TagT", bound=_TagRow)


def replace_tags(
    rows: list[_TagT],
    tag_cls: type[_TagT],
    names: list[str] | None,
) -> None:
    """Replace the entire tag collection ``rows`` with fresh rows for ``names``.

    Names are stripped and de-duplicated (first occurrence wins), preserving
    order via ``position``; blanks are dropped. Mutates ``rows`` in place —
    removed rows are orphaned (deleted on flush by the ``cascade="all,
    delete-orphan"`` relationship), new rows appended with their FK wired by
    ``back_populates``.
    """
    rows.clear()
    seen: set[str] = set()
    position = 0
    for raw in names or []:
        name = raw.strip()
        if not name or name in seen:
            continue
        seen.add(name)
        rows.append(tag_cls(name=name, position=position))  # type: ignore[call-arg]
        position += 1
