from __future__ import annotations

import enum
from datetime import datetime
from typing import TYPE_CHECKING
from uuid import UUID, uuid4

from sqlalchemy import DateTime, ForeignKey, Index, String, Text, UniqueConstraint
from sqlalchemy import Enum as SAEnum
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from bimdossier_api.db import MasterBase
from bimdossier_api.models._mixins import SoftDeleteMixin, TimestampMixin

if TYPE_CHECKING:
    from bimdossier_api.models.blog_post_tag import BlogPostTag


class BlogPostStatus(str, enum.Enum):
    draft = "draft"
    published = "published"


class BlogPost(TimestampMixin, SoftDeleteMixin, MasterBase):
    """Platform-wide marketing blog post.

    Lives in the master `public` schema, NOT a tenant schema — the blog is the
    same content for every visitor of the marketing site and has no per-org
    isolation. Sits alongside `users` and `organization_members` as the third
    master table.

    Content storage is split: small structured metadata in this row, with the
    Markdown body and cover image bytes in MinIO/S3 (keys recorded here). This
    mirrors how organization logos and IFC files already work, and keeps the
    table small for fast list queries.

    Slug uniqueness is scoped to locale: a single canonical slug like
    "wkb-compliance-explained" can have both an `en` and a `nl` row pointing
    at translated content, matching the file-based pattern under
    `apps/web/content/blog/` (`slug.mdx` + `slug.nl.mdx`).
    """

    __tablename__ = "blog_posts"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    slug: Mapped[str] = mapped_column(String(160), nullable=False)
    locale: Mapped[str] = mapped_column(String(8), nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    author: Mapped[str] = mapped_column(String(120), nullable=False, default="BimDossier")

    # The author-declared publish date — shown to readers as the post date.
    # Independent of `created_at` so backdating is allowed (matches the
    # `date:` frontmatter field in the existing committed posts).
    published_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )

    # S3 object keys (not URLs). The list/detail endpoints generate fresh
    # presigned URLs on each request from these keys.
    cover_image_key: Mapped[str] = mapped_column(String(512), nullable=False)
    content_key: Mapped[str] = mapped_column(String(512), nullable=False)

    status: Mapped[BlogPostStatus] = mapped_column(
        SAEnum(
            BlogPostStatus,
            name="blogpoststatus",
            values_callable=lambda enum: [m.value for m in enum],
        ),
        nullable=False,
        default=BlogPostStatus.draft,
        server_default=BlogPostStatus.draft.value,
    )

    created_by_user_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.users.id", ondelete="SET NULL"),
        nullable=True,
    )

    # Tags — normalize the former `tags` JSONB array into rows. Eager-loaded so
    # the read-only `tags` property is always populated when serialized.
    tag_rows: Mapped[list["BlogPostTag"]] = relationship(
        back_populates="post",
        cascade="all, delete-orphan",
        order_by="BlogPostTag.position",
        lazy="selectin",
    )

    @property
    def tags(self) -> list[str]:
        return [row.name for row in self.tag_rows]

    __table_args__ = (
        UniqueConstraint("slug", "locale", name="uq_blog_posts_slug_locale"),
        Index("ix_blog_posts_status", "status"),
        Index("ix_blog_posts_locale", "locale"),
        Index("ix_blog_posts_published_at", "published_at"),
        {"schema": "public"},
    )
