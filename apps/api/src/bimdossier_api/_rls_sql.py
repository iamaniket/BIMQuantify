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
    "free_findings",
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


# ---------------------------------------------------------------------------
# Free-tier collaboration: owner-OR-member RLS (migration 0004)
#
# Once a free project can have invited members, the simple owner-keyed policies
# above no longer suffice — a member's `owner_user_id` is NOT the row owner, yet
# they must read the shared project / its models / its snags. The policies below
# broaden visibility to "owner OR project member".
#
# The membership lookup MUST NOT be inlined as a plain sub-SELECT, because a
# policy on `free_projects` that reads `free_project_members` (whose own policy
# reads `free_projects`) is a cross-table RLS recursion. The three SECURITY
# DEFINER helpers below run as the function owner (the migration's superuser),
# bypassing RLS entirely, which breaks every cycle. They are the load-bearing
# boundary — keep them SECURITY DEFINER and keep `search_path` pinned.
# ---------------------------------------------------------------------------

# The pooled free tables that carry the member-aware policy. Order matters for
# enable (functions first) but not for the table loop. `free_models` was replaced
# by the `free_documents` → `free_project_files` mirror of the paid Document →
# ProjectFile stack (migration 0005).
FREE_MEMBER_RLS_TABLES = (
    "free_projects",
    "free_documents",
    "free_project_files",
    "free_findings",
    "free_project_members",
)

# The `_uid` GUC expression, repeated in every policy.
_FREE_UID = "NULLIF(current_setting('app.current_user_id', true), '')::uuid"


def free_member_function_statements() -> list[str]:
    """The three SECURITY DEFINER helpers the member-aware policies key on.

    `search_path` is pinned to `public, pg_temp` and every table is schema-
    qualified so a SECURITY DEFINER function can't be hijacked by a caller's
    search_path. Each is owned by whoever runs the migration (a superuser), so
    it reads the pooled tables with RLS bypassed — that is what stops the
    cross-table policy recursion. Idempotent via CREATE OR REPLACE.
    """
    return [
        # Is `p_user` an invited member of `p_project_id`? Reads ONLY
        # free_project_members (RLS-bypassed) so free_projects/free_documents
        # policies can call it without recursing through this table's policy.
        """
        CREATE OR REPLACE FUNCTION public.free_is_member(p_project_id uuid, p_user uuid)
        RETURNS boolean
        LANGUAGE sql
        STABLE
        SECURITY DEFINER
        SET search_path = public, pg_temp
        AS $$
            SELECT EXISTS (
                SELECT 1 FROM public.free_project_members m
                WHERE m.free_project_id = p_project_id AND m.user_id = p_user
            );
        $$;
        """,
        # Does `p_user` own `p_project_id`? Reads ONLY free_projects so the
        # free_project_members policy can call it without recursing through the
        # free_projects policy.
        """
        CREATE OR REPLACE FUNCTION public.free_is_project_owner(p_project_id uuid, p_user uuid)
        RETURNS boolean
        LANGUAGE sql
        STABLE
        SECURITY DEFINER
        SET search_path = public, pg_temp
        AS $$
            SELECT EXISTS (
                SELECT 1 FROM public.free_projects p
                WHERE p.id = p_project_id AND p.owner_user_id = p_user
            );
        $$;
        """,
        # The project a document (container) belongs to. Reads ONLY free_documents
        # so the free_project_files / free_findings policies can resolve a row's
        # project without recursing through the free_documents policy.
        """
        CREATE OR REPLACE FUNCTION public.free_document_project(p_document_id uuid)
        RETURNS uuid
        LANGUAGE sql
        STABLE
        SECURITY DEFINER
        SET search_path = public, pg_temp
        AS $$
            SELECT free_project_id FROM public.free_documents WHERE id = p_document_id;
        $$;
        """,
    ]


def drop_free_member_function_statements() -> list[str]:
    """Reverse of `free_member_function_statements`."""
    return [
        "DROP FUNCTION IF EXISTS public.free_is_member(uuid, uuid);",
        "DROP FUNCTION IF EXISTS public.free_is_project_owner(uuid, uuid);",
        "DROP FUNCTION IF EXISTS public.free_document_project(uuid);",
    ]


def enable_free_member_rls_statements() -> list[str]:
    """ENABLE + FORCE owner-OR-member RLS on all four pooled free tables.

    Replaces the simple owner-keyed policies installed by 0002/0003 (same policy
    name `<table>_owner_isolation`, so the DROP IF EXISTS below removes them).
    Self-contained: creates the SECURITY DEFINER helpers first, then the
    per-table policies. Idempotent.

    WITH CHECK is deliberately tighter than USING:
      * free_projects / free_documents / free_project_files — only the owner may
        INSERT/UPDATE the row (a member's editor/viewer write permission is
        enforced in the router, not RLS), so WITH CHECK is owner-only even though
        USING is owner-OR-member for reads.
      * free_findings — an editor member may file a snag, so WITH CHECK matches
        USING (owner-OR-member). The editor/viewer distinction is enforced in
        the router, not here (RLS = isolation, router = permissions).
    """
    stmts: list[str] = list(free_member_function_statements())

    for table in FREE_MEMBER_RLS_TABLES:
        stmts.append(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY;")
        stmts.append(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY;")
        stmts.append(f"DROP POLICY IF EXISTS {table}_owner_isolation ON {table};")

    # free_projects: owner via column, members via the membership table.
    stmts.append(
        f"""
        CREATE POLICY free_projects_owner_isolation ON public.free_projects
        USING (
            owner_user_id = {_FREE_UID}
            OR public.free_is_member(id, {_FREE_UID})
        )
        WITH CHECK (owner_user_id = {_FREE_UID});
        """
    )
    # free_documents: owner via column, members via the container's project
    # (free_project_id is NOT NULL — every container belongs to a project).
    stmts.append(
        f"""
        CREATE POLICY free_documents_owner_isolation ON public.free_documents
        USING (
            owner_user_id = {_FREE_UID}
            OR public.free_is_member(free_project_id, {_FREE_UID})
        )
        WITH CHECK (owner_user_id = {_FREE_UID});
        """
    )
    # free_project_files: owner via column, members via the parent document's
    # project (resolved by the SECURITY DEFINER helper to avoid cross-table
    # recursion into the free_documents policy).
    stmts.append(
        f"""
        CREATE POLICY free_project_files_owner_isolation ON public.free_project_files
        USING (
            owner_user_id = {_FREE_UID}
            OR public.free_is_member(public.free_document_project(free_document_id), {_FREE_UID})
        )
        WITH CHECK (owner_user_id = {_FREE_UID});
        """
    )
    # free_findings: owner via column, members via the parent document's project.
    stmts.append(
        f"""
        CREATE POLICY free_findings_owner_isolation ON public.free_findings
        USING (
            owner_user_id = {_FREE_UID}
            OR public.free_is_member(public.free_document_project(free_document_id), {_FREE_UID})
        )
        WITH CHECK (
            owner_user_id = {_FREE_UID}
            OR public.free_is_member(public.free_document_project(free_document_id), {_FREE_UID})
        );
        """
    )
    # free_project_members: visible to the member themselves and to the project
    # owner. WITH CHECK is owner-only (only the owner manages membership).
    stmts.append(
        f"""
        CREATE POLICY free_project_members_owner_isolation ON public.free_project_members
        USING (
            user_id = {_FREE_UID}
            OR public.free_is_project_owner(free_project_id, {_FREE_UID})
        )
        WITH CHECK (
            public.free_is_project_owner(free_project_id, {_FREE_UID})
        );
        """
    )
    return stmts


def disable_free_member_rls_statements() -> list[str]:
    """Reverse of `enable_free_member_rls_statements` (0004 downgrade / test
    teardown). Drops the policies, the FORCE/ENABLE flags, and the helpers."""
    stmts: list[str] = []
    for table in FREE_MEMBER_RLS_TABLES:
        stmts.append(f"DROP POLICY IF EXISTS {table}_owner_isolation ON {table};")
        stmts.append(f"ALTER TABLE {table} NO FORCE ROW LEVEL SECURITY;")
        stmts.append(f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY;")
    stmts.extend(drop_free_member_function_statements())
    return stmts


# ---------------------------------------------------------------------------
# Free-tier levels + aligned sheets: owner-OR-member RLS (migrations 0010/0011)
#
# `public.free_levels` (a project's building levels) and `public.free_aligned_sheets`
# (PDF↔IFC calibration) are project-scoped, so isolation is owner-OR-member through
# the project — reusing the `free_is_member` SECURITY DEFINER helper created by the
# free-member RLS (migration 0004). Owner-only writes (members read); the
# editor/viewer distinction is enforced in the router, not RLS.
# ---------------------------------------------------------------------------


def enable_free_level_rls_statements() -> list[str]:
    """ENABLE + FORCE owner-OR-member RLS on `public.free_levels`. Idempotent.
    Relies on `public.free_is_member` (created by the free-member RLS)."""
    return [
        "ALTER TABLE public.free_levels ENABLE ROW LEVEL SECURITY;",
        "ALTER TABLE public.free_levels FORCE ROW LEVEL SECURITY;",
        "DROP POLICY IF EXISTS free_levels_owner_isolation ON public.free_levels;",
        f"""
        CREATE POLICY free_levels_owner_isolation ON public.free_levels
        USING (
            owner_user_id = {_FREE_UID}
            OR public.free_is_member(free_project_id, {_FREE_UID})
        )
        WITH CHECK (owner_user_id = {_FREE_UID});
        """,
    ]


def disable_free_level_rls_statements() -> list[str]:
    return [
        "DROP POLICY IF EXISTS free_levels_owner_isolation ON public.free_levels;",
        "ALTER TABLE public.free_levels NO FORCE ROW LEVEL SECURITY;",
        "ALTER TABLE public.free_levels DISABLE ROW LEVEL SECURITY;",
    ]


def enable_free_aligned_sheet_rls_statements() -> list[str]:
    """ENABLE + FORCE owner-OR-member RLS on `public.free_aligned_sheets`. Idempotent.
    Relies on `public.free_is_member` (created by the free-member RLS)."""
    return [
        "ALTER TABLE public.free_aligned_sheets ENABLE ROW LEVEL SECURITY;",
        "ALTER TABLE public.free_aligned_sheets FORCE ROW LEVEL SECURITY;",
        "DROP POLICY IF EXISTS free_aligned_sheets_owner_isolation ON public.free_aligned_sheets;",
        f"""
        CREATE POLICY free_aligned_sheets_owner_isolation ON public.free_aligned_sheets
        USING (
            owner_user_id = {_FREE_UID}
            OR public.free_is_member(free_project_id, {_FREE_UID})
        )
        WITH CHECK (owner_user_id = {_FREE_UID});
        """,
    ]


def disable_free_aligned_sheet_rls_statements() -> list[str]:
    return [
        "DROP POLICY IF EXISTS free_aligned_sheets_owner_isolation ON public.free_aligned_sheets;",
        "ALTER TABLE public.free_aligned_sheets NO FORCE ROW LEVEL SECURITY;",
        "ALTER TABLE public.free_aligned_sheets DISABLE ROW LEVEL SECURITY;",
    ]


# ---------------------------------------------------------------------------
# Free-tier notifications: per-recipient RLS (migration 0008)
#
# `public.free_notifications` (+ `free_notification_user_state`) back the free
# bell. Rows are PER-RECIPIENT, so isolation is a direct equality on the user GUC
# — no membership join (unlike the owner-OR-member free tables above). Reads run as
# `bim_app` via `get_free_session` with only `app.current_user_id` set; the
# emission path runs as the superuser (RLS-bypassing) to fan out to other users.
# ---------------------------------------------------------------------------

FREE_NOTIFICATION_RLS_TABLES = (
    "free_notifications",
    "free_notification_user_state",
)
# (table, recipient-key column) — both scope to a single user.
_FREE_NOTIFICATION_POLICY_KEYS = (
    ("free_notifications", "recipient_user_id"),
    ("free_notification_user_state", "user_id"),
)


def enable_free_notification_rls_statements() -> list[str]:
    """ENABLE + FORCE RLS on the pooled free-notification tables with a
    user-scoped policy (`<key> = app.current_user_id`). Load-bearing: it stops
    user A reading/dismissing user B's free notifications. Idempotent (DROP POLICY
    IF EXISTS before CREATE)."""
    stmts: list[str] = []
    for table, key in _FREE_NOTIFICATION_POLICY_KEYS:
        stmts.append(f"ALTER TABLE public.{table} ENABLE ROW LEVEL SECURITY;")
        stmts.append(f"ALTER TABLE public.{table} FORCE ROW LEVEL SECURITY;")
        stmts.append(f"DROP POLICY IF EXISTS {table}_recipient_isolation ON public.{table};")
        stmts.append(
            f"""
            CREATE POLICY {table}_recipient_isolation ON public.{table}
            USING ({key} = {_FREE_UID})
            WITH CHECK ({key} = {_FREE_UID});
            """
        )
    return stmts


def disable_free_notification_rls_statements() -> list[str]:
    """Reverse of `enable_free_notification_rls_statements` (0008 downgrade / test
    teardown)."""
    stmts: list[str] = []
    for table in FREE_NOTIFICATION_RLS_TABLES:
        stmts.append(f"DROP POLICY IF EXISTS {table}_recipient_isolation ON public.{table};")
        stmts.append(f"ALTER TABLE public.{table} NO FORCE ROW LEVEL SECURITY;")
        stmts.append(f"ALTER TABLE public.{table} DISABLE ROW LEVEL SECURITY;")
    return stmts


# ---------------------------------------------------------------------------
# Free-tier attachments: owner-OR-member RLS (migration 0013)
#
# `public.free_attachments` (photo/file evidence) is project-scoped, and
# `public.free_finding_attachments` (snag→attachment links) is finding-scoped.
# Both carry owner-OR-member isolation through the project — owner via the
# denormalized `owner_user_id`, members via the `free_is_member` SECURITY DEFINER
# helper (created by the free-member RLS, migration 0004). Members may upload
# evidence + link it to a snag they file, so WITH CHECK matches USING (the
# editor/viewer write split is enforced in the router, not RLS).
# ---------------------------------------------------------------------------


def enable_free_attachment_rls_statements() -> list[str]:
    """ENABLE + FORCE owner-OR-member RLS on the free attachment tables. Idempotent.
    Relies on `public.free_is_member` / `public.free_document_project` (free-member RLS)."""
    return [
        "ALTER TABLE public.free_attachments ENABLE ROW LEVEL SECURITY;",
        "ALTER TABLE public.free_attachments FORCE ROW LEVEL SECURITY;",
        "DROP POLICY IF EXISTS free_attachments_owner_isolation ON public.free_attachments;",
        f"""
        CREATE POLICY free_attachments_owner_isolation ON public.free_attachments
        USING (
            owner_user_id = {_FREE_UID}
            OR public.free_is_member(free_project_id, {_FREE_UID})
        )
        WITH CHECK (
            owner_user_id = {_FREE_UID}
            OR public.free_is_member(free_project_id, {_FREE_UID})
        );
        """,
        "ALTER TABLE public.free_finding_attachments ENABLE ROW LEVEL SECURITY;",
        "ALTER TABLE public.free_finding_attachments FORCE ROW LEVEL SECURITY;",
        "DROP POLICY IF EXISTS free_finding_attachments_owner_isolation "
        "ON public.free_finding_attachments;",
        f"""
        CREATE POLICY free_finding_attachments_owner_isolation
        ON public.free_finding_attachments
        USING (
            owner_user_id = {_FREE_UID}
            OR public.free_is_member(
                public.free_document_project(free_document_id), {_FREE_UID}
            )
        )
        WITH CHECK (
            owner_user_id = {_FREE_UID}
            OR public.free_is_member(
                public.free_document_project(free_document_id), {_FREE_UID}
            )
        );
        """,
    ]


def disable_free_attachment_rls_statements() -> list[str]:
    """Reverse of `enable_free_attachment_rls_statements` (0013 downgrade / test
    teardown)."""
    return [
        "DROP POLICY IF EXISTS free_finding_attachments_owner_isolation "
        "ON public.free_finding_attachments;",
        "ALTER TABLE public.free_finding_attachments NO FORCE ROW LEVEL SECURITY;",
        "ALTER TABLE public.free_finding_attachments DISABLE ROW LEVEL SECURITY;",
        "DROP POLICY IF EXISTS free_attachments_owner_isolation ON public.free_attachments;",
        "ALTER TABLE public.free_attachments NO FORCE ROW LEVEL SECURITY;",
        "ALTER TABLE public.free_attachments DISABLE ROW LEVEL SECURITY;",
    ]


# Every pooled free-tier table the app role needs DML on. The squashed master
# baseline grants these in one shot AFTER create_all — mirroring the per-table
# GRANTs the (now-squashed) free-tier deltas applied inline. Necessary because
# create_app_role_statements() only grants the master identity tables
# (APP_GRANT_TABLES), and its ALTER DEFAULT PRIVILEGES does not reach tables that
# create_all already made before it ran.
FREE_DML_TABLES = (
    *FREE_MEMBER_RLS_TABLES,
    "free_levels",
    "free_aligned_sheets",
    *FREE_NOTIFICATION_RLS_TABLES,
    "free_attachments",
    "free_finding_attachments",
)


def grant_free_tables_to_app_role() -> list[str]:
    """GRANT DML on every pooled free-tier table to the app role + sequence usage.

    Must run AFTER the free tables exist (create_all). Idempotent."""
    tables = ", ".join(f"public.{t}" for t in FREE_DML_TABLES)
    return [
        f"GRANT SELECT, INSERT, UPDATE, DELETE ON {tables} TO {APP_ROLE};",
        f"GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO {APP_ROLE};",
    ]


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
        f"GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO {APP_ROLE};",
        f'ALTER DEFAULT PRIVILEGES IN SCHEMA "{schema}" '
        f"GRANT USAGE, SELECT ON SEQUENCES TO {APP_ROLE};",
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
