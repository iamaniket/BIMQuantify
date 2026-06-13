"""Pydantic schemas for org templates (unified finding forms + report layouts).

One table (`OrgTemplate`) hosts several template *kinds*, discriminated by
`template_type`. The `config` JSONB is validated per kind by
`validate_template_config()`:

- ``findings`` → `FindingTemplateConfig` = {builtin_fields, fields}. `FieldDef`
  (custom field defs) + `BuiltinFieldConfig` (built-in toggles) are unchanged
  from the former `schemas/finding_template.py`; field *answers* on a finding are
  still validated by `finding_custom_values.build_custom_values`.
- report kinds → `ReportTemplateConfig` = {branding, sections, options}. Section
  keys are validated against the per-report-type registry
  (`org_templates.registry`).

`template_type` is the forward-compat discriminator — `TemplateType` is the
app-layer source of truth (the DB column is an unconstrained String), so a new
kind is a one-line change here, no migration.
"""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Annotated, Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

from bimstitch_api.models.report import ReportType
from bimstitch_api.org_templates.registry import valid_section_keys

# --- findings-kind constants (carried over from finding_template.py) ----------

MAX_TEMPLATE_FIELDS = 30
MAX_SELECT_OPTIONS = 50
# Client-generated stable id, e.g. "f_a1b2c3". Stable across edits so a finding's
# answer snapshot keeps mapping to the right field.
FIELD_ID_PATTERN = r"^f_[a-z0-9]{4,12}$"
# Built-in finding fields a template may toggle. Deliberately excludes
# status/assignee/deadline/resolution — those drive the lifecycle state machine.
TEMPLATABLE_BUILTINS = frozenset({"severity", "bbl_article_ref", "photos", "references"})

# --- report-kind constants ----------------------------------------------------

HEX_COLOR_PATTERN = r"^#[0-9a-fA-F]{6}$"
ASSET_KEY_PREFIX = "report-templates/"
# Client-generated stable id for a free text block, e.g. "t_a1b2c3".
TEXT_BLOCK_ID_PATTERN = r"^t_[a-z0-9]{4,12}$"
MAX_TEXT_BLOCK_CHARS = 5000


class TemplateType(StrEnum):
    """Template-kind discriminator. The report values MUST equal `ReportType`
    values (a report template's `template_type` is its report type)."""

    findings = "findings"
    compliance_report = "compliance_report"
    assurance_plan = "assurance_plan"
    completion_declaration = "completion_declaration"
    dossier = "dossier"


def _is_report_kind(template_type: TemplateType) -> bool:
    return template_type is not TemplateType.findings


# --- findings config ----------------------------------------------------------


class FindingFieldType(StrEnum):
    text = "text"
    textarea = "textarea"
    number = "number"
    date = "date"
    select = "select"
    checkbox = "checkbox"


class FieldDef(BaseModel):
    """One custom field in a findings template's form."""

    model_config = ConfigDict(extra="forbid")

    id: str = Field(pattern=FIELD_ID_PATTERN)
    type: FindingFieldType
    label: str = Field(min_length=1, max_length=120)
    required: bool = False
    help_text: str | None = Field(default=None, max_length=300)
    options: list[str] | None = None  # select-only
    min: float | None = None  # number-only
    max: float | None = None  # number-only

    @model_validator(mode="after")
    def _per_type_rules(self) -> FieldDef:
        if self.type is FindingFieldType.select:
            opts = self.options or []
            if not (1 <= len(opts) <= MAX_SELECT_OPTIONS):
                raise ValueError("SELECT_FIELD_NEEDS_OPTIONS")
            trimmed = [o.strip() for o in opts]
            if any(not o for o in trimmed):
                raise ValueError("SELECT_OPTION_EMPTY")
            if len(set(trimmed)) != len(trimmed):
                raise ValueError("SELECT_OPTIONS_NOT_UNIQUE")
        elif self.options is not None:
            raise ValueError("OPTIONS_ONLY_FOR_SELECT")

        if self.type is not FindingFieldType.number and (
            self.min is not None or self.max is not None
        ):
            raise ValueError("MINMAX_ONLY_FOR_NUMBER")
        if self.min is not None and self.max is not None and self.max < self.min:
            raise ValueError("MIN_GREATER_THAN_MAX")
        return self


class BuiltinFieldConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    visible: bool = True
    required: bool = False


def _validate_builtins(builtin: dict[str, BuiltinFieldConfig]) -> None:
    unknown = set(builtin) - TEMPLATABLE_BUILTINS
    if unknown:
        raise ValueError(f"UNKNOWN_BUILTIN_FIELD:{','.join(sorted(unknown))}")


def _validate_fields(fields: list[FieldDef]) -> None:
    if len(fields) > MAX_TEMPLATE_FIELDS:
        raise ValueError("TOO_MANY_FIELDS")
    ids = [f.id for f in fields]
    if len(set(ids)) != len(ids):
        raise ValueError("DUPLICATE_FIELD_ID")
    labels = [f.label.strip().lower() for f in fields]
    if len(set(labels)) != len(labels):
        raise ValueError("DUPLICATE_FIELD_LABEL")


class FindingTemplateConfig(BaseModel):
    """`config` shape for template_type=findings."""

    model_config = ConfigDict(extra="forbid")

    builtin_fields: dict[str, BuiltinFieldConfig] = Field(default_factory=dict)
    fields: list[FieldDef] = Field(default_factory=list)

    @model_validator(mode="after")
    def _validate(self) -> FindingTemplateConfig:
        _validate_builtins(self.builtin_fields)
        _validate_fields(self.fields)
        return self


# --- report config ------------------------------------------------------------


class BrandingConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    logo_storage_key: str | None = None
    accent_color: str | None = Field(default=None, pattern=HEX_COLOR_PATTERN)
    accent_color_secondary: str | None = Field(default=None, pattern=HEX_COLOR_PATTERN)
    header_text: str | None = Field(default=None, max_length=200)
    footer_text: str | None = Field(default=None, max_length=200)
    cover_pdf_storage_key: str | None = None

    @model_validator(mode="after")
    def _validate_keys(self) -> BrandingConfig:
        for key in (self.logo_storage_key, self.cover_pdf_storage_key):
            if key is not None and not key.startswith(ASSET_KEY_PREFIX):
                raise ValueError("INVALID_ASSET_KEY")
        return self


class ContentSection(BaseModel):
    """A built-in renderer section the template toggles / reorders / re-titles."""

    model_config = ConfigDict(extra="forbid")

    type: Literal["content"] = "content"
    key: str = Field(min_length=1, max_length=64)
    enabled: bool = True
    title_override: str | None = Field(default=None, max_length=120)


class TextSection(BaseModel):
    """A free text block / legal disclaimer placed anywhere in the section order.
    `body` may contain `{{merge.field}}` placeholders (interpolated by the worker)."""

    model_config = ConfigDict(extra="forbid")

    type: Literal["text"] = "text"
    id: str = Field(pattern=TEXT_BLOCK_ID_PATTERN)
    title: str | None = Field(default=None, max_length=120)
    body: str = Field(min_length=1, max_length=MAX_TEXT_BLOCK_CHARS)
    enabled: bool = True


Section = Annotated[ContentSection | TextSection, Field(discriminator="type")]


class ReportOptions(BaseModel):
    model_config = ConfigDict(extra="forbid")

    signature_label: str | None = Field(default=None, max_length=120)
    show_toc: bool = True


class ReportTemplateConfig(BaseModel):
    """`config` shape for report template_types. The section-key membership check
    (keys must belong to the report type) runs in `validate_template_config`,
    which knows the concrete report type."""

    model_config = ConfigDict(extra="forbid")

    branding: BrandingConfig = Field(default_factory=BrandingConfig)
    sections: list[Section] = Field(default_factory=list)
    options: ReportOptions = Field(default_factory=ReportOptions)

    @model_validator(mode="after")
    def _validate(self) -> ReportTemplateConfig:
        content_keys = [s.key for s in self.sections if isinstance(s, ContentSection)]
        if len(set(content_keys)) != len(content_keys):
            raise ValueError("DUPLICATE_SECTION_KEY")
        text_ids = [s.id for s in self.sections if isinstance(s, TextSection)]
        if len(set(text_ids)) != len(text_ids):
            raise ValueError("DUPLICATE_TEXT_BLOCK_ID")
        return self


def validate_template_config(template_type: TemplateType, config: dict[str, Any]) -> dict[str, Any]:
    """Validate a raw `config` dict against its kind and return the lean dumped
    dict to store on `OrgTemplate.config`. Raises ValueError (→ 422 in the router)."""
    if template_type is TemplateType.findings:
        model = FindingTemplateConfig.model_validate(config)
        return model.model_dump(mode="json", exclude_none=True)

    report_type = ReportType(template_type.value)
    report_cfg = ReportTemplateConfig.model_validate(config)
    valid = valid_section_keys(report_type)
    for section in report_cfg.sections:
        if isinstance(section, ContentSection) and section.key not in valid:
            raise ValueError(f"UNKNOWN_SECTION_KEY:{section.key}")
    return report_cfg.model_dump(mode="json", exclude_none=True)


# --- unified request/response models -----------------------------------------


class OrgTemplateCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    template_type: TemplateType = TemplateType.findings
    name: str = Field(min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=2000)
    is_default: bool = False
    config: dict[str, Any] = Field(default_factory=dict)


class OrgTemplateUpdate(BaseModel):
    """PATCH payload. All optional. `is_default` is absent — the default moves
    only via the dedicated set-default endpoint (atomic). `template_type` is
    immutable (a template can't change kind)."""

    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=2000)
    config: dict[str, Any] | None = None


class OrgTemplateRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    template_type: str
    name: str
    description: str | None
    is_default: bool
    config: dict[str, Any]
    created_by_user_id: UUID
    created_at: datetime
    updated_at: datetime


# --- schema endpoint ----------------------------------------------------------


class SchemaSection(BaseModel):
    key: str
    label: str


class SchemaMergeField(BaseModel):
    path: str
    label: str


class OrgTemplateSchemaResponse(BaseModel):
    template_type: TemplateType
    sections: list[SchemaSection]
    merge_fields: list[SchemaMergeField]


# --- asset upload -------------------------------------------------------------


class TemplateAssetKind(StrEnum):
    logo = "logo"
    cover_pdf = "cover_pdf"


class TemplateAssetInitiateRequest(BaseModel):
    asset_kind: TemplateAssetKind
    filename: str = Field(min_length=1, max_length=255)
    content_type: str = Field(min_length=1, max_length=128)
    size_bytes: int = Field(ge=1)


class TemplateAssetInitiateResponse(BaseModel):
    storage_key: str
    upload_url: str


class TemplateAssetCompleteRequest(BaseModel):
    storage_key: str = Field(min_length=1)


class TemplateAssetCompleteResponse(BaseModel):
    storage_key: str
    url: str  # presigned inline GET for preview
