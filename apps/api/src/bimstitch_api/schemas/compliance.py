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
    property_path: str | None = None
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


class ProjectComplianceReportItem(BaseModel):
    """One row in the project-level compliance reports list — latest succeeded
    job per (file_id, framework)."""

    model_config = ConfigDict(from_attributes=True)

    job_id: UUID
    file_id: UUID
    model_id: UUID
    model_name: str
    model_discipline: str
    file_name: str
    file_version: int
    framework: Literal["bbl", "wkb"]
    checked_at: str
    finished_at: datetime
    pass_count: int
    warn_count: int
    fail_count: int
    total_rules: int
    total_elements_checked: int
    overall_score: int  # 0..100, computed pass / (pass+warn+fail) * 100


class ProjectComplianceReportList(BaseModel):
    items: list[ProjectComplianceReportItem]
