"""Add storeys + aligned_sheets tenant tables (PDF<->3D sheet alignment).

Two new tenant tables:

* ``storeys`` — a building level extracted from a 3D model's IFC spatial tree
  (idempotent upsert by ``(model_id, ifc_guid)``).
* ``aligned_sheets`` — the bridge linking a 3D ``Model`` (+ one of its storeys)
  to a PDF ``Model`` page, carrying the calibrated 2-point similarity transform.

No new Postgres enum is introduced — ``transform_type`` is a ``String`` + CHECK
(enum-evolution rule), so this migration never touches the tenant enum set.

Like the squashed baseline, the upgrade is driven by ``create_all`` over the
live ORM tables (``checkfirst`` makes it idempotent): on a freshly-provisioned
dev schema the baseline already created these tables, so this is a no-op there
while still being the upgrade path for pre-existing org schemas. Roll out across
every org schema with ``uv run python -m bimstitch_api.scripts.migrate_all``.

Revision ID: 0002_sheet_alignment
Revises: 0001_tenant
Create Date: 2026-06-24
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from alembic import op

if TYPE_CHECKING:
    from collections.abc import Sequence

# Revision identifiers, used by Alembic.
revision: str = "0002_sheet_alignment"
down_revision: str | None = "0001_tenant"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Importing the models package registers every model with Base.metadata; the
    # two explicit imports below are the tables this revision owns.
    from bimstitch_api.db import Base
    from bimstitch_api.models.aligned_sheets import AlignedSheet
    from bimstitch_api.models.storeys import Storey

    bind = op.get_bind()
    # checkfirst=True (the default) -> idempotent: skips tables that already
    # exist (e.g. created by the baseline's create_all on a fresh dev schema).
    Base.metadata.create_all(bind, tables=[Storey.__table__, AlignedSheet.__table__])


def downgrade() -> None:
    from bimstitch_api.db import Base
    from bimstitch_api.models.aligned_sheets import AlignedSheet
    from bimstitch_api.models.storeys import Storey

    bind = op.get_bind()
    # drop_all resolves FK dependency order (aligned_sheets before storeys).
    Base.metadata.drop_all(bind, tables=[AlignedSheet.__table__, Storey.__table__])
