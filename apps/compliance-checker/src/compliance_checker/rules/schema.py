from __future__ import annotations

from enum import StrEnum

from pydantic import BaseModel, model_validator


class RegulationFramework(StrEnum):
    bbl = "bbl"
    wkb = "wkb"


class BblCategory(StrEnum):
    fire_safety = "fire_safety"
    structural = "structural"
    usability = "usability"
    health = "health"
    accessibility = "accessibility"
    sustainability = "sustainability"


class WkbCategory(StrEnum):
    completeness = "completeness"
    documentation = "documentation"
    quality_plan = "quality_plan"
    traceability = "traceability"
    risk_assessment = "risk_assessment"


class Operator(StrEnum):
    gte = "gte"
    gt = "gt"
    lte = "lte"
    lt = "lt"
    eq = "eq"
    neq = "neq"
    contains = "contains"
    matches = "matches"
    exists = "exists"
    in_list = "in_list"


class Severity(StrEnum):
    error = "error"
    warning = "warning"
    info = "info"


class ImplementationStatus(StrEnum):
    implemented = "implemented"
    partial = "partial"
    planned = "planned"
    not_automatable = "not_automatable"
    repealed = "repealed"


class PropertyCheck(BaseModel):
    property_set: str
    property_name: str
    operator: Operator
    threshold: str | float | int | bool | list[str] | None = None
    unit: str | None = None
    description: str = ""


class ApplicabilityFilter(BaseModel):
    """Restricts a rule to a subset of elements (e.g. external walls only).

    Elements not matching every filter are skipped silently — they are
    out-of-scope, not failures.
    """

    property_set: str
    property_name: str
    operator: Operator
    value: str | float | int | bool | list[str] | None = None


class RuleDefinition(BaseModel):
    id: str
    framework: RegulationFramework = RegulationFramework.bbl
    article: str
    article_number: str
    source_url: str | None = None
    source_text_hash: str | None = None
    last_synced: str | None = None
    title: str
    title_nl: str
    description: str
    description_nl: str
    legal_text_nl: str | None = None
    legal_text_en: str | None = None
    requirement_summary: str | None = None
    category: str
    chapter: str
    severity: Severity
    applicable_building_types: list[str]
    applicable_ifc_entities: list[str]
    applicability_filters: list[ApplicabilityFilter] = []
    checks: list[PropertyCheck]
    implementation_status: ImplementationStatus
    notes: str | None = None


class RuleFile(BaseModel):
    framework: RegulationFramework = RegulationFramework.bbl
    rules: list[RuleDefinition]

    @model_validator(mode="after")
    def _inherit_framework(self) -> RuleFile:
        for rule in self.rules:
            if "framework" not in (rule.model_fields_set or set()):
                rule.framework = self.framework
        return self
