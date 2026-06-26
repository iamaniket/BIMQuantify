from __future__ import annotations

from typing import TYPE_CHECKING
from uuid import UUID, uuid4

from sqlalchemy import ForeignKey, Index, Integer, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from bimdossier_api.db import MasterBase
from bimdossier_api.models._mixins import TimestampMixin

if TYPE_CHECKING:
    from bimdossier_api.models.blog_post import BlogPost


class BlogPostTag(TimestampMixin, MasterBase):
    """One tag on a blog post, normalizing the former ``tags`` JSONB array.

    Master/``public`` table (blog posts are platform-wide). Drives tag filtering
    and autocomplete on the admin blog list; ``position`` preserves entry order.
    """

    __tablename__ = "blog_post_tags"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    post_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.blog_posts.id", ondelete="CASCADE"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(64), nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    post: Mapped[BlogPost] = relationship(back_populates="tag_rows")

    __table_args__ = (
        UniqueConstraint("post_id", "name", name="uq_blog_post_tag"),
        Index("ix_blog_post_tags_post", "post_id"),
        Index("ix_blog_post_tags_name", "name"),
        {"schema": "public"},
    )
