"""Free-tier pooled tables: free_models, free_snags (master/`public` chain).

The free wedge keeps free users as pooled rows in `public`, never their own
`org_<hex>` schema, so this is a MASTER-chain migration only — it does NOT touch
the tenant chain and needs NO `migrate_all` fan-out. Creates the two tables, an
explicit DML grant to `bim_app` (the role 0001 created), and owner-keyed RLS.

Revision ID: 0002_free_tier
Revises: 0001_master
Create Date: 2026-06-28
"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op

revision: str = "0002_free_tier"
down_revision: Union[str, None] = "0001_master"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    from bimdossier_api._rls_sql import APP_ROLE, enable_free_tier_rls_statements
    from bimdossier_api.db import Base
    from bimdossier_api.models.free_model import FreeModel
    from bimdossier_api.models.free_snag import FreeSnag

    bind = op.get_bind()
    Base.metadata.create_all(bind, tables=[FreeModel.__table__, FreeSnag.__table__])

    # 0001 set ALTER DEFAULT PRIVILEGES so superuser-created public tables grant
    # to bim_app automatically; grant explicitly too so a differently-named
    # deploy role still gets DML on the free tables.
    op.execute(
        f"GRANT SELECT, INSERT, UPDATE, DELETE ON "
        f"public.free_models, public.free_snags TO {APP_ROLE};"
    )
    op.execute(
        f"GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO {APP_ROLE};"
    )

    for stmt in enable_free_tier_rls_statements():
        op.execute(stmt)


def downgrade() -> None:
    from bimdossier_api._rls_sql import disable_free_tier_rls_statements
    from bimdossier_api.db import Base
    from bimdossier_api.models.free_model import FreeModel
    from bimdossier_api.models.free_snag import FreeSnag

    bind = op.get_bind()
    for stmt in disable_free_tier_rls_statements():
        op.execute(stmt)
    Base.metadata.drop_all(bind, tables=[FreeSnag.__table__, FreeModel.__table__])
