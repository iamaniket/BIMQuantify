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
    """Reconcile the links of ``kind`` in the relationship collection ``links``
    to exactly ``ids`` (order preserved via ``position``), touching only what
    changed.

    Other kinds are left untouched. ``ids=None`` or ``[]`` clears the kind.
    Mutates ``links`` in place: a link whose ``attachment_id`` is no longer
    requested is orphaned (and deleted on flush by the
    ``cascade="all, delete-orphan"`` relationship); a still-requested link is
    kept and only its ``position`` is updated; genuinely-new ids are appended
    with their FK wired by ``back_populates``.

    Diff-based on purpose — do **not** revert this to "remove all, re-add all".
    Re-sending an unchanged id set (the portal echoes a finding's current
    ``photo_ids`` / ``reference_attachment_ids`` on every save, e.g. a pin move)
    must be a no-op. A remove-then-re-add of the same
    ``(parent, attachment_id, kind)`` row in a single flush trips the
    ``uq_*_attachment`` unique constraint, because SQLAlchemy emits the INSERT
    before the DELETE (saves-before-deletes) — surfacing as a spurious
    ``IntegrityError`` that the routers map to ``ATTACHMENT_NOT_FOUND``.
    """
    desired = [UUID(attachment_id) for attachment_id in (ids or [])]
    desired_set = set(desired)
    existing = {link.attachment_id: link for link in links if link.kind == kind}
    # Drop links whose attachment is no longer requested.
    for attachment_id, link in existing.items():
        if attachment_id not in desired_set:
            links.remove(link)
    # Keep + reorder still-requested links in place; append only new ids.
    for position, attachment_id in enumerate(desired):
        existing_link = existing.get(attachment_id)
        if existing_link is not None:
            existing_link.position = position
        else:
            links.append(
                link_cls(attachment_id=attachment_id, kind=kind, position=position)  # type: ignore[call-arg]
            )
