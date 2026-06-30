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
    # null/omitted = unlimited active storage
    active_storage_limit_gb: int | None = Field(default=None, ge=1)


class OrganizationUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    status: str | None = None  # 'active' | 'suspended' (saga-only otherwise)
    # explicit `null` clears the cap; an omitted field leaves it untouched
    # (handled in the router via `model_fields_set`).
    seat_limit: int | None = Field(default=None, ge=1, le=100_000)
    active_storage_limit_gb: int | None = Field(default=None, ge=1)


class OrgNameUpdate(BaseModel):
    """Org-admin-level update: only the organization name."""
    name: str = Field(min_length=1, max_length=255)


class OrgNameUpdateResponse(BaseModel):
    id: UUID
    name: str


class OrganizationRead(BaseModel):
    id: UUID
    name: str
    schema_name: str
    status: str
    seat_limit: int | None
    seat_count_used: int
    active_storage_limit_gb: int | None
    active_storage_used_gb: float
    image_url: str | None = None
    created_at: datetime
    provisioned_at: datetime | None
    deleted_at: datetime | None
    # Hard-purge timestamp (storage wiped + schema dropped). Null while retained.
    purged_at: datetime | None = None
    # When a soft-deleted org becomes eligible for hard purge (deleted_at +
    # ORG_RETENTION_DAYS). Null for live (non-deleted) and already-purged orgs.
    purge_eligible_at: datetime | None = None
    # True when soft-deleted, not yet purged, and past the retention window.
    is_purge_eligible: bool = False

    model_config = {"from_attributes": True}


class OrganizationPurgeRequest(BaseModel):
    # Skip the retention window (GDPR erasure-on-request). Default False = only
    # purge once the org is past ORG_RETENTION_DAYS.
    skip_retention: bool = False


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
    # Optional, user-supplied at free-tier signup. Surfaced so an operator can
    # spot founding-partner candidates among self-serve free signups.
    company: str | None = None
    is_active: bool
    is_verified: bool
    is_superuser: bool
    active_organization_id: UUID | None
    # Account-creation timestamp (real `users.created_at` column, migration
    # 0010). Lets the admin views show account age.
    created_at: datetime
    # H6: account is currently login-locked (computed from Redis at list time,
    # not a DB column). Defaults False so single-object reads need not set it.
    locked: bool = False

    model_config = {"from_attributes": True}


# ---------------------------------------------------------------------------
# /admin/users/free — free-tier accounts + usage stats
# ---------------------------------------------------------------------------


class FreeUserUsage(BaseModel):
    """A free user's data footprint, all computed at read time (no DB column).

    Counts/storage are OWNER-keyed (the free quota model): a free user's
    containers and snags count against them as the project owner; members never
    own content. `member_of_count` is the inverse — projects shared TO this user.
    Caps come from settings so the UI never hardcodes the quota thresholds.
    Mirrors the authoritative quota in `routers/free_documents.py`: storage sums
    active (`deleted_at IS NULL`) file bytes; `document_count` counts active
    containers against `free_max_documents_per_user`.
    """

    storage_bytes_used: int
    storage_bytes_cap: int
    project_count: int
    project_cap: int
    document_count: int
    document_cap: int
    # Per-project invited-member cap (effective: override ?? FREE_MAX_MEMBERS_PER_PROJECT).
    member_cap: int
    snag_count: int
    member_of_count: int
    # `last_activity_at` is a true "last did anything" signal: the MAX across all
    # owner content of project/container/file/snag `updated_at` and container
    # `last_viewed_at`. `first_activity_at` is the earliest owned-project
    # creation. Both nullable (None = the account has never created/viewed
    # anything — staleness then keys off the account's `created_at`).
    last_activity_at: datetime | None = None
    first_activity_at: datetime | None = None


class FreeAccountLimits(BaseModel):
    """The caller's OWN free-tier caps + trial countdown — drives the portal trial
    banner. Returned by `GET /free/account/limits`. No override/default internals
    (those are admin-only); just the effective caps and the days-left signal."""

    max_projects: int
    max_members_per_project: int
    max_documents: int
    storage_max_bytes: int
    account_max_age_days: int
    account_expires_at: datetime | None
    days_remaining: int | None
    expired: bool
    expiry_exempt: bool


class FreeUserLimitsRead(BaseModel):
    """A free user's effective limits + trial state, plus the raw per-user
    overrides and the env defaults — everything the super-admin edit form needs to
    render and pre-fill. The `override_*` fields are None when the account is on
    the global default; the `default_*` fields let the form show "default: N"."""

    # Effective (override ?? default).
    max_projects: int
    max_members_per_project: int
    max_documents: int
    storage_max_bytes: int
    account_max_age_days: int
    expiry_exempt: bool
    # Trial state (anchored on users.created_at).
    account_expires_at: datetime | None
    days_remaining: int | None
    expired: bool
    # Raw per-user overrides (None = falling back to the default).
    override_max_projects: int | None
    override_max_members_per_project: int | None
    override_max_documents: int | None
    override_storage_max_bytes: int | None
    override_account_max_age_days: int | None
    # Global env defaults.
    default_max_projects: int
    default_max_members_per_project: int
    default_max_documents: int
    default_storage_max_bytes: int
    default_account_max_age_days: int


class FreeUserLimitsUpdate(BaseModel):
    """Body for `PATCH /admin/users/free/{id}/limits` — full-replace of a user's
    overrides. Each numeric field is a positive int to override the global
    default, or `null` to clear the override (fall back to the default).
    `expiry_exempt` makes the account permanently free (never expires)."""

    max_projects: int | None = Field(default=None, ge=1, le=100_000)
    max_members_per_project: int | None = Field(default=None, ge=1, le=100_000)
    max_documents: int | None = Field(default=None, ge=1, le=100_000)
    # Storage floor of 1 MiB keeps an override from making every upload fail.
    storage_max_bytes: int | None = Field(default=None, ge=1024 * 1024)
    account_max_age_days: int | None = Field(default=None, ge=1, le=36_500)
    expiry_exempt: bool = False


class AdminFreeUserRead(AdminUserRead):
    """`AdminUserRead` plus free-tier usage and effective limits/trial. Returned by
    `GET /admin/users/free`."""

    usage: FreeUserUsage
    limits: FreeUserLimitsRead


class FreeUserProjectRow(BaseModel):
    id: UUID
    name: str
    created_at: datetime
    document_count: int
    snag_count: int
    storage_bytes: int


class FreeUserDocumentRow(BaseModel):
    """One free container (free_documents) with its version/byte rollup."""

    id: UUID
    name: str
    status: str
    discipline: str
    file_count: int
    size_bytes: int
    last_viewed_at: datetime | None = None
    free_project_id: UUID | None = None


class FreeUserSnagRow(BaseModel):
    id: UUID
    title: str
    severity: str
    status: str
    created_at: datetime

    model_config = {"from_attributes": True}


class FreeUserSharedRow(BaseModel):
    """A project shared TO the user (they are a member, not the owner)."""

    free_project_id: UUID
    name: str
    owner_email: EmailStr
    role: str


class FreeUserDetail(BaseModel):
    """Drill-down for one free user: the row plus their actual content."""

    user: AdminFreeUserRead
    projects: list[FreeUserProjectRow]
    documents: list[FreeUserDocumentRow]
    snags: list[FreeUserSnagRow]
    shared_projects: list[FreeUserSharedRow]


# ---------------------------------------------------------------------------
# /admin/impersonate
# ---------------------------------------------------------------------------


class ImpersonateRequest(BaseModel):
    """Body for `POST /admin/impersonate/{user_id}`.

    `reason` is REQUIRED — an impersonation token authenticates fully as the
    target user, so every session must record *why* the super admin entered
    it. The reason is persisted into the `auth.impersonate.start` audit row
    so the customer (and we) can always see the justification.

    `organization_id` lets the super admin specify which org context to enter
    (must be one the target user is an active member of); omitting it falls
    back to the target's `active_organization_id`. `ttl_seconds` clamps the
    token lifetime DOWN only — values above the configured ceiling are
    silently capped.
    """

    reason: str = Field(min_length=3, max_length=500)
    organization_id: UUID | None = None
    ttl_seconds: int | None = Field(default=None, ge=60)

    @field_validator("reason")
    @classmethod
    def _reason_not_blank(cls, value: str) -> str:
        # `min_length` only bounds the raw string; strip so a whitespace-only
        # reason ("   ") can't satisfy the requirement, and store it trimmed.
        stripped = value.strip()
        if len(stripped) < 3:
            raise ValueError("reason must be at least 3 non-whitespace characters")
        return stripped


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


class ImpersonateStopResponse(BaseModel):
    """Result of `POST /admin/impersonate/stop`.

    Echoes who was impersonated and by whom so the caller (portal) can
    confirm the right session ended before restoring the super admin's own
    token.
    """

    stopped: bool = True
    impersonated_user_id: UUID
    impersonator_user_id: UUID


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
    # H6: account is currently login-locked (computed from Redis at list time).
    locked: bool = False


class SelectableMemberRead(BaseModel):
    """Minimal member projection for "add to project" pickers.

    Unlike `MemberRead` (org-admin only, carries status + capability flags),
    this is the member-callable shape returned by
    `GET /organizations/{org}/selectable-members`: just enough to render a
    user in a selection dropdown. `is_org_admin` lets the portal hide admins,
    who are auto-added as project editors on creation.
    """

    user_id: UUID
    email: EmailStr
    full_name: str | None
    is_org_admin: bool


# ---------------------------------------------------------------------------
# /admin/access-requests
# ---------------------------------------------------------------------------


class AccessRequestAdminRead(BaseModel):
    id: UUID
    name: str
    work_email: str
    company: str
    role: str
    company_size: str
    country: str
    notes: str | None
    status: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class AccessRequestApproveInput(BaseModel):
    org_name: str | None = Field(default=None, min_length=1, max_length=255)
    seat_limit: int | None = Field(default=None, ge=1, le=100_000)
    active_storage_limit_gb: int | None = Field(default=None, ge=1)


class AccessRequestApproveResponse(BaseModel):
    access_request: AccessRequestAdminRead
    organization: OrganizationRead
    admin_email: EmailStr
    activation_required: bool


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
