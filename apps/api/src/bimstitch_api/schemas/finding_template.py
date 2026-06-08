"""Pydantic schemas for finding templates (custom finding forms).

The custom-field definition (`FieldDef`) and built-in toggles (`BuiltinFieldConfig`)
are validated here and stored as JSONB on `FindingTemplate`. Field *answers* on a
finding are validated separately by `finding_custom_values.build_custom_values`.

`template_type` is the forward-compat discriminator — `TemplateType` is the
app-layer source of truth for valid values (the DB column is an unconstrained
String), so enabling a future kind is a one-line change here, no migration.
"""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

# Field-count ceiling enforced in Pydantic (UX guardrail). The router ALSO
# re-checks against settings.max_template_fields, which is env-authoritative.
MAX_TEMPLATE_FIELDS = 30
MAX_SELECT_OPTIONS = 50
# Client-generated stable id, e.g. "f_a1b2c3". Stable across edits so a finding's
# answer snapshot keeps mapping to the right field.
FIELD_ID_PATTERN = r"^f_[a-z0-9]{4,12}$"

# Built-in finding fields a template may toggle. Deliberately excludes
# status/assignee/deadline/resolution — those drive the lifecycle state machine
# and must never be hidden or made optional by a template.
TEMPLATABLE_BUILTINS = frozenset({"severity", "bbl_article_ref", "photos", "references"})


class TemplateType(StrEnum):
    """Forward-compat discriminator. v1 ships only `findings`; new kinds are
    added here (app-layer), never as a DB enum/CHECK."""

    findings = "findings"


class FindingFieldType(StrEnum):
    text = "text"
    textarea = "textarea"
    number = "number"
    date = "date"
    select = "select"
    checkbox = "checkbox"


class FieldDef(BaseModel):
    """One custom field in a template's form."""

    model_config = ConfigDict(extra="forbid")

    id: str = Field(pattern=FIELD_ID_PATTERN)
    type: FindingFieldType
    label: str = Field(min_length=1, max_length=120)
    required: bool = False
    help_text: str | None = Field(default=None, max_length=300)
    # select-only
    options: list[str] | None = None
    # number-only
    min: float | None = None
    max: float | None = None

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


class FindingTemplateBase(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    name: str = Field(min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=2000)
    builtin_fields: dict[str, BuiltinFieldConfig] = Field(default_factory=dict)
    fields: list[FieldDef] = Field(default_factory=list)

    @model_validator(mode="after")
    def _validate(self) -> FindingTemplateBase:
        _validate_builtins(self.builtin_fields)
        _validate_fields(self.fields)
        return self


class FindingTemplateCreate(FindingTemplateBase):
    template_type: TemplateType = TemplateType.findings
    is_default: bool = False


class FindingTemplateUpdate(BaseModel):
    """PATCH payload. All fields optional. `is_default` is intentionally absent —
    the default is moved only via the dedicated set-default endpoint (atomic)."""

    model_config = ConfigDict(from_attributes=True)

    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=2000)
    builtin_fields: dict[str, BuiltinFieldConfig] | None = None
    fields: list[FieldDef] | None = None

    @model_validator(mode="after")
    def _validate(self) -> FindingTemplateUpdate:
        if self.builtin_fields is not None:
            _validate_builtins(self.builtin_fields)
        if self.fields is not None:
            _validate_fields(self.fields)
        return self


class FindingTemplateRead(FindingTemplateBase):
    id: UUID
    template_type: str
    is_default: bool
    created_by_user_id: UUID
    created_at: datetime
    updated_at: datetime
