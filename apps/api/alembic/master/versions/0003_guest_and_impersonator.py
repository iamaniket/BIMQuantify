"""Cross-org guest flag + impersonation audit attribution.

Adds two orthogonal columns that together support cross-org collaboration
and super-admin impersonation:

* `organization_members.is_guest` — a guest membership has all the
  lifecycle of a regular one (pending → active, search_path resolves the
  host schema, JWT switch works) but is excluded from seat counts and the
  org admin can't promote it; the guest sees only projects with an
  explicit `project_members` row.

* `audit_log.impersonator_user_id` — when a super admin impersonates a
  user, every audit row written during that session records the real
  super admin here while `user_id` keeps the impersonated user. This
  preserves the per-user activity view AND adds a forensic
  "what did super admin X do" query path.

Revision ID: 0003_guest_and_impersonator
Revises: 0002_seat_limit
Create Date: 2026-05-20
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0003_guest_and_impersonator"
down_revision: str | None = "0002_seat_limit"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # ---- organization_members.is_guest -------------------------------------
    op.add_column(
        "organization_members",
        sa.Column(
            "is_guest",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        schema="public",
    )
    op.create_index(
        "ix_org_members_guests",
        "organization_members",
        ["organization_id", "is_guest"],
        schema="public",
        postgresql_where=sa.text("is_guest = true AND status = 'active'"),
    )

    # ---- audit_log.impersonator_user_id ------------------------------------
    op.add_column(
        "audit_log",
        sa.Column(
            "impersonator_user_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            nullable=True,
        ),
        schema="public",
    )
    op.create_foreign_key(
        "fk_audit_log_impersonator_user",
        "audit_log",
        "users",
        ["impersonator_user_id"],
        ["id"],
        source_schema="public",
        referent_schema="public",
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_audit_impersonator_time",
        "audit_log",
        ["impersonator_user_id", "created_at"],
        schema="public",
    )

    # The `bim_app` non-superuser role needs UPDATE/SELECT on the new
    # column to write audit entries while the impersonator dep is active.
    # `audit_log` already has table-wide INSERT/SELECT grants on bim_app
    # (see `_rls_sql.grant_master_role_statements`); a fresh column is
    # covered automatically by the table grant.


def downgrade() -> None:
    op.drop_index(
        "ix_audit_impersonator_time", table_name="audit_log", schema="public"
    )
    op.drop_constraint(
        "fk_audit_log_impersonator_user",
        "audit_log",
        type_="foreignkey",
        schema="public",
    )
    op.drop_column("audit_log", "impersonator_user_id", schema="public")

    op.drop_index(
        "ix_org_members_guests", table_name="organization_members", schema="public"
    )
    op.drop_column("organization_members", "is_guest", schema="public")
