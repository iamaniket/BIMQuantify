"""Super-admin endpoints for managing platform blog posts.

The blog is platform-wide marketing content; rows live in `public.blog_posts`
alongside `users` and `organization_members`. All routes here require
`is_superuser=true` and operate on the master schema directly — there is no
tenant context.

Storage split:
- This row holds structured metadata (title, slug, locale, tags, dates, status).
- The Markdown body and the cover image bytes live in MinIO/S3, keyed off the
  post id under `blog/content/` and `blog/covers/` respectively.

Authoring UX:
- The portal supports two parallel input modes — fill the structured form from
  scratch, OR drop an `.mdx` file whose YAML frontmatter is parsed into the
  same form fields before submit. Both modes hit this same multipart endpoint
  with structured fields; the API does NOT parse frontmatter — that's a
  presentation-layer concern.
"""

from __future__ import annotations

import json
import logging
import re
from datetime import UTC, datetime
from typing import Annotated
from uuid import UUID, uuid4

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    Request,
    UploadFile,
    status,
)
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from bimstitch_api import audit
from bimstitch_api.auth.dependencies import require_superuser
from bimstitch_api.db import get_async_session
from bimstitch_api.models.blog_post import BlogPost, BlogPostStatus
from bimstitch_api.models.blog_post_tag import BlogPostTag
from bimstitch_api.models.user import User
from bimstitch_api.schemas.blog import (
    BLOG_LOCALES,
    BLOG_STATUSES,
    BlogPostBilingualResponse,
    BlogPostRead,
    BlogPostUpdate,
)
from bimstitch_api.storage import StorageBackend, get_attachments_bucket, get_storage
from bimstitch_api.tag_rows import replace_tags

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Validation constants
# ---------------------------------------------------------------------------

# 5 MB headroom — cover images on the existing posts run ~300 KB; this
# allows for occasional high-res hero shots without enabling abuse.
IMAGE_MAX_BYTES = 5 * 1024 * 1024
IMAGE_ALLOWED_TYPES = {"image/png", "image/jpeg", "image/webp"}
IMAGE_EXT = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp"}

# 200 KB — even the longest existing post is ~5 KB. Anything above this is
# almost certainly a paste-bomb or a wrong-file upload.
CONTENT_MAX_BYTES = 200 * 1024
CONTENT_MIME = "text/markdown"

SLUG_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")

router = APIRouter(prefix="/admin/blog", tags=["admin-blog"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _validate_slug(slug: str) -> None:
    if not SLUG_RE.match(slug):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="BLOG_SLUG_INVALID",
        )


def _validate_locale(locale: str) -> None:
    if locale not in BLOG_LOCALES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="BLOG_LOCALE_INVALID",
        )


def _validate_status(value: str) -> BlogPostStatus:
    if value not in BLOG_STATUSES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="BLOG_STATUS_INVALID",
        )
    return BlogPostStatus(value)


def _parse_tags(raw: str | None) -> list[str]:
    """Tags come in over multipart as a JSON-encoded string. Empty / missing
    is valid — defaults to an empty list. Non-list payloads are rejected so
    the column always holds an array (downstream queries assume this)."""
    if not raw:
        return []
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="BLOG_TAGS_INVALID",
        ) from exc
    if not isinstance(parsed, list) or not all(isinstance(t, str) for t in parsed):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="BLOG_TAGS_INVALID",
        )
    # Drop empties and dedupe while preserving order. Tags are user-typed —
    # an accidental trailing comma in the portal could otherwise produce a
    # phantom "" tag that survives the JSON round-trip.
    seen: set[str] = set()
    cleaned: list[str] = []
    for tag in parsed:
        t = tag.strip()
        if t and t not in seen:
            seen.add(t)
            cleaned.append(t)
    return cleaned


def _parse_published_at(raw: str) -> datetime:
    try:
        dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="BLOG_PUBLISHED_AT_INVALID",
        ) from exc
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt


async def _validate_image(file: UploadFile) -> tuple[bytes, str]:
    content_type = file.content_type or ""
    if content_type not in IMAGE_ALLOWED_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="BLOG_IMAGE_INVALID_TYPE",
        )
    data = await file.read()
    if len(data) == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="BLOG_IMAGE_EMPTY",
        )
    if len(data) > IMAGE_MAX_BYTES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="BLOG_IMAGE_TOO_LARGE",
        )
    return data, content_type


def _validate_content(content: str) -> bytes:
    if not content.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="BLOG_CONTENT_EMPTY",
        )
    data = content.encode("utf-8")
    if len(data) > CONTENT_MAX_BYTES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="BLOG_CONTENT_TOO_LARGE",
        )
    return data


async def _fetch_content(
    storage: StorageBackend, key: str, bucket: str
) -> str:
    """Pull the Markdown body out of S3 as a UTF-8 string. Caps the read at
    CONTENT_MAX_BYTES so a corrupted object can't OOM the API process."""
    # `get_object_range` requests bytes 0..N inclusive — request one byte
    # past the cap so we can detect over-cap objects.
    raw = await storage.get_object_range(
        key, 0, CONTENT_MAX_BYTES, bucket=bucket
    )
    if len(raw) > CONTENT_MAX_BYTES:
        # Defensive — the column-level limit should make this impossible.
        raw = raw[:CONTENT_MAX_BYTES]
    return raw.decode("utf-8", errors="replace")


async def _serialize(
    post: BlogPost,
    storage: StorageBackend,
    *,
    include_content: bool,
) -> BlogPostRead:
    bucket = get_attachments_bucket()
    cover_url = await storage.presigned_get_url(
        post.cover_image_key,
        f"{post.slug}-cover",
        disposition="inline",
        bucket=bucket,
    )
    body: str | None = None
    if include_content:
        try:
            body = await _fetch_content(storage, post.content_key, bucket)
        except Exception:  # noqa: BLE001 — defensive against storage hiccups
            logger.exception(
                "blog_content_fetch_failed post_id=%s content_key=%s",
                post.id,
                post.content_key,
            )
            body = ""
    return BlogPostRead(
        id=post.id,
        slug=post.slug,
        locale=post.locale,
        title=post.title,
        description=post.description,
        author=post.author,
        tags=list(post.tags or []),
        published_at=post.published_at,
        cover_image_url=cover_url,
        cover_image_key=post.cover_image_key,
        content_key=post.content_key,
        content=body,
        status=post.status.value,
        created_by_user_id=post.created_by_user_id,
        created_at=post.created_at,
        updated_at=post.updated_at,
    )


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.get("/posts", response_model=list[BlogPostRead])
async def list_blog_posts(
    requester: User = Depends(require_superuser),
    session: AsyncSession = Depends(get_async_session),
    storage: StorageBackend = Depends(get_storage),
    locale: str | None = Query(default=None),
    status_filter: str | None = Query(default=None, alias="status"),
    q: str | None = None,
    tag: list[str] | None = Query(default=None),
    include_deleted: bool = False,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> list[BlogPostRead]:
    stmt = select(BlogPost).order_by(BlogPost.published_at.desc())
    if not include_deleted:
        stmt = stmt.where(BlogPost.deleted_at.is_(None))
    if locale is not None:
        _validate_locale(locale)
        stmt = stmt.where(BlogPost.locale == locale)
    if status_filter is not None:
        stmt = stmt.where(BlogPost.status == _validate_status(status_filter))
    if q:
        like = f"%{q.lower()}%"
        stmt = stmt.where(
            or_(
                func.lower(BlogPost.title).like(like),
                func.lower(BlogPost.slug).like(like),
            )
        )
    # Tag filter: each requested tag must be present (AND narrows the list).
    if tag:
        for tag_name in tag:
            stmt = stmt.where(
                select(BlogPostTag.id)
                .where(
                    BlogPostTag.post_id == BlogPost.id,
                    BlogPostTag.name == tag_name,
                )
                .exists()
            )
    stmt = stmt.limit(limit).offset(offset)
    result = await session.execute(stmt)
    posts = list(result.scalars())
    return [await _serialize(p, storage, include_content=False) for p in posts]


@router.get("/tags", response_model=list[str])
async def list_blog_tags(
    requester: User = Depends(require_superuser),
    session: AsyncSession = Depends(get_async_session),
    q: str | None = Query(default=None, max_length=64),
    limit: int = Query(default=20, ge=1, le=50),
) -> list[str]:
    """Distinct blog tag names for autocomplete. Optional `q` prefix-matches (ILIKE)."""
    stmt = (
        select(BlogPostTag.name).distinct().order_by(BlogPostTag.name).limit(limit)
    )
    if q and q.strip():
        stmt = stmt.where(BlogPostTag.name.ilike(f"{q.strip()}%"))
    result = await session.execute(stmt)
    return list(result.scalars().all())


@router.get("/posts/{post_id}", response_model=BlogPostRead)
async def get_blog_post(
    post_id: UUID,
    requester: User = Depends(require_superuser),
    session: AsyncSession = Depends(get_async_session),
    storage: StorageBackend = Depends(get_storage),
) -> BlogPostRead:
    post = await session.get(BlogPost, post_id)
    if post is None or post.deleted_at is not None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="BLOG_POST_NOT_FOUND"
        )
    return await _serialize(post, storage, include_content=True)


@router.post(
    "/posts",
    response_model=BlogPostRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_blog_post(
    request: Request,
    cover: Annotated[UploadFile, File(description="Cover image (PNG/JPEG/WebP, ≤5MB)")],
    slug: Annotated[str, Form()],
    locale: Annotated[str, Form()],
    title: Annotated[str, Form()],
    description: Annotated[str, Form()],
    content: Annotated[str, Form(description="Markdown body")],
    published_at: Annotated[str, Form(description="ISO-8601 datetime")],
    author: Annotated[str, Form()] = "BimDossier",
    tags: Annotated[str, Form(description="JSON-encoded string array")] = "[]",
    post_status: Annotated[str, Form(alias="status")] = "draft",
    requester: User = Depends(require_superuser),
    session: AsyncSession = Depends(get_async_session),
    storage: StorageBackend = Depends(get_storage),
) -> BlogPostRead:
    # --- Structured validation (fails fast, no S3 traffic on bad input) ----
    _validate_slug(slug)
    _validate_locale(locale)
    status_enum = _validate_status(post_status)
    if not title.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="BLOG_TITLE_EMPTY"
        )
    if not description.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="BLOG_DESCRIPTION_EMPTY",
        )
    parsed_tags = _parse_tags(tags)
    parsed_published_at = _parse_published_at(published_at)
    content_bytes = _validate_content(content)
    image_bytes, image_type = await _validate_image(cover)

    # --- Slug collision (cheap pre-check; the unique constraint is the
    # authoritative guard if a race slips through). -----------------------
    existing = await session.execute(
        select(BlogPost).where(
            BlogPost.slug == slug,
            BlogPost.locale == locale,
            BlogPost.deleted_at.is_(None),
        )
    )
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="BLOG_SLUG_TAKEN",
        )

    # --- Upload bytes first, then write the row. If the DB insert fails the
    # S3 objects are orphaned; cheaper to clean those up later than to leave
    # a row pointing at an object that doesn't exist. ----------------------
    post_id = uuid4()
    bucket = get_attachments_bucket()
    cover_key = f"blog/covers/{post_id}.{IMAGE_EXT[image_type]}"
    content_key = f"blog/content/{post_id}.md"

    try:
        await storage.put_object(cover_key, image_type, image_bytes, bucket=bucket)
        await storage.put_object(content_key, CONTENT_MIME, content_bytes, bucket=bucket)
    except Exception as exc:
        logger.exception("blog_storage_put_failed slug=%s", slug)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="BLOG_STORAGE_FAILED",
        ) from exc

    post = BlogPost(
        id=post_id,
        slug=slug,
        locale=locale,
        title=title.strip(),
        description=description.strip(),
        author=author.strip() or "BimDossier",
        published_at=parsed_published_at,
        cover_image_key=cover_key,
        content_key=content_key,
        status=status_enum,
        created_by_user_id=requester.id,
    )
    replace_tags(post.tag_rows, BlogPostTag, parsed_tags)
    session.add(post)

    try:
        await audit.record_for_org(
            session,
            None,
            action="blog_post.created",
            resource_type="blog_post",
            resource_id=post.id,
            after={"slug": slug, "locale": locale, "status": status_enum.value},
            actor_user_id=requester.id,
            request=request,
        )
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        # Best-effort cleanup of the orphaned S3 objects
        for key in (cover_key, content_key):
            try:
                await storage.delete_object(key, bucket=bucket)
            except Exception:  # noqa: BLE001
                logger.warning("blog_orphan_cleanup_failed key=%s", key, exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="BLOG_SLUG_TAKEN",
        ) from exc

    # Refresh DB-side timestamps and async-load tag_rows so the `tags` property
    # serializes (a freshly-built row is not selectin-loaded).
    await session.refresh(post, attribute_names=["created_at", "updated_at", "tag_rows"])
    return await _serialize(post, storage, include_content=True)


# NOTE: PUT /admin/blog/posts/{id}/cover rewrites only the targeted row's
# cover_image_key. Replacing one half of a bilingual pair's cover via that
# endpoint desyncs the pair (the other row keeps pointing at the original
# shared key). Known limitation — the bilingual create path here shares
# the EN-id-derived key string across both rows; a future cover-swap that
# preserves bilingual sharing would need to detect the pair and update both
# rows, or move cover storage off the row entirely.
@router.post(
    "/posts/bilingual",
    response_model=BlogPostBilingualResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_blog_post_bilingual(
    request: Request,
    cover: Annotated[UploadFile, File(description="Shared cover image (PNG/JPEG/WebP, ≤5MB)")],
    slug: Annotated[str, Form()],
    title_en: Annotated[str, Form()],
    content_en: Annotated[str, Form(description="English Markdown body")],
    title_nl: Annotated[str, Form()],
    content_nl: Annotated[str, Form(description="Dutch Markdown body")],
    description: Annotated[str, Form(description="Shared short description")],
    published_at: Annotated[str, Form(description="ISO-8601 datetime")],
    author: Annotated[str, Form()] = "BimDossier",
    tags: Annotated[str, Form(description="JSON-encoded string array")] = "[]",
    post_status: Annotated[str, Form(alias="status")] = "draft",
    requester: User = Depends(require_superuser),
    session: AsyncSession = Depends(get_async_session),
    storage: StorageBackend = Depends(get_storage),
) -> BlogPostBilingualResponse:
    """Atomically create the EN + NL pair of a post sharing one slug.

    Mirrors the single-locale `POST /posts` validation flow but doubles up the
    per-language title + content. Cover image and description are shared —
    one upload, one string assigned to both rows. Both rows commit together;
    if the upload or the DB insert fails the transaction rolls back and any
    S3 objects already written are best-effort deleted so the slug stays free
    for a retry.
    """
    # --- Structured validation (shared) -----------------------------------
    _validate_slug(slug)
    status_enum = _validate_status(post_status)
    parsed_tags = _parse_tags(tags)
    parsed_published_at = _parse_published_at(published_at)

    # --- Per-language + shared validation --------------------------------
    if not title_en.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="BLOG_TITLE_EMPTY"
        )
    if not title_nl.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="BLOG_TITLE_EMPTY"
        )
    if not description.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="BLOG_DESCRIPTION_EMPTY",
        )
    content_en_bytes = _validate_content(content_en)
    content_nl_bytes = _validate_content(content_nl)
    image_bytes, image_type = await _validate_image(cover)

    # --- Slug collision pre-check for BOTH locales ------------------------
    existing = await session.execute(
        select(BlogPost).where(
            BlogPost.slug == slug,
            BlogPost.locale.in_(("en", "nl")),
            BlogPost.deleted_at.is_(None),
        )
    )
    if existing.scalars().first() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="BLOG_SLUG_TAKEN",
        )

    # --- Upload three S3 objects (one shared cover + two contents) -------
    en_id = uuid4()
    nl_id = uuid4()
    bucket = get_attachments_bucket()
    # The shared cover key derives from the EN row's UUID — single bytes
    # written once, both rows store the same `cover_image_key` string.
    cover_key = f"blog/covers/{en_id}.{IMAGE_EXT[image_type]}"
    content_en_key = f"blog/content/{en_id}.md"
    content_nl_key = f"blog/content/{nl_id}.md"
    all_keys = (cover_key, content_en_key, content_nl_key)

    uploaded: list[str] = []
    try:
        await storage.put_object(cover_key, image_type, image_bytes, bucket=bucket)
        uploaded.append(cover_key)
        await storage.put_object(content_en_key, CONTENT_MIME, content_en_bytes, bucket=bucket)
        uploaded.append(content_en_key)
        await storage.put_object(content_nl_key, CONTENT_MIME, content_nl_bytes, bucket=bucket)
        uploaded.append(content_nl_key)
    except Exception as exc:
        logger.exception("blog_bilingual_storage_put_failed slug=%s", slug)
        # Best-effort rollback of partial uploads.
        for key in uploaded:
            try:
                await storage.delete_object(key, bucket=bucket)
            except Exception:  # noqa: BLE001
                logger.warning(
                    "blog_orphan_cleanup_failed key=%s", key, exc_info=True
                )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="BLOG_STORAGE_FAILED",
        ) from exc

    cleaned_author = author.strip() or "BimDossier"
    cleaned_description = description.strip()
    post_en = BlogPost(
        id=en_id,
        slug=slug,
        locale="en",
        title=title_en.strip(),
        description=cleaned_description,
        author=cleaned_author,
        published_at=parsed_published_at,
        cover_image_key=cover_key,
        content_key=content_en_key,
        status=status_enum,
        created_by_user_id=requester.id,
    )
    post_nl = BlogPost(
        id=nl_id,
        slug=slug,
        locale="nl",
        title=title_nl.strip(),
        description=cleaned_description,
        author=cleaned_author,
        published_at=parsed_published_at,
        cover_image_key=cover_key,
        content_key=content_nl_key,
        status=status_enum,
        created_by_user_id=requester.id,
    )
    replace_tags(post_en.tag_rows, BlogPostTag, parsed_tags)
    replace_tags(post_nl.tag_rows, BlogPostTag, parsed_tags)
    session.add(post_en)
    session.add(post_nl)

    try:
        await audit.record_for_org(
            session,
            None,
            action="blog_post.bilingual_created",
            resource_type="blog_post",
            resource_id=en_id,
            after={
                "slug": slug,
                "en_id": str(en_id),
                "nl_id": str(nl_id),
            },
            actor_user_id=requester.id,
            request=request,
        )
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        for key in all_keys:
            try:
                await storage.delete_object(key, bucket=bucket)
            except Exception:  # noqa: BLE001
                logger.warning(
                    "blog_orphan_cleanup_failed key=%s", key, exc_info=True
                )
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="BLOG_SLUG_TAKEN",
        ) from exc

    await session.refresh(post_en, attribute_names=["created_at", "updated_at", "tag_rows"])
    await session.refresh(post_nl, attribute_names=["created_at", "updated_at", "tag_rows"])
    return BlogPostBilingualResponse(
        en=await _serialize(post_en, storage, include_content=True),
        nl=await _serialize(post_nl, storage, include_content=True),
    )


@router.patch("/posts/{post_id}", response_model=BlogPostRead)
async def update_blog_post(
    post_id: UUID,
    request: Request,
    payload: BlogPostUpdate,
    requester: User = Depends(require_superuser),
    session: AsyncSession = Depends(get_async_session),
    storage: StorageBackend = Depends(get_storage),
) -> BlogPostRead:
    """Update metadata or content. Cover image replacement goes through a
    separate PUT route below so this stays a clean JSON endpoint."""
    post = await session.get(BlogPost, post_id)
    if post is None or post.deleted_at is not None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="BLOG_POST_NOT_FOUND"
        )

    fields_set = payload.model_fields_set
    before = {
        "title": post.title,
        "slug": post.slug,
        "locale": post.locale,
        "status": post.status.value,
    }

    if "slug" in fields_set and payload.slug is not None:
        _validate_slug(payload.slug)
        post.slug = payload.slug
    if "locale" in fields_set and payload.locale is not None:
        _validate_locale(payload.locale)
        post.locale = payload.locale
    if "status" in fields_set and payload.status is not None:
        post.status = _validate_status(payload.status)
    if "title" in fields_set and payload.title is not None:
        post.title = payload.title.strip()
    if "description" in fields_set and payload.description is not None:
        post.description = payload.description.strip()
    if "author" in fields_set and payload.author is not None:
        post.author = payload.author.strip() or "BimDossier"
    if "tags" in fields_set and payload.tags is not None:
        # replace_tags re-cleans (strip + dedup) and rebuilds the tag rows.
        replace_tags(post.tag_rows, BlogPostTag, payload.tags)
    if "published_at" in fields_set and payload.published_at is not None:
        post.published_at = payload.published_at

    if "content" in fields_set and payload.content is not None:
        content_bytes = _validate_content(payload.content)
        try:
            await storage.put_object(
                post.content_key,
                CONTENT_MIME,
                content_bytes,
                bucket=get_attachments_bucket(),
            )
        except Exception as exc:
            logger.exception(
                "blog_storage_put_failed post_id=%s", post_id
            )
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="BLOG_STORAGE_FAILED",
            ) from exc

    try:
        await audit.record_for_org(
            session,
            None,
            action="blog_post.updated",
            resource_type="blog_post",
            resource_id=post.id,
            before=before,
            after={
                "title": post.title,
                "slug": post.slug,
                "locale": post.locale,
                "status": post.status.value,
            },
            actor_user_id=requester.id,
            request=request,
        )
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="BLOG_SLUG_TAKEN",
        ) from exc

    # Partial refresh: keep the in-memory tag_rows loaded for the `tags` property.
    await session.refresh(post, attribute_names=["created_at", "updated_at"])
    return await _serialize(post, storage, include_content=True)


@router.put("/posts/{post_id}/cover", response_model=BlogPostRead)
async def replace_blog_cover(
    post_id: UUID,
    request: Request,
    cover: Annotated[UploadFile, File()],
    requester: User = Depends(require_superuser),
    session: AsyncSession = Depends(get_async_session),
    storage: StorageBackend = Depends(get_storage),
) -> BlogPostRead:
    post = await session.get(BlogPost, post_id)
    if post is None or post.deleted_at is not None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="BLOG_POST_NOT_FOUND"
        )
    image_bytes, image_type = await _validate_image(cover)
    bucket = get_attachments_bucket()
    new_key = f"blog/covers/{post_id}.{IMAGE_EXT[image_type]}"

    try:
        await storage.put_object(new_key, image_type, image_bytes, bucket=bucket)
    except Exception as exc:
        logger.exception("blog_cover_put_failed post_id=%s", post_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="BLOG_STORAGE_FAILED",
        ) from exc

    # Best-effort cleanup if the old object had a different extension (e.g.
    # png → webp). Same-key replaces overwrite in place, no orphan.
    if post.cover_image_key != new_key:
        try:
            await storage.delete_object(post.cover_image_key, bucket=bucket)
        except Exception:  # noqa: BLE001
            logger.warning(
                "blog_old_cover_delete_failed key=%s",
                post.cover_image_key,
                exc_info=True,
            )
    post.cover_image_key = new_key

    await audit.record_for_org(
        session,
        None,
        action="blog_post.cover_replaced",
        resource_type="blog_post",
        resource_id=post.id,
        after={"cover_image_key": new_key},
        actor_user_id=requester.id,
        request=request,
    )
    await session.commit()
    # Partial refresh: keep the selectin-loaded tag_rows for the `tags` property.
    await session.refresh(post, attribute_names=["updated_at"])
    return await _serialize(post, storage, include_content=True)


@router.delete("/posts/{post_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_blog_post(
    post_id: UUID,
    request: Request,
    requester: User = Depends(require_superuser),
    session: AsyncSession = Depends(get_async_session),
) -> None:
    """Soft-delete. Storage objects stay around — a future restore should be
    free, and the audit trail is more useful with the keys still resolvable.
    A nightly sweep can prune objects older than the deletion grace window."""
    post = await session.get(BlogPost, post_id)
    if post is None or post.deleted_at is not None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="BLOG_POST_NOT_FOUND"
        )
    post.soft_delete()
    await audit.record_for_org(
        session,
        None,
        action="blog_post.deleted",
        resource_type="blog_post",
        resource_id=post.id,
        before={"slug": post.slug, "locale": post.locale, "status": post.status.value},
        actor_user_id=requester.id,
        request=request,
    )
    await session.commit()
