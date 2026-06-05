from datetime import UTC, datetime

from sqlalchemy import BigInteger, DateTime, Integer, String, Text, func
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
            self.deleted_at = now if now is not None else datetime.now(UTC)

    def restore(self) -> None:
        """Undo a soft-delete. No-op on a non-deleted row."""
        self.deleted_at = None


class FileBackedMixin:
    """The physical-file columns shared by every binary-bearing tenant table.

    `Attachment` and `Certificate` (and conceptually `ProjectFile`) all store the
    same five facts about an uploaded object: where it lives, what it was called,
    how big it is, its MIME type, and its content hash. Folding them into one
    mixin removes the triplicated declarations and is the substrate the shared
    upload service (`storage/upload_service.py`) and the immutable-versioning
    model (#35) build on.

    The definitions here are byte-identical to the per-table columns they
    replace, so adopting the mixin is a Python-only refactor — it emits no DDL
    change. `status` stays per-table: each owns a distinct typed status enum
    (`attachmentstatus` / `certificatestatus`) and unifying them would be a
    tenant enum fan-out for no real gain. The `size_bytes >= 0` CHECK and any
    dedup index live in each table's `__table_args__`, since their names differ.

    A new version of a logical document is always a *new row with a new*
    `storage_key` — bytes are write-once per row, never overwritten. That
    immutability is the foundation of the 10-year Wkb retention trail.
    """

    storage_key: Mapped[str] = mapped_column(String(512), unique=True, nullable=False)
    original_filename: Mapped[str] = mapped_column(String(512), nullable=False)
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    content_type: Mapped[str] = mapped_column(String(255), nullable=False)
    content_sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)


class StoredFileMixin:
    """The upload-lifecycle columns shared by every stored-file tenant table.

    Sits next to ``FileBackedMixin`` (which owns the physical-blob columns): this
    one owns the *lifecycle* facts a stored file carries regardless of what role
    it plays — its monotonic version number, an optional rejection reason, and a
    free-text description. ``status`` is intentionally NOT here: it is a typed
    enum whose definition lives with its table (``ProjectFile.status`` →
    ``projectfilestatus``), and folding it in would force a cross-module enum
    import. The ``size_bytes >= 0`` CHECK likewise stays in each table's
    ``__table_args__`` because the constraint name differs per table.

    ``version_number`` defaults to 1 so a first upload is implicitly v1; callers
    that supersede an existing file set it explicitly to ``MAX(version_number)+1``
    over the version group (see the per-role version indexes on ``ProjectFile``).
    """

    version_number: Mapped[int] = mapped_column(
        Integer, nullable=False, default=1, server_default="1"
    )
    rejection_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
