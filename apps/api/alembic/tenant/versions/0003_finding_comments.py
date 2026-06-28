"""Finding discussion comments + @mention link table + notification targeting.

Adds, per tenant schema:
  * ``finding_comments`` — flat discussion thread per finding (soft-deletable).
  * ``finding_comment_mentions`` — (comment, user) @mention link rows.
  * ``notifications.recipient_user_id`` — per-recipient targeting (NULL =
    org-wide, the original behaviour; set = visible to one member only). Used by
    the targeted ``finding_mentioned`` notifications.

And in the shared ``public`` schema:
  * ``notificationeventtype`` enum value ``finding_mentioned`` — added with an
    UNQUALIFIED ``ALTER TYPE ... ADD VALUE IF NOT EXISTS`` (the enums-shared-in-
    public convention; ``IF NOT EXISTS`` keeps the migrate_all fan-out
    idempotent, and the value is only added here — never used in the same
    transaction — so it's safe inside Alembic's migration transaction on PG 12+).

On a fresh DB the live ORM models already declare all of the above (the baseline
``create_all`` emits them), so this delta is only for upgrading existing
deployments. Idempotent (``IF NOT EXISTS`` throughout) so the per-schema fan-out
can re-run safely.

Revision ID: 0003_finding_comments
Revises: 0002_pdf_pages_raster
Create Date: 2026-06-27
"""

from __future__ import annotations

import os
from typing import Sequence, Union

from alembic import op
from sqlalchemy import text

revision: str = "0003_finding_comments"
down_revision: Union[str, None] = "0002_pdf_pages_raster"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _schema() -> str:
    schema = os.environ.get("BIMDOSSIER_TENANT_SCHEMA")
    if not schema:
        raise RuntimeError("BIMDOSSIER_TENANT_SCHEMA is required for tenant migrations")
    return schema


def upgrade() -> None:
    schema = _schema()
    bind = op.get_bind()

    bind.execute(
        text(
            f'CREATE TABLE IF NOT EXISTS "{schema}".finding_comments ('
            "  id UUID PRIMARY KEY,"
            f'  finding_id UUID NOT NULL REFERENCES "{schema}".findings(id) ON DELETE CASCADE,'
            "  comment_text TEXT NOT NULL,"
            "  author VARCHAR(255) NOT NULL,"
            "  date TIMESTAMPTZ NOT NULL,"
            "  modified_author VARCHAR(255),"
            "  modified_date TIMESTAMPTZ,"
            "  created_by_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,"
            "  deleted_at TIMESTAMPTZ,"
            "  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),"
            "  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()"
            ")"
        )
    )
    bind.execute(
        text(
            f'CREATE INDEX IF NOT EXISTS ix_finding_comments_finding_id '
            f'ON "{schema}".finding_comments (finding_id)'
        )
    )
    bind.execute(
        text(
            f'CREATE INDEX IF NOT EXISTS ix_finding_comments_created_by_user_id '
            f'ON "{schema}".finding_comments (created_by_user_id)'
        )
    )

    bind.execute(
        text(
            f'CREATE TABLE IF NOT EXISTS "{schema}".finding_comment_mentions ('
            f'  comment_id UUID NOT NULL REFERENCES "{schema}".finding_comments(id) ON DELETE CASCADE,'
            "  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,"
            "  PRIMARY KEY (comment_id, user_id)"
            ")"
        )
    )

    bind.execute(
        text(
            f'ALTER TABLE "{schema}".notifications '
            "ADD COLUMN IF NOT EXISTS recipient_user_id UUID "
            "REFERENCES public.users(id) ON DELETE CASCADE"
        )
    )
    bind.execute(
        text(
            f'CREATE INDEX IF NOT EXISTS ix_notifications_recipient_user_id '
            f'ON "{schema}".notifications (recipient_user_id)'
        )
    )

    # Shared public enum — unqualified + IF NOT EXISTS (idempotent fan-out).
    bind.execute(
        text("ALTER TYPE notificationeventtype ADD VALUE IF NOT EXISTS 'finding_mentioned'")
    )


def downgrade() -> None:
    schema = _schema()
    bind = op.get_bind()
    bind.execute(text(f'DROP TABLE IF EXISTS "{schema}".finding_comment_mentions'))
    bind.execute(text(f'DROP TABLE IF EXISTS "{schema}".finding_comments'))
    bind.execute(
        text(
            f'ALTER TABLE "{schema}".notifications DROP COLUMN IF EXISTS recipient_user_id'
        )
    )
    # Postgres cannot drop an enum value; leave `finding_mentioned` in place
    # (harmless — a removed value would orphan any row still referencing it).
