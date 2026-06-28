"""Unit tests for the shared object-storage tenant-prefix choke-point."""

from __future__ import annotations

import pytest
from fastapi import HTTPException

from bimdossier_api.storage.scoping import assert_key_scoped


def test_in_prefix_passes() -> None:
    assert_key_scoped("projects/abc/file.frag", "projects/abc/")  # no raise


def test_none_passes() -> None:
    # An absent optional artifact key is allowed through.
    assert_key_scoped(None, "projects/abc/")  # no raise


def test_out_of_prefix_rejected() -> None:
    with pytest.raises(HTTPException) as exc:
        assert_key_scoped("projects/other/evil.frag", "projects/abc/")
    assert exc.value.status_code == 400
    assert exc.value.detail == "INVALID_STORAGE_KEY"


def test_custom_detail_propagates() -> None:
    with pytest.raises(HTTPException) as exc:
        assert_key_scoped(
            "report-templates/other/x.png",
            "report-templates/abc/",
            detail="INVALID_ASSET_KEY",
        )
    assert exc.value.status_code == 400
    assert exc.value.detail == "INVALID_ASSET_KEY"
