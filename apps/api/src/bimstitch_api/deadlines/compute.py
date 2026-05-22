"""Recompute deadline rows for a project based on jurisdiction rules.

Called on project create and whenever `planned_start_date`,
`delivery_date`, or `country` change. Pure upsert logic — each
(project_id, deadline_type) pair is unique-constrained and preserved
across recomputes so row IDs stay stable.

Rules:
- Source field is None → due_date=None, status=not_applicable
- Source field set → compute due_date from rule
- If due_date changed and status was `met` → reset to `pending`
  (the old filing is invalidated by the new date)
- If due_date unchanged and status `met` → preserve
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from bimstitch_api.deadlines.working_days import compute_due_date
from bimstitch_api.jurisdictions import DeadlineRule, require
from bimstitch_api.models.deadline import Deadline, DeadlineStatus


async def recompute_deadlines(
    session: AsyncSession,
    project: object,
    *,
    user_id: UUID | None = None,
) -> list[Deadline]:
    """Upsert deadline rows for *project* based on its jurisdiction rules.

    Returns the full list of deadline rows (created or updated). Caller's
    transaction commits these — this function does NOT flush.
    """
    # Duck-type: project has .id, .country, .planned_start_date, .delivery_date
    project_id: UUID = project.id  # type: ignore[attr-defined]
    country: str = project.country  # type: ignore[attr-defined]

    jurisdiction = require(country)
    rules = jurisdiction.deadline_rules

    if not rules:
        return []

    # Load existing deadline rows for this project (keyed by deadline_type).
    stmt = select(Deadline).where(Deadline.project_id == project_id)
    result = await session.execute(stmt)
    existing: dict[str, Deadline] = {d.deadline_type: d for d in result.scalars().all()}

    deadlines: list[Deadline] = []

    for rule in rules:
        source_date = getattr(project, rule.source_field, None)

        if source_date is None:
            new_due = None
            new_status = DeadlineStatus.not_applicable
        else:
            new_due = compute_due_date(source_date, rule, country)
            new_status = DeadlineStatus.pending

        if rule.deadline_type in existing:
            dl = existing[rule.deadline_type]
            old_due = dl.due_date

            if source_date is None:
                dl.due_date = None
                dl.status = DeadlineStatus.not_applicable
                dl.met_at = None
                dl.met_by_user_id = None
            else:
                dl.due_date = new_due
                if dl.status == DeadlineStatus.met:
                    # Date changed → old filing is invalid, reset
                    if old_due != new_due:
                        dl.status = DeadlineStatus.pending
                        dl.met_at = None
                        dl.met_by_user_id = None
                    # else: date unchanged, preserve met status
                elif dl.status == DeadlineStatus.not_applicable:
                    # Was n.v.t., now has a date → pending
                    dl.status = DeadlineStatus.pending
                # else: already pending, keep it
        else:
            dl = Deadline(
                project_id=project_id,
                deadline_type=rule.deadline_type,
                due_date=new_due,
                status=new_status,
            )
            session.add(dl)

        deadlines.append(dl)

    return deadlines
