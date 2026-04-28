"""projects, project_members, RLS + FORCE on users/projects/project_members

Revision ID: 0002_projects_and_rls
Revises: 0001_initial
Create Date: 2026-04-28

NOTE: any future data migration that touches `users`, `projects`, or
`project_members` must temporarily disable FORCE before DML and re-enable it
after, e.g.:

    op.execute("ALTER TABLE projects NO FORCE ROW LEVEL SECURITY")
    # ... DML ...
    op.execute("ALTER TABLE projects FORCE ROW LEVEL SECURITY")
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from fastapi_users_db_sqlalchemy.generics import GUID
from sqlalchemy.dialects import postgresql

from bimstitch_api._rls_sql import (
    create_app_role_statements,
    disable_rls_statements,
    enable_rls_statements,
)

revision: str = "0002_projects_and_rls"
down_revision: str | None = "0001_initial"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


PROJECT_ROLE_VALUES = ("owner", "editor", "viewer")


def upgrade() -> None:
    project_role = postgresql.ENUM(*PROJECT_ROLE_VALUES, name="projectrole")
    project_role.create(op.get_bind(), checkfirst=False)

    op.create_table(
        "projects",
        sa.Column("id", GUID(), primary_key=True),
        sa.Column(
            "organization_id",
            GUID(),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("thumbnail_url", sa.String(length=2048), nullable=True),
        sa.Column(
            "owner_id",
            GUID(),
            sa.ForeignKey("users.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.UniqueConstraint("organization_id", "name", name="uq_projects_org_name"),
    )
    op.create_index("ix_projects_organization_id", "projects", ["organization_id"])

    op.create_table(
        "project_members",
        sa.Column(
            "project_id",
            GUID(),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "user_id",
            GUID(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "role",
            postgresql.ENUM(*PROJECT_ROLE_VALUES, name="projectrole", create_type=False),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index("ix_project_members_user_id", "project_members", ["user_id"])
    op.create_index(
        "uq_one_owner_per_project",
        "project_members",
        ["project_id"],
        unique=True,
        postgresql_where=sa.text("role = 'owner'"),
    )

    for stmt in create_app_role_statements():
        op.execute(stmt)

    for stmt in enable_rls_statements():
        op.execute(stmt)


def downgrade() -> None:
    for stmt in disable_rls_statements():
        op.execute(stmt)

    op.drop_index("uq_one_owner_per_project", table_name="project_members")
    op.drop_index("ix_project_members_user_id", table_name="project_members")
    op.drop_table("project_members")

    op.drop_index("ix_projects_organization_id", table_name="projects")
    op.drop_table("projects")

    project_role = postgresql.ENUM(*PROJECT_ROLE_VALUES, name="projectrole")
    project_role.drop(op.get_bind(), checkfirst=False)
