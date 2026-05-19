from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from bimstitch_api.models._mixins import SoftDeleteMixin


# Override conftest's autouse DB/Redis fixtures — pure-unit test.
@pytest.fixture(autouse=True)
def _clean_tables() -> None:
    return None


@pytest.fixture(autouse=True)
def _flush_redis() -> None:
    return None


@pytest.fixture(autouse=True)
def _stub_extraction_dispatcher() -> None:
    return None


class _Sample(SoftDeleteMixin):
    """Concrete carrier for testing the mixin without binding to a real table.

    The mixin's interesting behaviour is in `soft_delete()`/`restore()` and
    the `is_deleted` property — none of which touch SQLAlchemy state.
    """

    def __init__(self) -> None:
        # Mirror the column default the ORM would assign on insert.
        self.deleted_at = None


def test_is_deleted_false_by_default() -> None:
    row = _Sample()
    assert row.is_deleted is False
    assert row.deleted_at is None


def test_soft_delete_sets_timestamp() -> None:
    row = _Sample()
    before = datetime.now(timezone.utc)
    row.soft_delete()
    after = datetime.now(timezone.utc)
    assert row.deleted_at is not None
    assert before <= row.deleted_at <= after
    assert row.is_deleted is True


def test_soft_delete_accepts_explicit_now() -> None:
    fixed = datetime(2026, 5, 18, 12, 0, 0, tzinfo=timezone.utc)
    row = _Sample()
    row.soft_delete(now=fixed)
    assert row.deleted_at == fixed


def test_soft_delete_is_idempotent() -> None:
    fixed = datetime(2026, 5, 18, 12, 0, 0, tzinfo=timezone.utc)
    later = fixed + timedelta(hours=1)
    row = _Sample()
    row.soft_delete(now=fixed)
    row.soft_delete(now=later)
    # The second call must NOT overwrite the original deletion timestamp.
    assert row.deleted_at == fixed


def test_restore_clears_timestamp() -> None:
    row = _Sample()
    row.soft_delete()
    assert row.is_deleted is True
    row.restore()
    assert row.is_deleted is False
    assert row.deleted_at is None


def test_restore_on_active_row_is_noop() -> None:
    row = _Sample()
    row.restore()
    assert row.deleted_at is None
    assert row.is_deleted is False
