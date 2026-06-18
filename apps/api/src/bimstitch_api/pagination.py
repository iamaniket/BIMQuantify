"""Shared list-endpoint pagination + sorting helpers.

Total counts ride on the ``X-Total-Count`` response header — the convention the
portal's ``apiClient.getWithMeta`` already reads — so list bodies stay bare
arrays and no response model changes. (Reports/Jobs/Notifications keep their
pre-existing ``{items, total, ...}`` envelopes; this helper is for the
header-style list endpoints, which are the majority.)

Sorting is whitelisted per endpoint via a ``sort_map`` of allowed keys → ORM
columns. An unknown ``order_by`` is a 422 (``INVALID_SORT_KEY``) rather than a
silent fallback, so a client can't probe arbitrary columns and offset paging
stays deterministic.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from fastapi import HTTPException, Query, Response, status
from sqlalchemy import Select, func, select

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession
    from sqlalchemy.orm import InstrumentedAttribute

SortMap = dict[str, "InstrumentedAttribute[Any]"]


@dataclass(slots=True)
class SortParams:
    """Resolved ``?order_by=&order_dir=`` query params for a list endpoint."""

    order_by: str | None
    order_dir: str


def sort_params(
    order_by: str | None = Query(default=None),
    order_dir: str = Query(default="asc", pattern="^(asc|desc)$"),
) -> SortParams:
    """FastAPI dependency producing :class:`SortParams`.

    ``order_dir`` is constrained to ``asc``/``desc`` at the query layer; an
    invalid value 422s before the route body runs. ``order_by`` is validated
    against the endpoint's whitelist in :func:`apply_sort`.
    """
    return SortParams(order_by=order_by, order_dir=order_dir)


def set_total_count(response: Response, total: int) -> None:
    """Stamp the ``X-Total-Count`` header read by the portal's paginated client."""
    response.headers["X-Total-Count"] = str(total)


async def count_query(session: AsyncSession, base: Select[Any]) -> int:
    """Total rows matching ``base`` (a SELECT with all filters but no
    limit/offset/order). Wrap in a subquery so DISTINCT/GROUP BY filters count
    correctly."""
    return (await session.scalar(select(func.count()).select_from(base.subquery()))) or 0


def apply_sort(
    stmt: Select[Any],
    sort: SortParams,
    sort_map: SortMap,
    *,
    default: str,
    default_dir: str = "asc",
    tiebreaker: InstrumentedAttribute[Any] | None = None,
) -> Select[Any]:
    """Apply a whitelisted ``ORDER BY`` to ``stmt``.

    - An explicit ``order_by`` not in ``sort_map`` → 422 ``INVALID_SORT_KEY``.
    - When ``order_by`` is omitted the endpoint's ``default`` key + ``default_dir``
      apply (so every list has a deterministic default order).
    - ``tiebreaker`` (usually the primary key) is appended so rows with equal
      sort values keep a stable total order — without it, offset paging can
      drop or duplicate rows across page boundaries.

    Any pre-existing ``order_by`` on ``stmt`` is cleared first.
    """
    if sort.order_by is not None and sort.order_by not in sort_map:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"INVALID_SORT_KEY:{sort.order_by}",
        )
    key = sort.order_by if sort.order_by is not None else default
    direction = sort.order_dir if sort.order_by is not None else default_dir
    column = sort_map[key]
    ordered = column.desc() if direction == "desc" else column.asc()
    columns = [ordered]
    if tiebreaker is not None and tiebreaker is not column:
        columns.append(tiebreaker.asc())
    return stmt.order_by(None).order_by(*columns)
