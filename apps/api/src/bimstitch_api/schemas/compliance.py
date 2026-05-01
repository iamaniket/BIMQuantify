from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class ComplianceCheckRequest(BaseModel):
    building_type: str = "all"
    categories: list[str] | None = None
    framework: str = "bbl"


class CheckResultItem(BaseModel):
    rule_id: str
    article: str
    element_global_id: str
    element_type: str | None = None
    element_name: str | None = None
    status: Literal["pass", "fail", "warn", "skip", "error"]
    message: str
    actual_value: str | float | int | bool | None = None
    expected_value: str | float | int | bool | None = None
    property_set: str | None = None
    property_name: str | None = None
    severity: str


class RuleSummaryItem(BaseModel):
    rule_id: str
    article: str
    title: str
    title_nl: str
    category: str
    severity: str
    total_checked: int
    passed: int
    failed: int
    warned: int
    skipped: int
    errors: int


class CategorySummaryItem(BaseModel):
    category: str
    total_rules: int
    total_checks: int
    passed: int
    failed: int
    warned: int


class ComplianceCheckResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    file_id: str
    job_id: UUID
    framework: str = "bbl"
    checked_at: str
    total_rules: int
    total_elements_checked: int
    rules_summary: list[RuleSummaryItem]
    category_summary: list[CategorySummaryItem]
    details: list[CheckResultItem]


class ComplianceSummaryResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    file_id: str
    job_id: UUID
    framework: str = "bbl"
    checked_at: str
    total_rules: int
    total_elements_checked: int
    rules_summary: list[RuleSummaryItem]
    category_summary: list[CategorySummaryItem]
