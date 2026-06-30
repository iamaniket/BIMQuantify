"""Pooled free-tier project members — `public.free_project_members`.

The free wedge originally kept a free project single-owner; this table makes a
free project lightly collaborative. A free project's owner can invite up to a
small number of members (the cap is enforced in the router, not here) who then
reach the project through the "Free workspace" toggle.

Like every other free table this is POOLED in `public`, never a tenant
`org_<hex>` schema, and it does NOT reuse the paid `ProjectMember`
(tenant-schema) / `OrganizationMember` (seat-bearing) machinery — a free
membership never consumes an org seat.

Isolation is RLS, but unlike the other free tables (keyed purely on
`owner_user_id == app.current_user_id`) the membership row is visible to BOTH
the member and the project owner. The `free_is_member()` SECURITY DEFINER helper
(see `_rls_sql.enable_free_member_rls_statements`) keys the broadened
owner-OR-member policies on `free_projects` / `free_models` / `free_findings` off
this table.

Only INVITED members live here — the owner is never a row (it is derived from
`free_projects.owner_user_id`). That keeps the member cap a trivial `COUNT(*)`
and means there is exactly one owner by construction (ownership is not
transferable in the free tier).

`role` is `String` + `CHECK` (the "likely-to-grow → String+CHECK" convention),
value set derived from the paid `ProjectRole` so the two stay in lockstep. Only
the `editor`/`viewer` subset is used (owner is not a stored role).
"""

from datetime import datetime
from uuid import UUID

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    String,
    func,
)
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from bimdossier_api.db import MasterBase
from bimdossier_api.models._pooled import check_in
from bimdossier_api.models.project_member import ProjectRole

# Invited-member roles. The owner is NOT stored here (derived from
# free_projects.owner_user_id), so the stored set is the editor/viewer subset of
# the paid ProjectRole — derived from the enum so the CHECK and the paid roles
# stay in lockstep.
FREE_MEMBER_ROLES: tuple[str, ...] = (
    ProjectRole.editor.value,
    ProjectRole.viewer.value,
)


class FreeProjectMember(MasterBase):
    __tablename__ = "free_project_members"

    free_project_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.free_projects.id", ondelete="CASCADE"),
        primary_key=True,
    )
    user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.users.id", ondelete="CASCADE"),
        primary_key=True,
    )
    role: Mapped[str] = mapped_column(
        String(16), nullable=False, default="viewer", server_default="viewer"
    )
    # Who issued the invite (the project owner). NULL for the backfilled owner
    # rows of pre-existing projects.
    created_by_user_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.users.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (
        CheckConstraint(
            check_in("role", FREE_MEMBER_ROLES), name="ck_free_project_members_role"
        ),
        # Drives the "shared with me" list — find every project a user belongs to.
        Index("ix_free_project_members_user", "user_id"),
        {"schema": "public"},
    )
