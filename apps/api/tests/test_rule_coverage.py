"""Guard: the public-status coverage constants must track the Arbiter manifests.

The login/marketing KPI strips advertise real implemented-check counts sourced
from ``bimdossier_api.compliance.coverage``. Those constants mirror the Arbiter
rule-pack manifests (a separate service — no runtime coupling). This test reads
the manifests from the monorepo and fails if the mirrored constants drift, so a
rule-pack change that forgets to bump the constant is caught in CI.

It also pins the advertised IFC schema list to what the parser actually accepts.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from bimdossier_api.compliance.coverage import (
    BBL_IMPLEMENTED_CHECKS,
    WKB_IMPLEMENTED_CHECKS,
)
from bimdossier_api.ifc.header import _KNOWN_SCHEMAS, supported_ifc_schemas

# apps/api/tests/ -> repo root is three parents up.
_REPO_ROOT = Path(__file__).resolve().parents[3]
_RULES_DIR = _REPO_ROOT / "apps" / "arbiter" / "rules" / "nl"

# Matches the `implemented: N` line inside the manifest's `summary:` block.
# Individual rule entries use `status: implemented` (no trailing number), so a
# bare `implemented: <int>` is unique to the summary.
_IMPLEMENTED_RE = re.compile(r"^\s*implemented:\s*(\d+)\s*$", re.MULTILINE)


def _manifest_implemented(framework: str) -> int:
    manifest = _RULES_DIR / framework / "manifest.yaml"
    if not manifest.exists():
        pytest.skip(f"arbiter manifest not present: {manifest}")
    match = _IMPLEMENTED_RE.search(manifest.read_text(encoding="utf-8"))
    assert match is not None, f"no `implemented:` summary count in {manifest}"
    return int(match.group(1))


def test_wkb_coverage_matches_manifest() -> None:
    assert _manifest_implemented("wkb") == WKB_IMPLEMENTED_CHECKS


def test_bbl_coverage_matches_manifest() -> None:
    assert _manifest_implemented("bbl") == BBL_IMPLEMENTED_CHECKS


def test_supported_ifc_schemas_match_parser() -> None:
    assert supported_ifc_schemas() == sorted(_KNOWN_SCHEMAS)
    # Sanity: the values we advertise are the real accepted schemas, no IFC4X1.
    assert "IFC4X1" not in supported_ifc_schemas()
    assert set(supported_ifc_schemas()) == {"IFC2X3", "IFC4", "IFC4X3"}
