"""Two-phase org lifecycle — phase 2 hard purge (`purge_organization`).

These exercise the core teardown function directly (the admin endpoint is in
test_admin_org_purge.py). In the public-only test harness there are no real
per-tenant schemas, so `DROP SCHEMA IF EXISTS "org_<hex>"` is a no-op and the
`SET LOCAL search_path` enumeration falls through to `public`; a single seeded
org therefore reads exactly its own rows. The schema-drop itself is covered by
end-to-end verification (it reuses `drop_tenant_schema`, shared with provisioning).
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from bimdossier_api.admin.provisioning import (
    PURGE_DONE,
    PURGE_DRY_RUN,
    PURGE_SKIPPED_ALREADY_PURGED,
    PURGE_SKIPPED_NOT_DELETED,
    PURGE_SKIPPED_NOT_DUE,
    purge_organization,
)
from bimdossier_api.models.certificate import CertificateStatus, CertificateType
from bimdossier_api.models.org_certificate import OrgCertificate
from bimdossier_api.models.organization import Organization, OrganizationStatus
from bimdossier_api.models.project import Project
from bimdossier_api.models.user import User
from bimdossier_api.tenancy import schema_name_for
from tests.conftest import FakeStorage, _audit_rows


@pytest.fixture
def _patch_db(engine, session_maker):  # type: ignore[no-untyped-def]
    """Point the global engine/session-maker at the test DB so the directly-called
    `purge_organization` (which uses `get_session_maker()`) hits the seeded data."""
    from bimdossier_api import db as db_module

    db_module._engine = engine
    db_module._session_maker = session_maker
    yield


async def _seed_soft_deleted_org(
    session: AsyncSession,
    *,
    name: str,
    deleted_days_ago: float,
    with_content: bool = False,
    image_key: str | None = None,
) -> tuple[Organization, list[str]]:
    """Insert a soft-deleted org (+ optional tenant content) and return the org and
    the storage keys that a purge should delete."""
    org_id = uuid4()
    org = Organization(
        id=org_id,
        name=name,
        schema_name=schema_name_for(org_id),
        status=OrganizationStatus.deleted,
        deleted_at=datetime.now(UTC) - timedelta(days=deleted_days_ago),
        image_key=image_key,
    )
    session.add(org)
    await session.flush()

    keys: list[str] = []
    if image_key:
        keys.append(image_key)
    if with_content:
        owner = User(
            email=f"owner-{org_id.hex[:8]}@example.com",
            hashed_password="x",
            full_name="Owner",
            is_active=True,
            is_verified=True,
        )
        session.add(owner)
        await session.flush()

        thumb_key = f"thumbnails/{uuid4()}.png"
        project = Project(name="P", owner_id=owner.id, thumbnail_url=thumb_key)
        session.add(project)
        await session.flush()
        keys.append(thumb_key)
        keys.append(f"projects/{project.id}/documents/model.ifc")
        keys.append(f"projects/{project.id}/attachments/photo.jpg")

        org_cert_key = f"org-certificates/{uuid4()}.pdf"
        session.add(
            OrgCertificate(
                storage_key=org_cert_key,
                original_filename="c.pdf",
                size_bytes=10,
                content_type="application/pdf",
                certificate_type=next(iter(CertificateType)),
                status=CertificateStatus.ready,
            )
        )
        keys.append(org_cert_key)

        keys.append(f"reports/{org_id}/{project.id}/r.pdf")
        keys.append(f"report-templates/{org_id}/logo/l.png")
        keys.append(f"bcf-snapshots/{org.schema_name}/t/v.png")

    await session.commit()
    return org, keys


async def _get_org(
    session_maker: async_sessionmaker[AsyncSession], org_id: UUID
) -> Organization:
    async with session_maker() as s:
        return (
            await s.execute(select(Organization).where(Organization.id == org_id))
        ).scalar_one()


# ── delete_prefix safety ─────────────────────────────────────────────────────


async def test_fake_delete_prefix_rejects_empty_prefix() -> None:
    fake = FakeStorage()
    fake.objects["projects/a/x"] = b"x"
    for bad in ("", "   "):
        with pytest.raises(ValueError):
            await fake.delete_prefix(bad)
    assert fake.objects  # nothing deleted


async def test_s3_delete_prefix_rejects_empty_prefix() -> None:
    """The real backend must refuse an empty prefix BEFORE any S3 call — an empty
    prefix lists the whole shared multi-tenant bucket."""
    from bimdossier_api.config import get_settings
    from bimdossier_api.storage.minio import S3Storage

    storage = S3Storage(get_settings())
    for bad in ("", "   "):
        with pytest.raises(ValueError):
            await storage.delete_prefix(bad)


# ── purge_organization guards ────────────────────────────────────────────────


async def test_purge_skips_live_org(_patch_db, session, session_maker) -> None:
    org_id = uuid4()
    org = Organization(
        id=org_id, name="Live", schema_name=schema_name_for(org_id),
        status=OrganizationStatus.active,
    )
    session.add(org)
    await session.commit()

    fake = FakeStorage()
    result = await purge_organization(organization_id=org_id, storage=fake)
    assert result.status == PURGE_SKIPPED_NOT_DELETED
    assert fake.deleted == []
    assert (await _get_org(session_maker, org_id)).purged_at is None


async def test_purge_skips_org_within_retention(_patch_db, session, session_maker) -> None:
    org, _ = await _seed_soft_deleted_org(session, name="Recent", deleted_days_ago=1)
    fake = FakeStorage()
    result = await purge_organization(organization_id=org.id, storage=fake)
    assert result.status == PURGE_SKIPPED_NOT_DUE
    assert fake.deleted == []
    assert (await _get_org(session_maker, org.id)).purged_at is None


async def test_purge_dry_run_changes_nothing(_patch_db, session, session_maker) -> None:
    org, keys = await _seed_soft_deleted_org(
        session, name="DryRun", deleted_days_ago=40, with_content=True,
        image_key="org-images/dry.png",
    )
    fake = FakeStorage()
    for k in keys:
        fake.objects[k] = b"x"

    result = await purge_organization(organization_id=org.id, storage=fake, dry_run=True)
    assert result.status == PURGE_DRY_RUN
    assert result.targets  # reports what WOULD be deleted
    assert fake.deleted == []  # but deletes nothing
    assert all(k in fake.objects for k in keys)
    assert (await _get_org(session_maker, org.id)).purged_at is None


# ── purge_organization happy path ────────────────────────────────────────────


async def test_purge_due_org_wipes_every_family(_patch_db, session, session_maker) -> None:
    org, keys = await _seed_soft_deleted_org(
        session, name="Due", deleted_days_ago=40, with_content=True,
        image_key="org-images/due.png",
    )
    fake = FakeStorage()
    for k in keys:
        fake.objects[k] = b"x"
    fake.objects["unrelated/keep.bin"] = b"keep"  # must survive

    result = await purge_organization(organization_id=org.id, storage=fake)

    assert result.status == PURGE_DONE
    # every owned object family is gone...
    for k in keys:
        assert k not in fake.objects, f"{k} should have been deleted"
        assert k in fake.deleted
    # ...the org logo (a PUBLIC row that SURVIVES the schema drop) included...
    assert "org-images/due.png" in fake.deleted
    # ...and an unrelated object is untouched.
    assert fake.objects.get("unrelated/keep.bin") == b"keep"

    refreshed = await _get_org(session_maker, org.id)
    assert refreshed.purged_at is not None
    assert refreshed.image_key is None  # cleared on purge

    audit = await _audit_rows(session_maker, "organization.purged")
    assert len(audit) == 1


async def test_purge_now_ignores_retention(_patch_db, session, session_maker) -> None:
    org, _ = await _seed_soft_deleted_org(session, name="Now", deleted_days_ago=1)
    fake = FakeStorage()
    result = await purge_organization(organization_id=org.id, storage=fake, now=True)
    assert result.status == PURGE_DONE
    assert (await _get_org(session_maker, org.id)).purged_at is not None


async def test_purge_is_idempotent(_patch_db, session, session_maker) -> None:
    org, _ = await _seed_soft_deleted_org(session, name="Twice", deleted_days_ago=40)
    fake = FakeStorage()
    first = await purge_organization(organization_id=org.id, storage=fake)
    assert first.status == PURGE_DONE
    purged_at = (await _get_org(session_maker, org.id)).purged_at

    fake2 = FakeStorage()
    second = await purge_organization(organization_id=org.id, storage=fake2)
    assert second.status == PURGE_SKIPPED_ALREADY_PURGED
    assert fake2.deleted == []  # no second wipe
    assert (await _get_org(session_maker, org.id)).purged_at == purged_at


async def test_purge_aborts_drop_when_storage_wipe_fails(
    _patch_db, session, session_maker
) -> None:
    """A storage-wipe failure must abort before DROP SCHEMA: dropping after a
    partial wipe would orphan the survivors forever."""

    class _BoomStorage(FakeStorage):
        async def delete_prefix(self, prefix: str, *, bucket: str | None = None) -> int:
            raise RuntimeError("s3 down")

    org, _ = await _seed_soft_deleted_org(session, name="Boom", deleted_days_ago=40)
    with pytest.raises(RuntimeError):
        await purge_organization(organization_id=org.id, storage=_BoomStorage())

    # purged_at NOT set → the org is retried cleanly next run.
    assert (await _get_org(session_maker, org.id)).purged_at is None


# ── CLI flag validation (no DB / no asyncio.run) ─────────────────────────────


def test_cli_requires_exactly_one_target() -> None:
    from bimdossier_api.scripts.purge_organizations import main

    assert main([]) == 1  # neither --org nor --due
    assert main(["--now"]) == 1  # --now without --org
    assert main(["--now", "--due"]) == 1  # --now with a batch
