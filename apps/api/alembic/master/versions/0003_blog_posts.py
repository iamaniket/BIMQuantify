"""Add blog_posts table to the master/public schema.

The blog is platform-wide marketing content with no tenant isolation, so it
joins `users` and `organization_members` as the third master table. Metadata
lives here; the Markdown body and cover image bytes live in MinIO/S3 (keys
recorded on the row).

Revision ID: 0003_blog_posts
Revises: 0002_user_locale
Create Date: 2026-06-03
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, UUID

# Revision identifiers, used by Alembic.
revision: str = "0003_blog_posts"
down_revision: Union[str, None] = "0002_user_locale"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Idempotent: on fresh DBs `0001_master`'s `create_all` already creates
    # `public.blog_posts` from the current models, so this delta would
    # otherwise fail with `relation already exists`. Older DBs (no model at
    # 0001 time) still need this delta to land the table.
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if inspector.has_table("blog_posts", schema="public"):
        return
    op.create_table(
        "blog_posts",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("slug", sa.String(length=160), nullable=False),
        sa.Column("locale", sa.String(length=8), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text, nullable=False),
        sa.Column("author", sa.String(length=120), nullable=False, server_default="BimDossier"),
        sa.Column("tags", JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("cover_image_key", sa.String(length=512), nullable=False),
        sa.Column("content_key", sa.String(length=512), nullable=False),
        sa.Column(
            "status",
            sa.Enum(
                "draft",
                "published",
                name="blogpoststatus",
            ),
            nullable=False,
            server_default="draft",
        ),
        sa.Column(
            "created_by_user_id",
            UUID(as_uuid=True),
            sa.ForeignKey("public.users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("slug", "locale", name="uq_blog_posts_slug_locale"),
        schema="public",
    )
    op.create_index(
        "ix_blog_posts_status", "blog_posts", ["status"], schema="public"
    )
    op.create_index(
        "ix_blog_posts_locale", "blog_posts", ["locale"], schema="public"
    )
    op.create_index(
        "ix_blog_posts_published_at",
        "blog_posts",
        ["published_at"],
        schema="public",
    )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table("blog_posts", schema="public"):
        return
    op.drop_index("ix_blog_posts_published_at", table_name="blog_posts", schema="public")
    op.drop_index("ix_blog_posts_locale", table_name="blog_posts", schema="public")
    op.drop_index("ix_blog_posts_status", table_name="blog_posts", schema="public")
    op.drop_table("blog_posts", schema="public")
    op.execute("DROP TYPE IF EXISTS blogpoststatus")
