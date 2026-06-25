"""Report-template section + merge-field registry (builder source of truth)."""

from bimdossier_api.org_templates.registry import (
    REPORT_TEMPLATE_TYPES,
    MergeField,
    SectionDef,
    is_report_template_type,
    report_merge_fields,
    report_sections,
    valid_merge_paths,
    valid_section_keys,
)

__all__ = [
    "REPORT_TEMPLATE_TYPES",
    "MergeField",
    "SectionDef",
    "is_report_template_type",
    "report_merge_fields",
    "report_sections",
    "valid_merge_paths",
    "valid_section_keys",
]
