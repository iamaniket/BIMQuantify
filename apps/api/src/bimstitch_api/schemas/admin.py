"""Pydantic schemas for super-admin and org-admin endpoints."""

from __future__ import annotations

from datetime import datetime
from ipaddress import IPv4Address, IPv6Address
from uuid import UUID

from pydantic import BaseModel, EmailStr, Field, field_validator


# ---------------------------------------------------------------------------
# /admin/organizations
# ---------------------------------------------------------------------------


class OrganizationCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    admin_email: EmailStr
    admin_full_name: str | None = Field(default=None, max_length=255)
    # null/omitted = unlimited seats
    seat_limit: int | None = Field(default=None, ge=1, le=100_000)


class OrganizationUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    status: str | None = None  # 'active' | 'suspended' (saga-only otherwise)
    # explicit `null` clears the cap; an omitted field leaves it untouched
    # (handled in the router via `model_fields_set`).
    seat_limit: int | None = Field(default=None, ge=1, le=100_000)


class OrganizationRead(BaseModel):
    id: UUID
    name: str
    schema_name: str
    status: str
    seat_limit: int | None
    seat_count_used: int
    created_at: datetime
    provisioned_at: datetime | None
    deleted_at: datetime | None

    model_config = {"from_attributes": True}


class OrganizationCreateResponse(BaseModel):
    organization: OrganizationRead
    admin_user_id: UUID
    admin_email: EmailStr
    activation_required: bool


# ---------------------------------------------------------------------------
# /admin/users
# ---------------------------------------------------------------------------


class AdminUserRead(BaseModel):
    id: UUID
    email: EmailStr
    full_name: str | None
    is_active: bool
    is_verified: bool
    is_superuser: bool
    active_organization_id: UUID | None

    model_config = {"from_attributes": True}


# ---------------------------------------------------------------------------
# /organizations/{id}/members
# ---------------------------------------------------------------------------


class ProjectAssignment(BaseModel):
    project_id: UUID
    role: str  # ProjectRole value


class MemberInvite(BaseModel):
    email: EmailStr
    full_name: str | None = Field(default=None, max_length=255)
    is_org_admin: bool = False
    projects: list[ProjectAssignment] = Field(default_factory=list)


class MemberUpdate(BaseModel):
    is_org_admin: bool | None = None
    status: str | None = None  # OrganizationMemberStatus value


class MemberRead(BaseModel):
    user_id: UUID
    email: EmailStr
    full_name: str | None
    is_org_admin: bool
    status: str
    invited_at: datetime
    accepted_at: datetime | None


# ---------------------------------------------------------------------------
# Audit log
# ---------------------------------------------------------------------------


class AuditEntry(BaseModel):
    id: UUID
    user_id: UUID | None
    organization_id: UUID | None
    action: str
    resource_type: str
    resource_id: str | None
    before: dict | None
    after: dict | None
    request_id: str | None
    ip_address: str | None
    user_agent: str | None
    created_at: datetime

    model_config = {"from_attributes": True}

    @field_validator("ip_address", mode="before")
    @classmethod
    def _coerce_ip(cls, value: object) -> object:
        """The `audit_log.ip_address` column is Postgres `inet`, which
        SQLAlchemy returns as IPv4Address/IPv6Address. Coerce to a plain
        string for JSON serialization."""
        if isinstance(value, (IPv4Address, IPv6Address)):
            return str(value)
        return value
