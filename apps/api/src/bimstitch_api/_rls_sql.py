"""Row-level security DDL for master tables only.

With schema-per-tenant (one Postgres schema per organization), tenant
isolation is enforced by the schema namespace itself — `bim_app` has no
grants on schemas it doesn't belong to, so even raw SQL like
`SELECT * FROM "org_<other>".projects` is denied at the schema level.
RLS on tenant tables would be redundant.

The policies in this module live only on **master** tables in `public`:

  * `users` — self-read OR member-of-active-org
  * `organization_members` — only see your active org's members
  * `audit_log` — only see your active org's entries (or all if NULL)

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
    "audit_log",
)

# Master tables the app role needs DML privileges on. `organizations` and
# `access_requests` are included so reads from inside a tenant session
# (which has SET ROLE bim_app) can still see org metadata + lead-capture rows.
APP_GRANT_TABLES = (
    "users",
    "organizations",
    "organization_members",
    "audit_log",
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

    # audit_log:
    #   - org-scoped entries visible to org members
    #   - org-NULL entries (platform-level events) visible to everyone; in
    #     practice only super-admins read those because non-admin endpoints
    #     don't expose audit_log
    stmts.append("DROP POLICY IF EXISTS audit_log_isolation ON audit_log;")
    stmts.append(
        """
        CREATE POLICY audit_log_isolation ON audit_log
        USING (
            organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid
            OR organization_id IS NULL
        );
        """
    )
    # Inserts come from app code with explicit organization_id — no WITH
    # CHECK clause means inserts respect the USING clause, which is fine:
    # an admin acting in org A can only insert audit rows for org A.

    return stmts


def disable_rls_statements() -> list[str]:
    """Reverse of `enable_rls_statements`; used by migration downgrade."""
    stmts: list[str] = []
    stmts.append("DROP POLICY IF EXISTS audit_log_isolation ON audit_log;")
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
    ]


def drop_tenant_schema(schema: str) -> list[str]:
    """SQL to remove a tenant schema and everything in it. Called by
    organization deletion (`DELETE /admin/organizations/{id}`) and by the
    provisioning saga's compensation when a later step fails.
    """
    return [
        f'DROP SCHEMA IF EXISTS "{schema}" CASCADE;',
    ]
