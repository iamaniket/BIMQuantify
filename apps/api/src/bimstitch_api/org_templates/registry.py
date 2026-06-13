"""Report-template section + merge-field registry — the builder source of truth.

Pure-Python, no DB. For each report `ReportType` it declares:

- the **content sections** a template may toggle / reorder / re-title. Their KEYS
  MUST match the renderer section keys in
  ``apps/processor/src/pipeline/report/templates/*.ts`` — the processor stays
  canonical for actual render order; a parity test guards the key sets on both
  sides (`tests/test_org_templates.py::test_section_key_parity` and the processor
  vitest). The labels here drive only the builder UI (the rendered headings come
  from the processor's jurisdiction labels unless a `title_override` is set).
- the scalar, project-level **merge fields** available to free-text blocks
  (mirrors `_project_payload` in ``routers/reports.py``).

`GET /org-templates/schema?template_type=<report_type>` flattens these to the
requesting locale for the portal builder.
"""

from __future__ import annotations

from dataclasses import dataclass

from bimstitch_api.models.report import ReportType


@dataclass(frozen=True)
class SectionDef:
    key: str
    label_en: str
    label_nl: str

    def label(self, locale: str) -> str:
        return self.label_nl if locale.lower().startswith("nl") else self.label_en


@dataclass(frozen=True)
class MergeField:
    path: str
    label_en: str
    label_nl: str

    def label(self, locale: str) -> str:
        return self.label_nl if locale.lower().startswith("nl") else self.label_en


# Scalar, project-level merge fields available to every report type's text blocks.
# Mirrors the `_project_payload` shape in routers/reports.py.
_COMMON_MERGE_FIELDS: tuple[MergeField, ...] = (
    MergeField("project.name", "Project name", "Projectnaam"),
    MergeField("project.reference_code", "Reference", "Projectkenmerk"),
    MergeField("project.permit_number", "Permit number", "Vergunningsnummer"),
    MergeField("project.address.city", "City", "Plaats"),
    MergeField("contractor.name", "Contractor", "Aannemer"),
    MergeField("contractor.kvk_number", "KvK number", "KvK-nummer"),
    MergeField("report.generated_at", "Generated at", "Gegenereerd op"),
    MergeField("instrument.name", "Instrument", "Instrument"),
)

# Content-section keys per report type. KEYS must match the processor renderers'
# content-section map (parity test). Cover pages are always rendered and are not
# toggleable sections.
_SECTIONS: dict[ReportType, tuple[SectionDef, ...]] = {
    ReportType.compliance_report: (
        SectionDef("by_category", "By category", "Per categorie"),
        SectionDef("by_rule", "By rule", "Per regel"),
    ),
    # The signature block is always rendered (not a toggleable content section).
    ReportType.assurance_plan: (
        SectionDef("risks", "Risk assessment", "Risicobeoordeling"),
        SectionDef("moments", "Assurance moments", "Borgingsmomenten"),
    ),
    ReportType.completion_declaration: (SectionDef("declaration", "Declaration", "Verklaring"),),
    ReportType.dossier: (
        SectionDef("risks", "Risk assessment", "Risicobeoordeling"),
        SectionDef("plan", "Assurance plan", "Borgingsplan"),
        SectionDef("findings", "Findings", "Bevindingen"),
        SectionDef("certificates", "Certificates", "Certificaten"),
        SectionDef("declaration", "Declaration", "Verklaring"),
    ),
}

# Report types that support branded/configurable templates (all of them).
REPORT_TEMPLATE_TYPES: tuple[ReportType, ...] = tuple(_SECTIONS.keys())


def is_report_template_type(template_type: str) -> bool:
    """True if `template_type` is a report kind (not 'findings')."""
    return template_type in {rt.value for rt in REPORT_TEMPLATE_TYPES}


def report_sections(report_type: ReportType) -> tuple[SectionDef, ...]:
    return _SECTIONS[report_type]


def report_merge_fields(report_type: ReportType) -> tuple[MergeField, ...]:
    # Common set today; kept per-type so a report type can add its own later.
    return _COMMON_MERGE_FIELDS


def valid_section_keys(report_type: ReportType) -> set[str]:
    return {s.key for s in _SECTIONS[report_type]}


def valid_merge_paths(report_type: ReportType) -> set[str]:
    return {m.path for m in report_merge_fields(report_type)}
