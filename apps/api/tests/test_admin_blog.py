"""Tests for the platform blog admin + public endpoints.

Covers:
- Super-admin gate (403 for non-superusers, 401 for unauthenticated)
- Happy path: create → list → get → patch metadata → patch content → cover
  replacement → soft delete
- Validation errors: bad slug, bad locale, bad status, bad tags, bad image
  type, bad image size, empty content
- Slug-collision 409
- Public endpoints only return `published`, non-deleted posts
- Public detail 404s on unknown slug, draft status, soft-deleted
"""

from __future__ import annotations

import io
from datetime import UTC, datetime
from typing import TYPE_CHECKING

import pytest
from fastapi_users.password import PasswordHelper

from bimdossier_api.models.user import User

if TYPE_CHECKING:
    from httpx import AsyncClient
    from sqlalchemy.ext.asyncio import AsyncSession

    from tests.conftest import FakeStorage


PASSWORD = "correct-horse-battery"

# A 67-byte minimal PNG. `httpx`/Starlette only honours the `content_type` we
# attach to the multipart part — the image isn't actually decoded — so any
# valid-enough byte payload is fine here.
PNG_BYTES = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
    b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\rIDATx\x9cc\x00\x01"
    b"\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
)


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _login(client: AsyncClient, email: str) -> str:
    resp = await client.post(
        "/auth/jwt/login",
        data={"username": email, "password": PASSWORD},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["access_token"]


async def _make_user(
    session: AsyncSession,
    email: str,
    *,
    is_superuser: bool = False,
) -> User:
    user = User(
        email=email,
        hashed_password=PasswordHelper().hash(PASSWORD),
        full_name="Test User",
        is_active=True,
        is_verified=True,
        is_superuser=is_superuser,
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user


def _form(
    *,
    slug: str = "hello-world",
    locale: str = "en",
    title: str = "Hello World",
    description: str = "A short introduction.",
    content: str = "## Hello\n\nThis is the body.",
    published_at: str | None = None,
    author: str = "BimDossier",
    tags: str = '["intro","wkb"]',
    status: str = "published",
) -> dict[str, str]:
    return {
        "slug": slug,
        "locale": locale,
        "title": title,
        "description": description,
        "content": content,
        "published_at": published_at or datetime.now(UTC).isoformat(),
        "author": author,
        "tags": tags,
        "status": status,
    }


def _image_files(
    content_type: str = "image/png", data: bytes = PNG_BYTES
) -> dict[str, tuple[str, io.BytesIO, str]]:
    return {"cover": ("cover.png", io.BytesIO(data), content_type)}


# ---------------------------------------------------------------------------
# Auth guard
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_create_blog_post_requires_superuser(
    fake_storage_client: tuple[AsyncClient, FakeStorage],
    session: AsyncSession,
) -> None:
    client, _fake = fake_storage_client
    await _make_user(session, "norm@example.com", is_superuser=False)
    token = await _login(client, "norm@example.com")

    resp = await client.post(
        "/admin/blog/posts",
        data=_form(),
        files=_image_files(),
        headers=_auth(token),
    )
    assert resp.status_code == 403
    assert resp.json()["detail"] == "SUPERUSER_REQUIRED"


@pytest.mark.asyncio
async def test_create_blog_post_requires_auth(
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, _fake = fake_storage_client
    resp = await client.post(
        "/admin/blog/posts", data=_form(), files=_image_files()
    )
    assert resp.status_code == 401


# ---------------------------------------------------------------------------
# Happy path
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_create_then_list_then_get_blog_post(
    fake_storage_client: tuple[AsyncClient, FakeStorage],
    session: AsyncSession,
) -> None:
    client, fake = fake_storage_client
    await _make_user(session, "su@example.com", is_superuser=True)
    token = await _login(client, "su@example.com")

    create = await client.post(
        "/admin/blog/posts",
        data=_form(slug="first-post", title="First post"),
        files=_image_files(),
        headers=_auth(token),
    )
    assert create.status_code == 201, create.text
    post = create.json()
    assert post["slug"] == "first-post"
    assert post["locale"] == "en"
    assert post["status"] == "published"
    assert post["tags"] == ["intro", "wkb"]
    # Both objects must be in storage with deterministic keys.
    assert f"blog/covers/{post['id']}.png" in fake.objects
    assert f"blog/content/{post['id']}.md" in fake.objects
    # Cover URL is freshly presigned, content is inlined.
    assert post["cover_image_url"].startswith("http://fake-storage/")
    assert post["content"].startswith("## Hello")

    listing = await client.get("/admin/blog/posts", headers=_auth(token))
    assert listing.status_code == 200
    rows = listing.json()
    assert len(rows) == 1
    assert rows[0]["slug"] == "first-post"
    # List endpoint omits inline body to keep payload small
    assert rows[0]["content"] is None

    detail = await client.get(
        f"/admin/blog/posts/{post['id']}", headers=_auth(token)
    )
    assert detail.status_code == 200
    assert detail.json()["content"].startswith("## Hello")


@pytest.mark.asyncio
async def test_patch_metadata_and_content(
    fake_storage_client: tuple[AsyncClient, FakeStorage],
    session: AsyncSession,
) -> None:
    client, fake = fake_storage_client
    await _make_user(session, "su@example.com", is_superuser=True)
    token = await _login(client, "su@example.com")

    create = await client.post(
        "/admin/blog/posts",
        data=_form(slug="patchme"),
        files=_image_files(),
        headers=_auth(token),
    )
    post = create.json()

    patch = await client.patch(
        f"/admin/blog/posts/{post['id']}",
        json={
            "title": "Renamed",
            "tags": ["new", "tags", "new"],  # dupe should be deduped
            "content": "## Updated body",
            "status": "draft",
        },
        headers=_auth(token),
    )
    assert patch.status_code == 200, patch.text
    body = patch.json()
    assert body["title"] == "Renamed"
    assert body["tags"] == ["new", "tags"]
    assert body["status"] == "draft"
    assert body["content"] == "## Updated body"
    # Underlying S3 object was actually overwritten
    assert fake.objects[post["content_key"]] == b"## Updated body"


@pytest.mark.asyncio
async def test_replace_cover_image(
    fake_storage_client: tuple[AsyncClient, FakeStorage],
    session: AsyncSession,
) -> None:
    client, fake = fake_storage_client
    await _make_user(session, "su@example.com", is_superuser=True)
    token = await _login(client, "su@example.com")
    create = await client.post(
        "/admin/blog/posts",
        data=_form(slug="cover-swap"),
        files=_image_files(),
        headers=_auth(token),
    )
    post = create.json()
    old_key = post["cover_image_key"]

    swap = await client.put(
        f"/admin/blog/posts/{post['id']}/cover",
        files=_image_files(content_type="image/webp", data=b"\x00\x01\x02WEBP" * 8),
        headers=_auth(token),
    )
    assert swap.status_code == 200, swap.text
    new_key = swap.json()["cover_image_key"]
    assert new_key.endswith(".webp")
    assert new_key != old_key
    assert old_key in fake.deleted  # cleanup happened


@pytest.mark.asyncio
async def test_soft_delete_hides_from_list(
    fake_storage_client: tuple[AsyncClient, FakeStorage],
    session: AsyncSession,
) -> None:
    client, _fake = fake_storage_client
    await _make_user(session, "su@example.com", is_superuser=True)
    token = await _login(client, "su@example.com")
    create = await client.post(
        "/admin/blog/posts",
        data=_form(slug="goodbye"),
        files=_image_files(),
        headers=_auth(token),
    )
    post = create.json()

    delete = await client.delete(
        f"/admin/blog/posts/{post['id']}", headers=_auth(token)
    )
    assert delete.status_code == 204

    listing = await client.get("/admin/blog/posts", headers=_auth(token))
    assert listing.status_code == 200
    assert listing.json() == []

    # include_deleted=true brings it back
    with_deleted = await client.get(
        "/admin/blog/posts?include_deleted=true", headers=_auth(token)
    )
    assert len(with_deleted.json()) == 1

    # Re-deleting fails as 404
    again = await client.delete(
        f"/admin/blog/posts/{post['id']}", headers=_auth(token)
    )
    assert again.status_code == 404


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "field,value,expected",
    [
        ("slug", "Bad Slug!", "BLOG_SLUG_INVALID"),
        ("locale", "de", "BLOG_LOCALE_INVALID"),
        ("status", "garbage", "BLOG_STATUS_INVALID"),
        ("tags", "not-json", "BLOG_TAGS_INVALID"),
        ("tags", '"not-a-list"', "BLOG_TAGS_INVALID"),
        ("published_at", "not-a-date", "BLOG_PUBLISHED_AT_INVALID"),
        ("title", "   ", "BLOG_TITLE_EMPTY"),
        ("description", "   ", "BLOG_DESCRIPTION_EMPTY"),
        ("content", "   ", "BLOG_CONTENT_EMPTY"),
    ],
)
@pytest.mark.asyncio
async def test_create_rejects_invalid_field(
    fake_storage_client: tuple[AsyncClient, FakeStorage],
    session: AsyncSession,
    field: str,
    value: str,
    expected: str,
) -> None:
    client, _fake = fake_storage_client
    await _make_user(session, "su@example.com", is_superuser=True)
    token = await _login(client, "su@example.com")

    form = _form()
    form[field] = value
    resp = await client.post(
        "/admin/blog/posts",
        data=form,
        files=_image_files(),
        headers=_auth(token),
    )
    assert resp.status_code == 400, resp.text
    assert resp.json()["detail"] == expected


@pytest.mark.asyncio
async def test_create_rejects_wrong_image_type(
    fake_storage_client: tuple[AsyncClient, FakeStorage],
    session: AsyncSession,
) -> None:
    client, _fake = fake_storage_client
    await _make_user(session, "su@example.com", is_superuser=True)
    token = await _login(client, "su@example.com")
    resp = await client.post(
        "/admin/blog/posts",
        data=_form(),
        files={"cover": ("cover.gif", io.BytesIO(b"GIF89aXXX"), "image/gif")},
        headers=_auth(token),
    )
    assert resp.status_code == 400
    assert resp.json()["detail"] == "BLOG_IMAGE_INVALID_TYPE"


@pytest.mark.asyncio
async def test_create_rejects_oversized_image(
    fake_storage_client: tuple[AsyncClient, FakeStorage],
    session: AsyncSession,
) -> None:
    client, _fake = fake_storage_client
    await _make_user(session, "su@example.com", is_superuser=True)
    token = await _login(client, "su@example.com")
    # 6 MB > 5 MB cap
    blob = b"\x00" * (6 * 1024 * 1024)
    resp = await client.post(
        "/admin/blog/posts",
        data=_form(),
        files={"cover": ("big.png", io.BytesIO(blob), "image/png")},
        headers=_auth(token),
    )
    assert resp.status_code == 400
    assert resp.json()["detail"] == "BLOG_IMAGE_TOO_LARGE"


@pytest.mark.asyncio
async def test_slug_collision_409(
    fake_storage_client: tuple[AsyncClient, FakeStorage],
    session: AsyncSession,
) -> None:
    client, _fake = fake_storage_client
    await _make_user(session, "su@example.com", is_superuser=True)
    token = await _login(client, "su@example.com")
    first = await client.post(
        "/admin/blog/posts",
        data=_form(slug="dup"),
        files=_image_files(),
        headers=_auth(token),
    )
    assert first.status_code == 201
    dup = await client.post(
        "/admin/blog/posts",
        data=_form(slug="dup"),
        files=_image_files(),
        headers=_auth(token),
    )
    assert dup.status_code == 409
    assert dup.json()["detail"] == "BLOG_SLUG_TAKEN"


@pytest.mark.asyncio
async def test_same_slug_different_locale_allowed(
    fake_storage_client: tuple[AsyncClient, FakeStorage],
    session: AsyncSession,
) -> None:
    """Slug uniqueness is `(slug, locale)` — the NL translation of a post can
    legitimately reuse the EN slug. Mirrors the file-based pattern."""
    client, _fake = fake_storage_client
    await _make_user(session, "su@example.com", is_superuser=True)
    token = await _login(client, "su@example.com")
    en = await client.post(
        "/admin/blog/posts",
        data=_form(slug="wkb", locale="en", title="WKB Explained"),
        files=_image_files(),
        headers=_auth(token),
    )
    nl = await client.post(
        "/admin/blog/posts",
        data=_form(slug="wkb", locale="nl", title="WKB Uitgelegd"),
        files=_image_files(),
        headers=_auth(token),
    )
    assert en.status_code == 201
    assert nl.status_code == 201


# ---------------------------------------------------------------------------
# Public endpoints
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_public_list_excludes_draft_and_deleted(
    fake_storage_client: tuple[AsyncClient, FakeStorage],
    session: AsyncSession,
) -> None:
    client, _fake = fake_storage_client
    await _make_user(session, "su@example.com", is_superuser=True)
    token = await _login(client, "su@example.com")

    pub = await client.post(
        "/admin/blog/posts",
        data=_form(slug="visible", status="published"),
        files=_image_files(),
        headers=_auth(token),
    )
    assert pub.status_code == 201
    draft = await client.post(
        "/admin/blog/posts",
        data=_form(slug="invisible", status="draft"),
        files=_image_files(),
        headers=_auth(token),
    )
    assert draft.status_code == 201
    deleted = await client.post(
        "/admin/blog/posts",
        data=_form(slug="zombie", status="published"),
        files=_image_files(),
        headers=_auth(token),
    )
    await client.delete(
        f"/admin/blog/posts/{deleted.json()['id']}", headers=_auth(token)
    )

    # Public endpoint requires NO auth
    public = await client.get("/public/blog/posts?locale=en")
    assert public.status_code == 200
    slugs = [p["slug"] for p in public.json()]
    assert slugs == ["visible"]


@pytest.mark.asyncio
async def test_public_get_only_published(
    fake_storage_client: tuple[AsyncClient, FakeStorage],
    session: AsyncSession,
) -> None:
    client, _fake = fake_storage_client
    await _make_user(session, "su@example.com", is_superuser=True)
    token = await _login(client, "su@example.com")

    await client.post(
        "/admin/blog/posts",
        data=_form(slug="hidden", status="draft"),
        files=_image_files(),
        headers=_auth(token),
    )
    pub = await client.get("/public/blog/posts/hidden?locale=en")
    assert pub.status_code == 404
    assert pub.json()["detail"] == "BLOG_POST_NOT_FOUND"


@pytest.mark.asyncio
async def test_public_get_returns_content_inline(
    fake_storage_client: tuple[AsyncClient, FakeStorage],
    session: AsyncSession,
) -> None:
    client, _fake = fake_storage_client
    await _make_user(session, "su@example.com", is_superuser=True)
    token = await _login(client, "su@example.com")
    await client.post(
        "/admin/blog/posts",
        data=_form(
            slug="readable",
            content="# A real headline\n\nA body paragraph " * 30,
        ),
        files=_image_files(),
        headers=_auth(token),
    )
    pub = await client.get("/public/blog/posts/readable?locale=en")
    assert pub.status_code == 200
    body = pub.json()
    assert body["content"].startswith("# A real headline")
    assert body["reading_time_minutes"] >= 1


@pytest.mark.asyncio
async def test_public_list_invalid_locale_400(
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, _fake = fake_storage_client
    resp = await client.get("/public/blog/posts?locale=fr")
    assert resp.status_code == 400
    assert resp.json()["detail"] == "BLOG_LOCALE_INVALID"


# ---------------------------------------------------------------------------
# Bilingual create
# ---------------------------------------------------------------------------


def _bilingual_form(
    *,
    slug: str = "bilingual-post",
    title_en: str = "Hello World",
    content_en: str = "## Hello\n\nThe English body.",
    title_nl: str = "Hallo Wereld",
    content_nl: str = "## Hallo\n\nDe Nederlandse tekst.",
    description: str = "A shared short intro.",
    published_at: str | None = None,
    author: str = "BimDossier",
    tags: str = '["intro","wkb"]',
    status: str = "published",
) -> dict[str, str]:
    return {
        "slug": slug,
        "title_en": title_en,
        "content_en": content_en,
        "title_nl": title_nl,
        "content_nl": content_nl,
        "description": description,
        "published_at": published_at or datetime.now(UTC).isoformat(),
        "author": author,
        "tags": tags,
        "status": status,
    }


def _bilingual_files(
    *,
    content_type: str = "image/png",
    data: bytes = PNG_BYTES,
) -> dict[str, tuple[str, io.BytesIO, str]]:
    """Build the multipart files dict for the bilingual endpoint.

    The bilingual create now takes a single shared cover image — same shape
    as the single-locale endpoint, just under the `cover` part name.
    """
    return {"cover": ("cover.png", io.BytesIO(data), content_type)}


@pytest.mark.asyncio
async def test_create_bilingual_happy_path(
    fake_storage_client: tuple[AsyncClient, FakeStorage],
    session: AsyncSession,
) -> None:
    client, fake = fake_storage_client
    await _make_user(session, "su@example.com", is_superuser=True)
    token = await _login(client, "su@example.com")

    create = await client.post(
        "/admin/blog/posts/bilingual",
        data=_bilingual_form(slug="wkb-bilingual"),
        files=_bilingual_files(),
        headers=_auth(token),
    )
    assert create.status_code == 201, create.text
    body = create.json()
    assert set(body.keys()) == {"en", "nl"}
    assert body["en"]["slug"] == "wkb-bilingual"
    assert body["nl"]["slug"] == "wkb-bilingual"
    assert body["en"]["locale"] == "en"
    assert body["nl"]["locale"] == "nl"
    assert body["en"]["title"] == "Hello World"
    assert body["nl"]["title"] == "Hallo Wereld"
    # Each row has distinct ids + distinct content keys, but share the cover.
    assert body["en"]["id"] != body["nl"]["id"]
    assert body["en"]["cover_image_key"] == body["nl"]["cover_image_key"]
    assert body["en"]["content_key"] != body["nl"]["content_key"]
    # Description is shared between halves.
    assert body["en"]["description"] == body["nl"]["description"]
    # Exactly three blog objects landed: one shared cover + two content files.
    assert f"blog/covers/{body['en']['id']}.png" in fake.objects
    assert f"blog/content/{body['en']['id']}.md" in fake.objects
    assert f"blog/content/{body['nl']['id']}.md" in fake.objects
    blog_keys = [
        k
        for k in fake.objects
        if k.startswith("blog/covers/") or k.startswith("blog/content/")
    ]
    assert len(blog_keys) == 3
    # Both rows surface in the admin listing.
    listing = await client.get("/admin/blog/posts", headers=_auth(token))
    assert listing.status_code == 200
    rows = listing.json()
    assert len(rows) == 2
    assert {r["locale"] for r in rows} == {"en", "nl"}
    assert all(r["slug"] == "wkb-bilingual" for r in rows)
    # Both rows are publicly visible under their respective locale.
    pub_en = await client.get("/public/blog/posts?locale=en")
    assert pub_en.status_code == 200
    assert [p["slug"] for p in pub_en.json()] == ["wkb-bilingual"]
    pub_nl = await client.get("/public/blog/posts?locale=nl")
    assert pub_nl.status_code == 200
    assert [p["slug"] for p in pub_nl.json()] == ["wkb-bilingual"]


@pytest.mark.asyncio
async def test_create_bilingual_requires_superuser(
    fake_storage_client: tuple[AsyncClient, FakeStorage],
    session: AsyncSession,
) -> None:
    client, _fake = fake_storage_client
    await _make_user(session, "norm@example.com", is_superuser=False)
    token = await _login(client, "norm@example.com")

    resp = await client.post(
        "/admin/blog/posts/bilingual",
        data=_bilingual_form(),
        files=_bilingual_files(),
        headers=_auth(token),
    )
    assert resp.status_code == 403
    assert resp.json()["detail"] == "SUPERUSER_REQUIRED"


@pytest.mark.asyncio
async def test_create_bilingual_slug_collision_en_409(
    fake_storage_client: tuple[AsyncClient, FakeStorage],
    session: AsyncSession,
) -> None:
    """Pre-create an EN post via the single-locale endpoint, then attempting
    the bilingual create with the same slug must 409 and leave the DB
    untouched (no NL row created)."""
    client, _fake = fake_storage_client
    await _make_user(session, "su@example.com", is_superuser=True)
    token = await _login(client, "su@example.com")

    pre = await client.post(
        "/admin/blog/posts",
        data=_form(slug="dup-en", locale="en"),
        files=_image_files(),
        headers=_auth(token),
    )
    assert pre.status_code == 201

    resp = await client.post(
        "/admin/blog/posts/bilingual",
        data=_bilingual_form(slug="dup-en"),
        files=_bilingual_files(),
        headers=_auth(token),
    )
    assert resp.status_code == 409
    assert resp.json()["detail"] == "BLOG_SLUG_TAKEN"

    # Confirm: still just the single EN row, no NL leak.
    listing = await client.get("/admin/blog/posts", headers=_auth(token))
    rows = listing.json()
    assert len(rows) == 1
    assert rows[0]["locale"] == "en"


@pytest.mark.asyncio
async def test_create_bilingual_slug_collision_nl_409(
    fake_storage_client: tuple[AsyncClient, FakeStorage],
    session: AsyncSession,
) -> None:
    """Same as the EN-collision case but the pre-existing row is NL."""
    client, _fake = fake_storage_client
    await _make_user(session, "su@example.com", is_superuser=True)
    token = await _login(client, "su@example.com")

    pre = await client.post(
        "/admin/blog/posts",
        data=_form(slug="dup-nl", locale="nl", title="Bestaand"),
        files=_image_files(),
        headers=_auth(token),
    )
    assert pre.status_code == 201

    resp = await client.post(
        "/admin/blog/posts/bilingual",
        data=_bilingual_form(slug="dup-nl"),
        files=_bilingual_files(),
        headers=_auth(token),
    )
    assert resp.status_code == 409
    assert resp.json()["detail"] == "BLOG_SLUG_TAKEN"

    listing = await client.get("/admin/blog/posts", headers=_auth(token))
    rows = listing.json()
    assert len(rows) == 1
    assert rows[0]["locale"] == "nl"


@pytest.mark.asyncio
async def test_create_bilingual_rejects_invalid_cover_type(
    fake_storage_client: tuple[AsyncClient, FakeStorage],
    session: AsyncSession,
) -> None:
    """A bad MIME on the shared cover must reject the whole request before
    any DB rows are written."""
    client, fake = fake_storage_client
    await _make_user(session, "su@example.com", is_superuser=True)
    token = await _login(client, "su@example.com")

    resp = await client.post(
        "/admin/blog/posts/bilingual",
        data=_bilingual_form(slug="bad-image"),
        files=_bilingual_files(content_type="image/gif"),
        headers=_auth(token),
    )
    assert resp.status_code == 400
    assert resp.json()["detail"] == "BLOG_IMAGE_INVALID_TYPE"

    # Zero rows, zero objects — fail-fast happened before any side effect.
    listing = await client.get("/admin/blog/posts", headers=_auth(token))
    assert listing.json() == []
    assert fake.objects == {}


@pytest.mark.asyncio
async def test_create_bilingual_rolls_back_on_db_error(
    fake_storage_client: tuple[AsyncClient, FakeStorage],
    session: AsyncSession,
) -> None:
    """A direct DB-level constraint violation is hard to inject without
    monkey-patching the session, so we exercise the rollback path via the
    only other route into the IntegrityError branch: a slug that has been
    soft-deleted (the pre-check ignores soft-deleted rows, but the unique
    constraint does not) — wait, the constraint is over live rows only via
    the partial index? No: it's a plain UniqueConstraint, so any (slug,
    locale) collision raises IntegrityError on commit.

    The pre-check skips soft-deleted rows, so the bilingual path proceeds
    to upload + insert; the existing soft-deleted row then conflicts at
    commit time, hitting the IntegrityError branch which must:
      - rollback the transaction (no new rows visible),
      - best-effort delete all four S3 objects,
      - raise 409 BLOG_SLUG_TAKEN.
    """
    client, fake = fake_storage_client
    await _make_user(session, "su@example.com", is_superuser=True)
    token = await _login(client, "su@example.com")

    # Pre-create EN + NL singly, then soft-delete the EN row.
    pre_en = await client.post(
        "/admin/blog/posts",
        data=_form(slug="rollback-test", locale="en"),
        files=_image_files(),
        headers=_auth(token),
    )
    assert pre_en.status_code == 201
    pre_id = pre_en.json()["id"]
    delete = await client.delete(
        f"/admin/blog/posts/{pre_id}", headers=_auth(token)
    )
    assert delete.status_code == 204

    # Snapshot live (non-deleted) blog rows before the bilingual attempt.
    listing_before = await client.get("/admin/blog/posts", headers=_auth(token))
    live_before = len(listing_before.json())

    resp = await client.post(
        "/admin/blog/posts/bilingual",
        data=_bilingual_form(slug="rollback-test"),
        files=_bilingual_files(),
        headers=_auth(token),
    )
    # The DB-level uniqueness check sees the soft-deleted row and rejects
    # the EN insert at commit. The endpoint translates that into 409.
    assert resp.status_code == 409, resp.text
    assert resp.json()["detail"] == "BLOG_SLUG_TAKEN"

    # No new live rows.
    listing_after = await client.get("/admin/blog/posts", headers=_auth(token))
    assert len(listing_after.json()) == live_before

    # And the bilingual-flow S3 objects were cleaned up — none of the keys
    # whose UUIDs match the new (uncommitted) rows survived.
    rollback_keys = [
        k for k in fake.objects if k.startswith(("blog/covers/", "blog/content/"))
    ]
    # Only the pre-existing EN row's keys remain (the soft-deleted one).
    pre_keys = {
        pre_en.json()["cover_image_key"],
        pre_en.json()["content_key"],
    }
    assert set(rollback_keys) <= pre_keys
