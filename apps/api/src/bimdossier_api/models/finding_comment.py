"""Finding discussion comments + @mention link table.

A flat, chronological discussion thread per finding (bevinding): the project
team and the kwaliteitsborger resolve an issue in context, with @mentions to
pull a specific member in. Mirrors ``BcfComment`` (display-name snapshot +
``created_by_user_id`` FK + edit tracking) but adds ``SoftDeleteMixin`` so a
deleted comment stays in the 10-year Wkb retention trail (and the audit log)
while disappearing from the thread.

Mentions live in their own link table (``finding_comment_mentions``) rather than
a JSONB array on the comment — the codebase's convention (see the attachment /
tag link tables). That decouples notification targeting from re-parsing the text
on edits and leaves room for a future "comments mentioning me" view. The
authoritative ``@[Display Name](user_id)`` tokens stay inline in
``comment_text`` so the portal can render mention chips without a join.
"""

from __future__ import annotations

from datetime import datetime  # noqa: TC003 — SQLAlchemy Mapped[] needs this at runtime
from typing import TYPE_CHECKING
from uuid import UUID, uuid4

from sqlalchemy import DateTime, ForeignKey, Index, String, Text
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from bimdossier_api.db import TenantBase
from bimdossier_api.models._mixins import SoftDeleteMixin, TimestampMixin

if TYPE_CHECKING:
    from bimdossier_api.models.finding import Finding
    from bimdossier_api.models.user import User


class FindingComment(TimestampMixin, SoftDeleteMixin, TenantBase):
    __tablename__ = "finding_comments"
    __table_args__ = (
        Index("ix_finding_comments_finding_id", "finding_id"),
        Index("ix_finding_comments_created_by_user_id", "created_by_user_id"),
    )

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    finding_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("findings.id", ondelete="CASCADE"),
        nullable=False,
    )
    # Stores the raw `@[Display Name](user_id)` mention tokens inline so the
    # portal can render chips without a join; the link table below is the
    # authoritative target list for notifications.
    comment_text: Mapped[str] = mapped_column(Text, nullable=False)
    # Display-name snapshot (BCF parity) — survives even if the author's user
    # row is later deleted (created_by_user_id goes NULL).
    author: Mapped[str] = mapped_column(String(255), nullable=False)
    date: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    modified_author: Mapped[str | None] = mapped_column(String(255), nullable=True)
    modified_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    created_by_user_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.users.id", ondelete="SET NULL"),
        nullable=True,
    )

    finding: Mapped[Finding] = relationship("Finding", lazy="raise")
    created_by: Mapped[User | None] = relationship("User", lazy="raise")


class FindingCommentMention(TenantBase):
    """One row per (comment, mentioned user).

    Authoritative mention record — decouples notification targeting from
    re-parsing ``comment_text`` on edits, and enables a future "comments
    mentioning me" filter. Follows the codebase's link-table convention over a
    JSONB array. ``user_id`` always references a real project member (validated
    at write time); CASCADE on both sides so the row vanishes with the comment
    or the user.
    """

    __tablename__ = "finding_comment_mentions"

    comment_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("finding_comments.id", ondelete="CASCADE"),
        primary_key=True,
    )
    user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.users.id", ondelete="CASCADE"),
        primary_key=True,
    )
