"""Tests for the artifact-key validator that gates every Arbiter S3 read."""

from __future__ import annotations

import pytest

from arbiter.storage import validate_artifact_key


def test_accepts_real_metadata_and_properties_keys() -> None:
    meta = "projects/abc-123/source/def-456.metadata.json"
    props = "projects/abc-123/source/def-456.properties.json"
    assert validate_artifact_key(meta, suffix=".metadata.json") == meta
    assert validate_artifact_key(props, suffix=".properties.json") == props


@pytest.mark.parametrize(
    "bad",
    [
        "",  # empty
        "../../etc/passwd.metadata.json",  # traversal
        "/abs/path.metadata.json",  # absolute
        "http://evil.example/x.metadata.json",  # URL / scheme
        "projects/abc\\source.metadata.json",  # backslash
        "projects/ abc/x.metadata.json",  # space → disallowed charset
        "projects/abc/source/def.ifc",  # wrong object type
        "projects/abc/source/def.properties.json",  # wrong suffix for metadata
    ],
)
def test_rejects_bad_metadata_keys(bad: str) -> None:
    with pytest.raises(ValueError):
        validate_artifact_key(bad, suffix=".metadata.json")


def test_per_parameter_suffix_is_enforced() -> None:
    # A valid metadata key is NOT a valid properties key, and vice versa.
    meta = "projects/abc/source/def.metadata.json"
    with pytest.raises(ValueError):
        validate_artifact_key(meta, suffix=".properties.json")
