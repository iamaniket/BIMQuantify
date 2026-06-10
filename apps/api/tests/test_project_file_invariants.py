"""DB-level invariants of the unified ``project_files`` table.

After folding ``attachments`` into ``project_files``, the table backs two roles
(``model_source`` / ``attachment``) and the role↔model_id relationship is held
by two CHECK constraints. Versioning is anchored differently per role, enforced
by two partial unique indexes. These tests exercise the constraints directly
against Postgres (rows inserted into the test schema), independent of the
HTTP layer.
"""

from __future__ import annotations

from typing import TYPE_CHECKING
from uuid import uuid4

import pytest
from sqlalchemy.exc import IntegrityError

from bimstitch_api.models.model import Model, ModelDiscipline
from bimstitch_api.models.project import Project
from bimstitch_api.models.project_file import (
    ProjectFile,
    ProjectFileRole,
    ProjectFileStatus,
)
from bimstitch_api.models.user import User

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

pytestmark = pytest.mark.asyncio


def _file(**kw: object) -> ProjectFile:
    base: dict[str, object] = {
        "storage_key": f"projects/x/{uuid4()}.bin",
        "original_filename": "f.bin",
        "size_bytes": 1,
        "content_type": "application/octet-stream",
        "status": ProjectFileStatus.pending,
    }
    base.update(kw)
    return ProjectFile(**base)


async def _seed_project_and_model(session: AsyncSession) -> tuple[Project, Model]:
    user = User(email=f"{uuid4().hex}@ex.com", hashed_password="x")
    session.add(user)
    await session.flush()
    project = Project(name="P", owner_id=user.id)
    session.add(project)
    await session.flush()
    model = Model(project_id=project.id, name="M", discipline=ModelDiscipline.architectural)
    session.add(model)
    await session.flush()
    return project, model


async def test_model_source_requires_model_id(
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    async with session_maker() as session:
        project, _ = await _seed_project_and_model(session)
        session.add(
            _file(project_id=project.id, role=ProjectFileRole.model_source, model_id=None)
        )
        with pytest.raises(IntegrityError) as exc:
            await session.flush()
    assert "ck_project_files_model_source_has_model" in str(exc.value)


async def test_attachment_must_not_claim_model_id(
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    async with session_maker() as session:
        project, model = await _seed_project_and_model(session)
        session.add(
            _file(project_id=project.id, role=ProjectFileRole.attachment, model_id=model.id)
        )
        with pytest.raises(IntegrityError) as exc:
            await session.flush()
    assert "ck_project_files_attachment_no_model" in str(exc.value)


async def test_model_and_attachment_version_numbers_are_independent(
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """A model source and an attachment in the same project can both be v1/v2 —
    the two roles version against different anchors, so the numbers never clash."""
    async with session_maker() as session:
        project, model = await _seed_project_and_model(session)
        # Model versions: anchored by model_id.
        session.add(
            _file(
                project_id=project.id,
                role=ProjectFileRole.model_source,
                model_id=model.id,
                version_number=1,
            )
        )
        session.add(
            _file(
                project_id=project.id,
                role=ProjectFileRole.model_source,
                model_id=model.id,
                version_number=2,
            )
        )
        # Attachment lineage: anchored by self-FK (root has NULL parent).
        att_root = _file(
            project_id=project.id,
            role=ProjectFileRole.attachment,
            version_number=1,
        )
        session.add(att_root)
        await session.flush()
        session.add(
            _file(
                project_id=project.id,
                role=ProjectFileRole.attachment,
                version_number=2,
                parent_file_id=att_root.id,
            )
        )
        # No IntegrityError despite overlapping version numbers across roles.
        await session.flush()


async def test_duplicate_model_version_number_rejected(
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    async with session_maker() as session:
        project, model = await _seed_project_and_model(session)
        session.add(
            _file(
                project_id=project.id,
                role=ProjectFileRole.model_source,
                model_id=model.id,
                version_number=1,
            )
        )
        await session.flush()
        session.add(
            _file(
                project_id=project.id,
                role=ProjectFileRole.model_source,
                model_id=model.id,
                version_number=1,
            )
        )
        with pytest.raises(IntegrityError) as exc:
            await session.flush()
    assert "ux_project_files_model_version" in str(exc.value)


async def test_duplicate_attachment_version_in_group_rejected(
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """The attachment version-group unique index (coalesce(parent_file_id, id),
    version_number) rejects two rows claiming the same version of one lineage."""
    async with session_maker() as session:
        project, _ = await _seed_project_and_model(session)
        root = _file(project_id=project.id, role=ProjectFileRole.attachment, version_number=1)
        session.add(root)
        await session.flush()
        session.add(
            _file(
                project_id=project.id,
                role=ProjectFileRole.attachment,
                version_number=1,
                parent_file_id=root.id,
            )
        )
        with pytest.raises(IntegrityError) as exc:
            await session.flush()
    assert "ux_project_files_version_group" in str(exc.value)


async def test_same_bytes_in_different_roles_both_persist(
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """Dedup is per-role (role is in the unique key): a model source and an
    attachment in the same project may carry identical bytes — both persist."""
    sha = "b" * 64
    async with session_maker() as session:
        project, model = await _seed_project_and_model(session)
        session.add(
            _file(
                project_id=project.id,
                role=ProjectFileRole.model_source,
                model_id=model.id,
                content_sha256=sha,
                status=ProjectFileStatus.ready,
            )
        )
        session.add(
            _file(
                project_id=project.id,
                role=ProjectFileRole.attachment,
                content_sha256=sha,
                status=ProjectFileStatus.ready,
            )
        )
        # No IntegrityError despite identical (project_id, content_sha256).
        await session.flush()


async def test_soft_deleted_row_frees_the_dedup_slot(
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """Regression: the content dedup index excludes deleted rows. soft_delete()
    only stamps deleted_at (status stays 'ready'), so without the
    `deleted_at IS NULL` clause a re-upload of the same bytes after deletion
    would trip the unique index. It must NOT."""
    sha = "c" * 64
    async with session_maker() as session:
        project, _ = await _seed_project_and_model(session)
        first = _file(
            project_id=project.id,
            role=ProjectFileRole.attachment,
            content_sha256=sha,
            status=ProjectFileStatus.ready,
        )
        session.add(first)
        await session.flush()
        first.soft_delete()
        await session.flush()
        # Same project/role/bytes again — allowed because `first` is deleted.
        session.add(
            _file(
                project_id=project.id,
                role=ProjectFileRole.attachment,
                content_sha256=sha,
                status=ProjectFileStatus.ready,
            )
        )
        await session.flush()
