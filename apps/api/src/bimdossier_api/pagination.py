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

import base64
import binascii
from dataclasses import dataclass
from datetime import datetime
from typing import TYPE_CHECKING, Any
from uuid import UUID

from fastapi import HTTPException, Query, Response, status
from sqlalchemy import ColumnElement, Select, func, literal, select, tuple_

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


# ---------------------------------------------------------------------------
# Keyset (cursor) pagination — for append-only, reverse-chronological feeds
# ---------------------------------------------------------------------------
#
# Offset paging re-scans and discards ``offset`` rows on every page, so deep
# pages of a large table get progressively slower. Keyset paging instead carries
# an opaque cursor (the last row's ``(created_at, id)``) and asks for "rows
# strictly before it", which an index on ``(created_at, id)`` answers in constant
# time regardless of depth. The trade-off — no jump-to-page and no total count —
# is why this is reserved for "load more" feeds, NOT the sortable/counted
# DataTables (those keep OFFSET; they're bounded in practice and need that UX).


def encode_cursor(created_at: datetime, row_id: UUID) -> str:
    """Opaque, URL-safe cursor for a ``(created_at, id)`` keyset position."""
    raw = f"{created_at.isoformat()}|{row_id}"
    return base64.urlsafe_b64encode(raw.encode("utf-8")).decode("ascii")


def decode_cursor(cursor: str) -> tuple[datetime, UUID]:
    """Reverse :func:`encode_cursor`. A malformed cursor is a clean 422
    (``INVALID_CURSOR``) rather than a 500 — clients shouldn't be able to wedge
    the endpoint with a hand-edited token."""
    try:
        raw = base64.urlsafe_b64decode(cursor.encode("ascii")).decode("utf-8")
        ts_str, id_str = raw.split("|", 1)
        return datetime.fromisoformat(ts_str), UUID(id_str)
    except (ValueError, binascii.Error, UnicodeDecodeError) as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="INVALID_CURSOR",
        ) from exc


def keyset_after(
    ts_col: InstrumentedAttribute[Any],
    id_col: InstrumentedAttribute[Any],
    cursor: str,
) -> ColumnElement[bool]:
    """WHERE clause selecting rows strictly *after* ``cursor`` in descending
    ``(ts_col, id_col)`` order — pair it with ``ORDER BY ts_col DESC, id_col
    DESC``. The row-value comparison ``(ts, id) < (cur_ts, cur_id)`` is a single
    index range scan, so page N costs the same as page 1."""
    created_at, row_id = decode_cursor(cursor)
    return tuple_(ts_col, id_col) < tuple_(literal(created_at), literal(row_id))
