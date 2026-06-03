"""Pydantic schemas for the blog admin + public endpoints."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field

BLOG_LOCALES = {"en", "nl"}
BLOG_STATUSES = {"draft", "published"}


class BlogPostRead(BaseModel):
    """Full read shape returned to the admin UI.

    `cover_image_url` and `content_url` are freshly-presigned URLs generated
    at read time — clients must not cache them past their TTL (default 15 min).
    `content` is the inlined Markdown body for the detail view; list endpoints
    omit it to keep the payload small.
    """

    id: UUID
    slug: str
    locale: str
    title: str
    description: str
    author: str
    tags: list[str]
    published_at: datetime
    cover_image_url: str
    cover_image_key: str
    content_key: str
    content: str | None = None
    status: str
    created_by_user_id: UUID | None
    created_at: datetime
    updated_at: datetime


class BlogPostPublicRead(BaseModel):
    """Slimmer read shape for the public marketing site.

    Strips internal fields (status, created_by, S3 keys) — the web app only
    needs what it renders. Cover URL is presigned and short-lived; web app
    should re-fetch on cache miss rather than persist.
    """

    slug: str
    locale: str
    title: str
    description: str
    author: str
    tags: list[str]
    published_at: datetime
    cover_image_url: str
    content: str | None = None
    reading_time_minutes: int


class BlogPostBilingualResponse(BaseModel):
    """Pair of newly-created posts returned by the bilingual create endpoint.

    The endpoint atomically writes one English row and one Dutch row sharing
    the same slug; this response surfaces both so the admin UI can immediately
    render the canonical (slug, locale) pair without a follow-up GET.
    """

    en: BlogPostRead
    nl: BlogPostRead


class BlogPostUpdate(BaseModel):
    """Optional fields for PATCH /admin/blog/posts/{id}.

    `cover_image` and the markdown body are handled as multipart parts in
    the route signature, not in this body — this schema is JSON-only.
    """

    title: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = Field(default=None, min_length=1, max_length=2000)
    slug: str | None = Field(default=None, min_length=1, max_length=160)
    locale: str | None = None
    author: str | None = Field(default=None, max_length=120)
    tags: list[str] | None = None
    published_at: datetime | None = None
    status: str | None = None
    content: str | None = None
