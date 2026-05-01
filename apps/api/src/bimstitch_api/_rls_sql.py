"""Row-level security DDL shared between the Alembic migration and the test
engine fixture. Keeping the policy definitions in one place ensures the test DB
mirrors what production runs.

Future data migrations on these tables must temporarily disable FORCE before
DML and re-enable it afterwards:

    ALTER TABLE <table> NO FORCE ROW LEVEL SECURITY;
    -- ... data DML ...
    ALTER TABLE <table> FORCE ROW LEVEL SECURITY;

## Why a separate `bim_app` role

PostgreSQL bypasses RLS for any role with the SUPERUSER or BYPASSRLS
attribute, even when FORCE ROW LEVEL SECURITY is set. The default role
created by docker-compose is a superuser. To make RLS actually enforce, the
app does `SET LOCAL ROLE bim_app` (a non-superuser, non-bypass child role)
inside each tenant request transaction. Outside that transaction the
connection reverts to the superuser, so migrations and the registration
flow (which predates the org link) still work without contortions.
"""

# Non-superuser, non-bypass role the app SET LOCAL ROLEs into for tenant
# queries. Must be created before grants are applied.
APP_ROLE = "bim_app"

# Tables that get RLS + FORCE applied. `organizations` is intentionally excluded
# so users can read their own org row at signup.
RLS_TABLES = (
    "users",
    "projects",
    "project_members",
    "models",
    "project_files",
    "contractors",
    "jobs",
)

# Tables the app role needs DML privileges on (broader than RLS_TABLES because
# organizations is read by signup paths under SET ROLE too in the future).
APP_GRANT_TABLES = (
    "users",
    "organizations",
    "projects",
    "project_members",
    "models",
    "project_files",
    "contractors",
    "jobs",
)

# Subquery snippet reused by tables that scope through `projects.organization_id`.
PROJECT_ID_IN_ORG_SUBQUERY = (
    "project_id IN (\n"
    "    SELECT id FROM projects\n"
    "    WHERE organization_id = "
    "NULLIF(current_setting('app.current_org_id', true), '')::uuid\n"
    ")"
)

# Subquery snippet reused by tables that scope through `models.project_id`
# (which itself scopes through `projects.organization_id`).
MODEL_ID_IN_ORG_SUBQUERY = (
    "model_id IN (\n"
    "    SELECT id FROM models\n"
    "    WHERE project_id IN (\n"
    "        SELECT id FROM projects\n"
    "        WHERE organization_id = "
    "NULLIF(current_setting('app.current_org_id', true), '')::uuid\n"
    "    )\n"
    ")"
)


def create_app_role_statements() -> list[str]:
    """Idempotent SQL to create the non-bypass app role and grant it the table
    privileges it needs. Must run AFTER the tables exist (the GRANTs depend
    on them); the role itself can exist beforehand."""
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
        # SET LOCAL ROLE into it. CURRENT_USER works for both `bim` (dev) and
        # whatever the deployed role is named.
        f"GRANT {APP_ROLE} TO CURRENT_USER;",
        f"GRANT USAGE ON SCHEMA public TO {APP_ROLE};",
        f"GRANT SELECT, INSERT, UPDATE, DELETE ON {', '.join(APP_GRANT_TABLES)} TO {APP_ROLE};",
    ]


def enable_rls_statements() -> list[str]:
    """SQL to enable + force RLS and create policies. Idempotent: drops any
    existing policy with the same name before recreating it.
    """
    stmts: list[str] = []

    for table in RLS_TABLES:
        stmts.append(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY;")
        stmts.append(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY;")

    # users: org match OR self-read (lets /users/me work even before an org is
    # attached, and during the registration flow when the GUC is unset).
    stmts.append("DROP POLICY IF EXISTS users_tenant_isolation ON users;")
    stmts.append(
        """
        CREATE POLICY users_tenant_isolation ON users
        USING (
            organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid
            OR id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
        )
        WITH CHECK (
            organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid
            OR id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
        );
        """
    )

    org_match = "organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid"
    project_id_in_org = PROJECT_ID_IN_ORG_SUBQUERY
    model_id_in_org = MODEL_ID_IN_ORG_SUBQUERY

    # projects: straight org match.
    stmts.append("DROP POLICY IF EXISTS projects_tenant_isolation ON projects;")
    stmts.append(
        f"""
        CREATE POLICY projects_tenant_isolation ON projects
        USING ({org_match})
        WITH CHECK ({org_match});
        """
    )

    # project_members: filter via subquery on projects (which RLS already
    # restricts to the current org).
    stmts.append("DROP POLICY IF EXISTS project_members_tenant_isolation ON project_members;")
    stmts.append(
        f"""
        CREATE POLICY project_members_tenant_isolation ON project_members
        USING ({project_id_in_org})
        WITH CHECK ({project_id_in_org});
        """
    )

    # models: filter via subquery on projects (same shape as project_members).
    stmts.append("DROP POLICY IF EXISTS models_tenant_isolation ON models;")
    stmts.append(
        f"""
        CREATE POLICY models_tenant_isolation ON models
        USING ({project_id_in_org})
        WITH CHECK ({project_id_in_org});
        """
    )

    # project_files: scope through models (which scopes through projects).
    stmts.append("DROP POLICY IF EXISTS project_files_tenant_isolation ON project_files;")
    stmts.append(
        f"""
        CREATE POLICY project_files_tenant_isolation ON project_files
        USING ({model_id_in_org})
        WITH CHECK ({model_id_in_org});
        """
    )

    # contractors: straight org match (same shape as projects).
    stmts.append("DROP POLICY IF EXISTS contractors_tenant_isolation ON contractors;")
    stmts.append(
        f"""
        CREATE POLICY contractors_tenant_isolation ON contractors
        USING ({org_match})
        WITH CHECK ({org_match});
        """
    )

    # jobs: straight org match via organization_id column.
    stmts.append("DROP POLICY IF EXISTS jobs_tenant_isolation ON jobs;")
    stmts.append(
        f"""
        CREATE POLICY jobs_tenant_isolation ON jobs
        USING ({org_match})
        WITH CHECK ({org_match});
        """
    )

    return stmts


def disable_rls_statements() -> list[str]:
    """Reverse of enable_rls_statements; used by migration downgrade."""
    stmts: list[str] = []
    stmts.append("DROP POLICY IF EXISTS jobs_tenant_isolation ON jobs;")
    stmts.append("DROP POLICY IF EXISTS contractors_tenant_isolation ON contractors;")
    stmts.append("DROP POLICY IF EXISTS project_files_tenant_isolation ON project_files;")
    stmts.append("DROP POLICY IF EXISTS models_tenant_isolation ON models;")
    stmts.append("DROP POLICY IF EXISTS project_members_tenant_isolation ON project_members;")
    stmts.append("DROP POLICY IF EXISTS projects_tenant_isolation ON projects;")
    stmts.append("DROP POLICY IF EXISTS users_tenant_isolation ON users;")
    for table in RLS_TABLES:
        stmts.append(f"ALTER TABLE {table} NO FORCE ROW LEVEL SECURITY;")
        stmts.append(f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY;")
    return stmts
