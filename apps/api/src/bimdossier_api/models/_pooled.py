"""Shared declarative mixins + helpers for the pooled free-tier tables (`public.free_*`).

Every pooled free table denormalizes the row owner (`owner_user_id`, the RLS key
fed by the `app.current_user_id` GUC that `get_free_session` sets) and most carry
the standard created/updated timestamps; several also build CHECK constraints from
a value tuple derived from the paid enums. Each model used to re-declare all of
this inline — the same `id` PK, the same owner FK, the same timestamp columns, and
a private `_in_clause` copy. This module centralizes them so the pooled tables stay
structurally identical (the free-wedge "1:1 mirror" goal) with no copy-paste.

These are plain SQLAlchemy 2.0 declarative mixins — `mapped_column` is copied per
subclass. The column specs are byte-identical to the previous inline declarations
(same type / nullability / server_default / FK ondelete), so `create_all` (tests)
and the `0001_initial_master` migration (prod) still agree, and
`alembic revision --autogenerate` sees no diff (it compares column specs, not
order). Use `(PooledOwnedMixin, TimestampMixin, MasterBase)` as the bases — mixins
first, the declarative base last.
"""

from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import DateTime, ForeignKey, func
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column


def check_in(column: str, values: tuple[str, ...]) -> str:
    """Render a SQL ``<column> IN ('a', 'b', …)`` predicate for a CHECK constraint.

    Replaces the per-model ``_in_clause`` copies. The value tuples are derived from
    the paid enums at import time, so the free CHECK sets stay in lockstep with the
    paid value sets without duplicating literals.
    """
    rendered = ", ".join(f"'{v}'" for v in values)
    return f"{column} IN ({rendered})"


class PooledOwnedMixin:
    """The `id` PK + denormalized `owner_user_id` shared by every pooled free table.

    ``owner_user_id`` is the load-bearing RLS key (the owner-keyed policies in
    ``_rls_sql`` filter on it); FK → ``public.users`` with ``ON DELETE CASCADE`` so
    deleting a user removes their pooled rows.
    """

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    owner_user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.users.id", ondelete="CASCADE"),
        nullable=False,
    )


class TimestampMixin:
    """`created_at` / `updated_at` (timestamptz, server-defaulted, `updated_at`
    bumped on update) shared by the pooled free tables that track both."""

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
