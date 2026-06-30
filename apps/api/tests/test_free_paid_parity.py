"""Free↔paid enum/CHECK value-set parity — the "kept in lockstep" promise as a gate.

Every ``free_*`` table replaces the paid Postgres enum with a ``String`` + ``CHECK``
whose value set must stay compatible with the paid enum; otherwise a free→paid
conversion casts a value the paid enum rejects. The free models claim this lockstep
in doc-comments ("value sets derived from the paid enums … so the two stay in
lockstep"). This test turns that promise into CI — the same pattern as
``test_i18n_catalog`` / ``test_error_catalog``.

Two relationships:

- **EXACT** — the free set is DERIVED from the paid enum (``tuple(e.value for e in
  Enum)``) or documented value-identical, so it must EQUAL the paid enum's values.
  Drift (paid gains a value, free doesn't) fails CI until reconciled.
- **SUBSET** — free intentionally exposes a NARROWER set (free is IFC+PDF only,
  invited members are editor/viewer, only terminal job events fire). Free must still
  be a subset — a free value the paid enum lacks would break conversion.

Pure value comparison — no DB, no app — so it is fast and Windows-flake-free.
"""

from __future__ import annotations

from collections.abc import Iterable
from enum import Enum

import pytest

from bimdossier_api.models import (
    POOLED_DOC_DISCIPLINES,
    POOLED_DOC_FILE_TYPES,
    POOLED_DOC_STATUSES,
    POOLED_FILE_EXTRACTION_STATUSES,
    POOLED_FILE_STATUSES,
    POOLED_FINDING_SEVERITIES,
    POOLED_FINDING_STATUSES,
    POOLED_LEVEL_SOURCES,
    POOLED_MEMBER_ROLES,
    POOLED_NOTIFICATION_EVENT_TYPES,
    POOLED_PROJECT_BUILDING_TYPES,
    POOLED_PROJECT_LIFECYCLE_STATES,
    POOLED_PROJECT_PHASES,
    DocumentDiscipline,
    DocumentStatus,
    ExtractionStatus,
    FileType,
    FindingSeverity,
    FindingStatus,
    LevelSource,
    NotificationEventType,
    ProjectFileStatus,
    ProjectLifecycleState,
    ProjectPhase,
    ProjectRole,
)
from bimdossier_api.models.project import BuildingType


def _vals(items: Iterable[object] | type) -> set[str]:
    """Normalize a paid value source to its set of string values. Handles a paid
    ``Enum`` class, a plain constants-holder class (e.g. ``LevelSource``, whose paid
    column is itself ``String`` + ``CHECK``), or a free tuple of strings/enum
    members."""
    if isinstance(items, type) and issubclass(items, Enum):
        return {str(member.value) for member in items}
    if isinstance(items, type):
        # Constants-holder class: collect its public string class attributes.
        return {
            value
            for name, value in vars(items).items()
            if not name.startswith("_") and isinstance(value, str)
        }
    return {str(getattr(v, "value", v)) for v in items}


# (label, free constant, paid enum) — the free set must EQUAL the paid enum's values.
EXACT_PAIRS = [
    ("project.phase", POOLED_PROJECT_PHASES, ProjectPhase),
    ("project.lifecycle_state", POOLED_PROJECT_LIFECYCLE_STATES, ProjectLifecycleState),
    ("project.building_type", POOLED_PROJECT_BUILDING_TYPES, BuildingType),
    ("finding.severity", POOLED_FINDING_SEVERITIES, FindingSeverity),
    ("finding.status", POOLED_FINDING_STATUSES, FindingStatus),
    ("document.discipline", POOLED_DOC_DISCIPLINES, DocumentDiscipline),
    ("document.status", POOLED_DOC_STATUSES, DocumentStatus),
    ("project_file.status", POOLED_FILE_STATUSES, ProjectFileStatus),
    ("project_file.extraction_status", POOLED_FILE_EXTRACTION_STATUSES, ExtractionStatus),
]

# (label, free constant, paid enum) — free is an intentional NARROWER subset.
SUBSET_PAIRS = [
    ("document.primary_file_type", POOLED_DOC_FILE_TYPES, FileType),
    ("project_member.role", POOLED_MEMBER_ROLES, ProjectRole),
    ("notification.event_type", POOLED_NOTIFICATION_EVENT_TYPES, NotificationEventType),
    ("level.source", POOLED_LEVEL_SOURCES, LevelSource),
]


@pytest.mark.parametrize(
    "label, free_set, paid_enum", EXACT_PAIRS, ids=[p[0] for p in EXACT_PAIRS]
)
def test_free_check_set_matches_paid_enum_exactly(
    label: str, free_set: Iterable[object], paid_enum: type
) -> None:
    free_vals = _vals(free_set)
    paid_vals = _vals(paid_enum)
    assert free_vals == paid_vals, (
        f"{label}: free CHECK set {sorted(free_vals)} drifted from paid enum "
        f"{paid_enum.__name__} {sorted(paid_vals)}. Reconcile the free model "
        f"constant (missing: {paid_vals - free_vals}, extra: {free_vals - paid_vals})."
    )


@pytest.mark.parametrize(
    "label, free_set, paid_enum", SUBSET_PAIRS, ids=[p[0] for p in SUBSET_PAIRS]
)
def test_free_check_set_is_subset_of_paid_enum(
    label: str, free_set: Iterable[object], paid_enum: type
) -> None:
    free_vals = _vals(free_set)
    paid_vals = _vals(paid_enum)
    assert free_vals, f"{label}: free set is unexpectedly empty"
    extra = free_vals - paid_vals
    assert not extra, (
        f"{label}: free CHECK set has values absent from paid enum "
        f"{paid_enum.__name__}: {sorted(extra)} — these would fail free→paid "
        f"conversion (paid enum: {sorted(paid_vals)})."
    )
