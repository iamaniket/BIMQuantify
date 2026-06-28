"""Row-level security DDL for master tables only.

With schema-per-tenant (one Postgres schema per organization), tenant
isolation is enforced by the schema namespace itself — `bim_app` has no
grants on schemas it doesn't belong to, so even raw SQL like
`SELECT * FROM "org_<other>".projects` is denied at the schema level.
RLS on tenant tables would be redundant.

The policies in this module live only on **master** tables in `public`:

  * `users` — self-read OR member-of-active-org
  * `organization_members` — only see your active org's members

(`audit_log` is a tenant table — one per org schema — so its isolation comes
from the schema namespace, not RLS.)

The GUC source-of-truth (`app.current_org_id`, `app.current_user_id`) is
set by `tenancy.py::get_tenant_session` from the JWT `org` claim. Outside
a tenant session — for example, super-admin endpoints, the FastAPI Users
verify/reset flows, and the processor callback — the connection uses the
superuser role which bypasses RLS entirely.

## Why a separate `bim_app` role

PostgreSQL bypasses RLS for any role with SUPERUSER or BYPASSRLS, even
under FORCE ROW LEVEL SECURITY. The default `bim` role in dev is a
superuser, so `tenancy.py` drops to `bim_app` (non-bypass) for the
duration of each tenant transaction. Outside that transaction the
connection reverts to the superuser so admin paths just work.
"""

# Non-superuser, non-bypass role the app SET LOCAL ROLEs into for tenant
# queries. Created idempotently in create_app_role_statements().
APP_ROLE = "bim_app"

# Master tables that carry RLS. Tenant tables get no RLS — their schema
# already does the isolation work.
RLS_TABLES = (
    "users",
    "organization_members",
)

# Master tables the app role needs DML privileges on. `organizations` and
# `access_requests` are included so reads from inside a tenant session
# (which has SET ROLE bim_app) can still see org metadata + lead-capture rows.
APP_GRANT_TABLES = (
    "users",
    "organizations",
    "organization_members",
    "access_requests",
)


def create_app_role_statements() -> list[str]:
    """Idempotent SQL that creates the non-bypass app role and grants it
    the master-table privileges it needs. Per-schema grants for tenant
    tables are added by the provisioning saga, not here.

    Must run AFTER the master tables exist (the GRANTs depend on them);
    the role itself can exist beforehand.
    """
    return [
        f"""
        DO $$
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{APP_ROLE}') THEN
                CREATE ROLE {APP_ROLE} NOLOGIN NOSUPERUSER NOBYPASSRLS;
            END IF;
        END $$;
        """,
        # The connecting (superuser) role must be a member of bim_app to
        # SET LOCAL ROLE into it. CURRENT_USER works for both `bim` (dev)
        # and whatever the deployed role is named.
        f"GRANT {APP_ROLE} TO CURRENT_USER;",
        f"GRANT USAGE ON SCHEMA public TO {APP_ROLE};",
        f"GRANT SELECT, INSERT, UPDATE, DELETE ON {', '.join(APP_GRANT_TABLES)} TO {APP_ROLE};",
        # Future master tables (added in later master migrations) should
        # also be automatically grantable.
        f"ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO {APP_ROLE};",
    ]


def enable_rls_statements() -> list[str]:
    """SQL to enable + force RLS on master tables and create policies.
    Idempotent: drops any existing policy with the same name before
    recreating it.
    """
    stmts: list[str] = []

    for table in RLS_TABLES:
        stmts.append(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY;")
        stmts.append(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY;")

    # users:
    #   - always allow self-read (id matches current_user_id GUC)
    #   - allow reads of users who share the current active org
    # The org membership lookup goes through organization_members so a user
    # can see colleagues without needing direct column denormalization.
    stmts.append("DROP POLICY IF EXISTS users_tenant_isolation ON users;")
    stmts.append(
        """
        CREATE POLICY users_tenant_isolation ON users
        USING (
            id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
            OR id IN (
                SELECT user_id FROM organization_members
                WHERE organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid
                  AND status = 'active'
            )
        )
        WITH CHECK (
            id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
            OR id IN (
                SELECT user_id FROM organization_members
                WHERE organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid
                  AND status = 'active'
            )
        );
        """
    )

    # organization_members: only see your active org's membership rows.
    # Super-admin endpoints bypass via the superuser role.
    stmts.append("DROP POLICY IF EXISTS organization_members_isolation ON organization_members;")
    stmts.append(
        """
        CREATE POLICY organization_members_isolation ON organization_members
        USING (
            organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid
        )
        WITH CHECK (
            organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid
        );
        """
    )

    return stmts


# Pooled free-tier tables in `public`. Unlike the master tables above (keyed on
# the org GUC), these are keyed on the OWNER directly — a free account is
# org-less, so `get_free_session` sets only `app.current_user_id`.
FREE_RLS_TABLES = (
    "free_models",
    "free_snags",
)


def enable_free_tier_rls_statements(
    tables: tuple[str, ...] = FREE_RLS_TABLES,
) -> list[str]:
    """ENABLE + FORCE RLS on the pooled free-tier tables with an owner-keyed
    policy. The policy is load-bearing: free reads/writes run as `bim_app` with
    only `app.current_user_id` set, so this is what stops user A touching user
    B's free rows. The free callback runs as the superuser (bypasses RLS), so it
    must additionally validate keys via `assert_free_key_scoped`.

    `tables` defaults to the original pair so the 0002 migration is unchanged;
    a later migration (0003 `free_projects`) passes its own one-element tuple so
    it does not try to policy a table that does not exist yet at 0002 time.

    Idempotent (DROP POLICY IF EXISTS before CREATE), like enable_rls_statements.
    """
    stmts: list[str] = []
    for table in tables:
        stmts.append(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY;")
        stmts.append(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY;")
        stmts.append(f"DROP POLICY IF EXISTS {table}_owner_isolation ON {table};")
        stmts.append(
            f"""
            CREATE POLICY {table}_owner_isolation ON {table}
            USING (
                owner_user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
            )
            WITH CHECK (
                owner_user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
            );
            """
        )
    return stmts


def disable_free_tier_rls_statements(
    tables: tuple[str, ...] = FREE_RLS_TABLES,
) -> list[str]:
    """Reverse of `enable_free_tier_rls_statements` (migration downgrade /
    test teardown)."""
    stmts: list[str] = []
    for table in tables:
        stmts.append(f"DROP POLICY IF EXISTS {table}_owner_isolation ON {table};")
        stmts.append(f"ALTER TABLE {table} NO FORCE ROW LEVEL SECURITY;")
        stmts.append(f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY;")
    return stmts


def disable_rls_statements() -> list[str]:
    """Reverse of `enable_rls_statements`; used by migration downgrade."""
    stmts: list[str] = []
    stmts.append("DROP POLICY IF EXISTS organization_members_isolation ON organization_members;")
    stmts.append("DROP POLICY IF EXISTS users_tenant_isolation ON users;")
    for table in RLS_TABLES:
        stmts.append(f"ALTER TABLE {table} NO FORCE ROW LEVEL SECURITY;")
        stmts.append(f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY;")
    return stmts


def grant_schema_to_app_role(schema: str) -> list[str]:
    """SQL to grant the `bim_app` role full DML on every table in a
    freshly-created tenant schema. Called by the provisioning saga after
    the tenant Alembic chain runs.

    Default privileges are also set so future tenant migrations (which
    create new tables in this schema) automatically grant to bim_app
    without needing to re-run grants.
    """
    return [
        f'GRANT USAGE, CREATE ON SCHEMA "{schema}" TO {APP_ROLE};',
        f'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "{schema}" TO {APP_ROLE};',
        f'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA "{schema}" TO {APP_ROLE};',
        f'ALTER DEFAULT PRIVILEGES IN SCHEMA "{schema}" '
        f'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO {APP_ROLE};',
        f'ALTER DEFAULT PRIVILEGES IN SCHEMA "{schema}" '
        f'GRANT USAGE, SELECT ON SEQUENCES TO {APP_ROLE};',
        # audit_log is append-only — strip the UPDATE/DELETE the blanket grant
        # above just handed out, and install the deny trigger. MUST come after
        # the `GRANT ... ON ALL TABLES` or the grant re-adds the privileges.
        *audit_log_append_only_statements(schema),
    ]


def audit_log_append_only_statements(schema: str) -> list[str]:
    """SQL that makes ``<schema>.audit_log`` append-only (H8).

    Two layers, neither of which any app code needs (nothing ever UPDATEs or
    DELETEs audit rows — the only removals are superuser ``TRUNCATE`` in the
    seed reset / test teardown and ``DROP SCHEMA CASCADE`` at org purge):

      1. ``REVOKE UPDATE, DELETE, TRUNCATE ... FROM bim_app`` — the role that
         serves *all* request traffic can no longer mutate the forensic trail.
         (TRUNCATE was never granted to bim_app; revoking it documents intent
         and is defense-in-depth.)
      2. A ``BEFORE UPDATE OR DELETE`` row trigger that raises — a
         role-independent backstop so even a compromised superuser can't make
         a surgical edit. Deliberately NOT a ``BEFORE TRUNCATE`` trigger: that
         would fire for the superuser and break the seed reset and the test
         teardown, both of which legitimately TRUNCATE audit_log.

    The trigger function is created *inside the tenant schema* (not a shared
    ``public`` one) so ``DROP SCHEMA ... CASCADE`` at org purge removes it.

    Each element is a standalone statement — callers run them one per
    round-trip (asyncpg rejects multi-command strings). Idempotent
    (``CREATE OR REPLACE`` + ``DROP TRIGGER IF EXISTS`` + re-runnable
    ``REVOKE``) so the migrate_all fan-out and manual re-runs are safe.
    """
    return [
        f'REVOKE UPDATE, DELETE, TRUNCATE ON "{schema}".audit_log FROM {APP_ROLE};',
        f'CREATE OR REPLACE FUNCTION "{schema}".audit_log_deny_write() RETURNS trigger '
        "LANGUAGE plpgsql AS $$ BEGIN "
        "RAISE EXCEPTION 'audit_log is append-only; % is not permitted', TG_OP "
        "USING ERRCODE = 'insufficient_privilege'; END; $$;",
        f'DROP TRIGGER IF EXISTS audit_log_append_only ON "{schema}".audit_log;',
        f'CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON "{schema}".audit_log '
        f'FOR EACH ROW EXECUTE FUNCTION "{schema}".audit_log_deny_write();',
    ]


def drop_tenant_schema(schema: str) -> list[str]:
    """SQL to remove a tenant schema and everything in it. Called by
    organization deletion (`DELETE /admin/organizations/{id}`) and by the
    provisioning saga's compensation when a later step fails.
    """
    return [
        f'DROP SCHEMA IF EXISTS "{schema}" CASCADE;',
    ]
