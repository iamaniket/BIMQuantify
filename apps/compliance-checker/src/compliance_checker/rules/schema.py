from __future__ import annotations

from enum import StrEnum

from pydantic import BaseModel, model_validator

from compliance_checker.rules.canonical import SourceFormat


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
    property: str
    operator: Operator
    threshold: str | float | int | bool | list[str] | None = None
    unit: str | None = None
    description: str = ""


class ApplicabilityFilter(BaseModel):
    """Restricts a rule to a subset of elements (e.g. external walls only).

    Elements not matching every filter are skipped silently — they are
    out-of-scope, not failures.
    """

    property: str
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
    titles: dict[str, str] = {}
    descriptions: dict[str, str] = {}
    title: str | None = None
    title_nl: str | None = None
    description: str | None = None
    description_nl: str | None = None
    legal_text_nl: str | None = None
    legal_text_en: str | None = None
    requirement_summary: str | None = None
    category: str
    chapter: str
    severity: Severity
    applicable_building_types: list[str]
    applicable_element_types: list[str]
    min_source_format: SourceFormat = SourceFormat.ifc
    applicability_filters: list[ApplicabilityFilter] = []
    checks: list[PropertyCheck]
    implementation_status: ImplementationStatus
    notes: str | None = None

    @model_validator(mode="after")
    def _migrate_flat_titles(self) -> RuleDefinition:
        """Promote legacy title/title_nl into the titles map."""
        if not self.titles:
            self.titles = {}
            if self.title is not None:
                self.titles["en"] = self.title
            if self.title_nl is not None:
                self.titles["nl"] = self.title_nl
        if not self.descriptions:
            self.descriptions = {}
            if self.description is not None:
                self.descriptions["en"] = self.description
            if self.description_nl is not None:
                self.descriptions["nl"] = self.description_nl
        self.title = self.titles.get("en")
        self.title_nl = self.titles.get("nl")
        self.description = self.descriptions.get("en")
        self.description_nl = self.descriptions.get("nl")
        return self


class RuleFile(BaseModel):
    framework: RegulationFramework = RegulationFramework.bbl
    rules: list[RuleDefinition]

    @model_validator(mode="after")
    def _inherit_framework(self) -> RuleFile:
        for rule in self.rules:
            if "framework" not in (rule.model_fields_set or set()):
                rule.framework = self.framework
        return self
