"""Helpers for the normalized attachment-link tables (Tier 2).

``finding_attachments`` and ``checklist_item_result_attachments`` replace the
old JSONB id arrays. The wire contract is unchanged — endpoints still accept and
return ``photo_ids`` / ``reference_attachment_ids`` / ``resolution_evidence_ids``
as ``list[str]``; these helpers translate that list to/from rows.
"""

from __future__ import annotations

from typing import Protocol, TypeVar
from uuid import UUID


class _AttachmentLink(Protocol):
    """Structural type for a link row (FindingAttachment / ...ResultAttachment)."""

    attachment_id: UUID
    kind: str
    position: int


# Generic over the concrete link class so callers can pass the invariant
# `list[FindingAttachment]` / `list[ChecklistItemResultAttachment]` relationship
# collections without a variance error.
_LinkT = TypeVar("_LinkT", bound=_AttachmentLink)


def replace_attachment_links(
    links: list[_LinkT],
    link_cls: type[_LinkT],
    *,
    kind: str,
    ids: list[str] | None,
) -> None:
    """Replace every link of ``kind`` in the relationship collection ``links``
    with fresh rows for ``ids`` (order preserved via ``position``).

    Other kinds are left untouched. ``ids=None`` or ``[]`` clears the kind.
    Mutates ``links`` in place: removed rows are orphaned (and deleted on flush
    by the ``cascade="all, delete-orphan"`` relationship); new rows are appended
    with their FK wired by ``back_populates``.
    """
    for existing in [link for link in links if link.kind == kind]:
        links.remove(existing)
    for position, attachment_id in enumerate(ids or []):
        links.append(
            link_cls(attachment_id=UUID(attachment_id), kind=kind, position=position)  # type: ignore[call-arg]
        )
