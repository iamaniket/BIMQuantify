"""Real automated-check coverage figures for the public status surface.

These are the *implemented* (i.e. actually-running automated) rule counts per
framework — the honest trust signal the login/marketing KPI strips display in
place of the old made-up "version" numbers (e.g. "Wkb 2026.1").

Source of truth is the Arbiter rule packs, whose hand-curated summaries live at:

- ``apps/arbiter/rules/nl/wkb/manifest.yaml`` -> ``summary.implemented``
- ``apps/arbiter/rules/nl/bbl/manifest.yaml`` -> ``summary.implemented``

The Arbiter is a separate service (no import/runtime coupling here — see
``compliance/__init__.py``), so these are mirrored as constants rather than
fetched live on the public, frequently-polled status endpoint. Drift is caught
in CI by ``tests/test_rule_coverage.py``, which reads the manifests and asserts
these values match. When a rule pack's implemented count changes, update the
manifest and bump the matching constant here in the same change.
"""

from __future__ import annotations

# Wkb (Wet kwaliteitsborging voor het bouwen) — implemented automated checks.
WKB_IMPLEMENTED_CHECKS = 8

# BBL (Besluit bouwwerken leefomgeving) — implemented automated checks.
BBL_IMPLEMENTED_CHECKS = 52
