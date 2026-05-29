"""Pydantic schemas for super-admin and org-admin endpoints."""

from __future__ import annotations

from datetime import datetime
from ipaddress import IPv4Address, IPv6Address
from uuid import UUID

from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator

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
# /admin/impersonate
# ---------------------------------------------------------------------------


class ImpersonateRequest(BaseModel):
    """Body for `POST /admin/impersonate/{user_id}`.

    Both fields optional. `organization_id` lets the super admin specify
    which org context to enter (must be one the target user is an active
    member of); omitting it falls back to the target's
    `active_organization_id`. `ttl_seconds` clamps the token lifetime DOWN
    only — values above the configured ceiling are silently capped.
    """

    organization_id: UUID | None = None
    ttl_seconds: int | None = Field(default=None, ge=60)


class ImpersonatedUserSummary(BaseModel):
    id: UUID
    email: EmailStr
    full_name: str | None
    active_organization_id: UUID | None


class ImpersonateResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    expires_at: datetime
    impersonated_user: ImpersonatedUserSummary


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
    # Cross-org collaborator. When true, the invitee gets a guest membership:
    # excluded from seat counts, cannot be org_admin, sees only specifically
    # granted projects. `projects` must be non-empty for guest invites — a
    # guest with no project assignments is meaningless.
    is_guest: bool = False
    projects: list[ProjectAssignment] = Field(default_factory=list)

    @model_validator(mode="after")
    def _validate_guest_invariants(self) -> MemberInvite:
        if self.is_guest:
            if self.is_org_admin:
                raise ValueError("GUEST_CANNOT_BE_ORG_ADMIN")
            if not self.projects:
                raise ValueError("GUEST_REQUIRES_PROJECTS")
        return self


class MemberUpdate(BaseModel):
    is_org_admin: bool | None = None
    status: str | None = None  # OrganizationMemberStatus value


class MemberGuestUpdate(BaseModel):
    """Body for `PATCH /organizations/{org}/members/{user}/guest`.

    Toggling guest <-> regular member is a deliberate transition with its
    own audit signal (`organization_member.guest_changed`), separate from
    role and status changes which travel through `PATCH /members/{user}`.
    """

    is_guest: bool


class MemberDelete(BaseModel):
    """Body for `DELETE /organizations/{org}/members/{user}`.

    `reassign_to` is required when the target user owns one or more
    projects in the org. The API returns `OWNS_ACTIVE_PROJECTS` with the
    list of project ids when the field is missing; the portal then shows
    a reassign-picker.
    """

    reassign_to: UUID | None = None


class MemberRead(BaseModel):
    user_id: UUID
    email: EmailStr
    full_name: str | None
    is_org_admin: bool
    is_guest: bool = False
    status: str
    invited_at: datetime
    accepted_at: datetime | None
    # Computed expiry for pending rows; null otherwise.
    expires_at: datetime | None = None
    # Action capabilities — same logic the server uses, exposed so the
    # portal can disable destructive buttons before the user clicks.
    is_last_admin: bool = False
    can_remove: bool = True
    can_demote: bool = True
    can_suspend: bool = True


# ---------------------------------------------------------------------------
# Audit log
# ---------------------------------------------------------------------------


class AuditEntry(BaseModel):
    id: UUID
    user_id: UUID | None
    impersonator_user_id: UUID | None = None
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
