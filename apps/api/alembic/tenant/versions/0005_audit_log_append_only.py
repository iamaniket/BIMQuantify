"""Make ``audit_log`` append-only per tenant schema (security finding H8).

Per tenant schema:
  * ``REVOKE UPDATE, DELETE, TRUNCATE ON <schema>.audit_log FROM bim_app`` — the
    role that serves all request traffic can no longer mutate the forensic trail.
  * A ``BEFORE UPDATE OR DELETE`` row trigger (``audit_log_append_only`` backed by
    the per-schema ``audit_log_deny_write()`` function) that raises — a
    role-independent backstop against surgical tampering even by a superuser.

There is deliberately NO ``BEFORE TRUNCATE`` trigger: it would fire for the
superuser and break the seed reset and the test teardown, both of which
legitimately TRUNCATE ``audit_log``. The ``REVOKE TRUNCATE`` is the app-role
guard; bim_app never had TRUNCATE anyway.

On a fresh DB the provisioning saga already applies these via
``grant_schema_to_app_role`` (which now folds in
``audit_log_append_only_statements``), so this delta is only for upgrading
existing org schemas. Idempotent (``CREATE OR REPLACE`` + ``DROP TRIGGER IF
EXISTS`` + re-runnable ``REVOKE``) so the per-schema migrate_all fan-out and
manual re-runs are safe.

HAZARD: ``audit_log`` is append-only by trigger + revoke. Dropping and
recreating the table would re-inherit full DML from this schema's
``ALTER DEFAULT PRIVILEGES`` grant and silently lose the trigger — don't.

Revision ID: 0005_audit_log_append_only
Revises: 0004_account_locked_enum
Create Date: 2026-06-28
"""

from __future__ import annotations

import os
from typing import Sequence, Union

from alembic import op
from sqlalchemy import text

from bimdossier_api._rls_sql import APP_ROLE, audit_log_append_only_statements

revision: str = "0005_audit_log_append_only"
down_revision: Union[str, None] = "0004_account_locked_enum"
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
    for stmt in audit_log_append_only_statements(schema):
        bind.execute(text(stmt))


def downgrade() -> None:
    schema = _schema()
    bind = op.get_bind()
    bind.execute(text(f'DROP TRIGGER IF EXISTS audit_log_append_only ON "{schema}".audit_log'))
    bind.execute(text(f'DROP FUNCTION IF EXISTS "{schema}".audit_log_deny_write()'))
    # Restore the DML the blanket schema grant would otherwise have given.
    bind.execute(text(f'GRANT UPDATE, DELETE ON "{schema}".audit_log TO {APP_ROLE}'))
