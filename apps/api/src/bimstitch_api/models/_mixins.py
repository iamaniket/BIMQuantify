from datetime import datetime, timezone

from sqlalchemy import DateTime, func
from sqlalchemy.orm import Mapped, mapped_column


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


class SoftDeleteMixin:
    """Generic soft-delete pattern.

    Pure-additive: the column is nullable and defaults to NULL, so legacy
    queries that don't filter on `deleted_at` keep behaving identically.
    New code that wants the "active rows only" view should add
    `where(Model.deleted_at.is_(None))` explicitly — there is intentionally
    no global query hook, because some readers (audit, admin restore) need
    the deleted rows back.

    Why nullable instead of a boolean: the timestamp also tells us *when*
    something was removed, which is part of the 10-year Wkb retention trail
    (backlog #36/#37). A flag would have to be paired with a separate audit
    row to carry the same information.
    """

    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        default=None,
    )

    @property
    def is_deleted(self) -> bool:
        return self.deleted_at is not None

    def soft_delete(self, now: datetime | None = None) -> None:
        """Mark the row as deleted.

        Pass `now` to override the timestamp (useful in tests). Calling on an
        already-deleted row preserves the original timestamp — soft-deleting
        twice never "moves" the deletion forward.
        """
        if self.deleted_at is None:
            self.deleted_at = now if now is not None else datetime.now(timezone.utc)

    def restore(self) -> None:
        """Undo a soft-delete. No-op on a non-deleted row."""
        self.deleted_at = None
