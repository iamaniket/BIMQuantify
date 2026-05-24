# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository shape

Polyglot monorepo:
- **Node/TypeScript workspaces** (`apps/web`, `apps/portal`, `packages/*`) coordinated by pnpm + Turborepo.
- **Node.js microservice** (`apps/processor`) — Fastify + BullMQ. Generic worker for IFC extraction, PDF metadata extraction, and PDF report generation (dispatched by `job_type`). In the pnpm workspace but uses `npm` internally and runs in Docker or standalone.
- **Python FastAPI backend** (`apps/api/`) — managed by `uv`. Has a minimal `package.json` (just a `dev` script) so pnpm sees it, but all real tooling goes through `uv`.

## Commands

### Node side (web + packages)

Requires Node >=20 and pnpm >=9 (`engines` in `package.json`). Package manager pinned to `pnpm@10.33.2`.

- `pnpm install` — bootstrap the workspace.
- `pnpm --filter=web dev` — web only (Next.js, port 3000).
- `pnpm --filter=portal dev` — portal only (Next.js, port 3001). WASM and fragments worker are auto-copied via the `predev` hook.
- `pnpm --filter=@bimstitch/<pkg> build` — build a single package. Apps use bare names (`web`, `portal`); internal packages use the `@bimstitch/*` scope.
- `pnpm build` / `pnpm lint` / `pnpm type-check` / `pnpm test` — turbo-coordinated across the TS graph.

### Processor worker

```bash
# Standalone (requires redis + minio running)
cd apps/processor && npm run dev   # Fastify on port 8080 + BullMQ worker

# Docker (preferred)
docker compose up -d processor     # exposed on host port 8088

# Tests (Vitest)
cd apps/processor && npm test
```

### Python side (API)

All commands run from `apps/api/`. Requires Python 3.12 and `uv`.

```bash
# one-time
docker compose up -d                 # all services (postgres, mailhog, redis, minio, processor)
cp .env.example .env
uv sync
uv run alembic -c alembic.master.ini upgrade head   # master chain → public schema
uv run python -m bimstitch_api.seed                 # platform + Acme + Beta orgs, dev users
                                                    # (provisions per-org schemas via the tenant chain)
# Seed user credentials live in apps/api/.env (template in .env.example, keys
# SEED_SUPERADMIN_*, SEED_ACME_*, SEED_BETA_*, SEED_CROSS_*). The script fails
# with a pydantic ValidationError if any of those env vars are missing.

# dev server
uv run uvicorn bimstitch_api.main:app --reload --port 8000

# migrations
uv run alembic revision --autogenerate -m "message"
uv run alembic upgrade head
uv run alembic downgrade -1

# tests (TDD — run these constantly)
uv run pytest                        # all
uv run pytest tests/test_signup.py   # one file
uv run pytest -k "login and bad"     # one case

# quality gates
uv run ruff check .
uv run ruff format .
uv run mypy src
```

**Test database**: `tests/conftest.py` points at `bimstitch_test` on `localhost:5434` (or `TEST_DATABASE_URL`). The `_ensure_test_db` fixture auto-creates the database if it doesn't exist — no manual `docker exec` needed. The conftest does `create_all`/`drop_all` per session and truncates tables between tests — no migrations in the test loop.

### E2E Testing (Playwright)

All commands run from `apps/portal/` (or use `pnpm --filter=portal` from repo root).

```bash
# Option A — dev containers (postgres, redis, mailhog already running via `docker compose up -d`)
# Stop the dev API first (port 8000 must be free — the test framework starts its own API).
pnpm --filter=portal test:e2e:multi:ci   # headless, single worker
pnpm --filter=portal test:e2e:multi      # interactive UI mode

# Option B — fully isolated test containers (CI/CD ready, one command)
pnpm --filter=portal test:e2e:full       # starts docker-compose.test.yml, runs tests, tears down
```

**How it works**:
- `global-setup.ts` creates an ephemeral `bimstitch_e2e` database, runs migrations + seed, starts a dedicated API process on port 8000.
- `global-teardown.ts` kills the API process after tests complete.
- `run-e2e.mjs` (Option B) orchestrates separate test containers (`docker-compose.test.yml`) on different ports to avoid conflicts with dev services.

**Database isolation summary**:
| Database | Purpose | Port | Redis DB |
|----------|---------|------|----------|
| `bimstitch` | Development | 5434 | 0 |
| `bimstitch_test` | API pytest | 5434 | 1 |
| `bimstitch_e2e` | E2E (dev containers) | 5434 | 2 |
| `bimstitch_e2e` | E2E (test containers) | 5435 | 0 |

**Environment variables**: E2E config is driven by `E2E_*` env vars (documented in `apps/api/.env.example` and `apps/portal/.env.example`). Defaults point at dev containers; `run-e2e.mjs` overrides them for test containers.

## Architecture — Python API

**Package**: `src/bimstitch_api/` (src layout). Entry point: `bimstitch_api.main:app`.

### Auth stack

FastAPI Users handles registration, verification, password reset, and the `/users/*` router. Two pieces are custom:

1. `auth/routes.py::login` overrides `/auth/jwt/login` to return **both** access + refresh tokens (FastAPI Users' built-in login only returns access). Uses `OAuth2PasswordRequestForm`, gates on `is_verified`, responds with `TokenPair`.
2. `auth/refresh.py` exposes `POST /auth/jwt/refresh` — decodes the refresh JWT, verifies `typ=refresh`, issues a fresh access token.

**Token separation** (`auth/tokens.py`): access and refresh tokens share the same secret/algorithm but use **different audiences** (`"fastapi-users:auth"` vs `"bimstitch:refresh"`). FastAPI Users' default `JWTStrategy` is pinned to the access audience, so presenting a refresh token at `/users/me` yields 401 — this is the only thing stopping refresh tokens from being accepted as access. Both tokens also carry a `typ` claim, which `decode_token` checks defensively.

**Logout** (`auth/logout.py`): `POST /auth/logout` decodes both access and refresh tokens, writes their JTIs into Redis (`cache/blocklist.py`, prefix `blk:jti:`) with TTL matching each token's remaining lifetime. The blocklist is checked on every authenticated request.

**Signup -> org link flow**:
1. `POST /auth/register` receives `email, password, full_name, organization_name`.
2. Custom route in `auth/routes.py` stores `organization_name` on `request.state` before calling `user_manager.create`.
3. `UserCreate.create_update_dict` strips `organization_name` so it never reaches the `User` SQLAlchemy model.
4. `UserManager.on_after_register` pops `organization_name` off `request.state`, upserts the `Organization` (race-safe via `IntegrityError` + reselect), writes `organization_id` onto both the DB row and the in-memory instance so the response reflects it.
5. `request_verify` fires — `on_after_request_verify` emails the token via `email.transport.get_email_transport()`.

**Email transport** is a small `Protocol` with two implementations in `email/transport.py`: `SMTPEmailTransport` (MailHog in dev, real SMTP in prod) and `InMemoryEmailTransport` (tests). The `email_transport` pytest fixture swaps in the in-memory one and exposes `last_for(email)` so tests read the verification token out of the email body directly.

**DB session lifecycle**: `db.py` lazily builds a single `AsyncEngine` + `async_sessionmaker`. `get_async_session` is the FastAPI dependency; `get_session_maker()` is used by code outside a request (e.g. `UserManager._link_to_organization`). Tests monkey-patch `db._engine` / `db._session_maker` before `create_app()` so the app uses the test DB.

### RLS multi-tenancy

`tenancy.py::get_tenant_session` opens a session, begins a transaction, runs `SET LOCAL ROLE bim_app` (a non-superuser role), then sets GUCs `app.current_org_id` and `app.current_user_id`. Postgres RLS policies (defined in Alembic migrations, SQL helpers in `_rls_sql.py`) filter every query to the current tenant.

**Hard rule**: endpoints using `get_tenant_session` MUST NOT call `session.commit()`. The wrapping `async with session.begin():` handles commit/rollback. Calling commit explicitly drops the GUCs and breaks RLS for subsequent queries in the same request.

**Why `bim_app` role**: the docker-compose `bim` user is a superuser. Postgres bypasses RLS for superusers even with FORCE. `SET LOCAL ROLE bim_app` drops to a non-bypass role for the duration of the transaction.

**Exception**: `jobs_internal.py` uses `get_async_session` (not `get_tenant_session`) because the processor worker has no tenant context. The superuser role bypasses RLS, which is correct — the callback must update any file row regardless of org.

### Data model and routers

**Model hierarchy**: `Organization` -> `Project` -> `Model` -> `ProjectFile`. Projects also have a `ProjectMember` join table (user + role: owner/editor/viewer). Each `Project` carries a `country` (ISO 3166-1 alpha-2, defaults to `NL`) that anchors it to a jurisdiction.

**Routers**: `health`, auth (built by `build_auth_router()`), `projects`, `models`, `project_files`, `jobs_internal`, `reports`, `compliance`, `jurisdictions`.

### Jurisdictions (NL-first, EU-ready)

`bimstitch_api/jurisdictions/` is the single source of truth for what countries the app can serve. Each jurisdiction registers a `Jurisdiction` dataclass with its frameworks (e.g. NL → `bbl`, `wkb`), default + supported locales, address-format hints. NL is registered in `jurisdictions/nl.py`; adding DE = sibling module that calls `register(...)` — no schema changes.

**Hard rule**: `Project.country` and `Job.payload["framework"]` are the only places jurisdiction/framework live. The `JobType` enum collapsed `bbl_compliance_check` and `wkb_compliance_check` into a single `compliance_check` — framework is data, not schema. Adding a third country never touches a Postgres enum.

`GET /jurisdictions` exposes the registry to the portal so the country/framework dropdowns are runtime-discoverable.

**Sibling folders**:
- `apps/arbiter/rules/nl/{bbl,wkb}/` — rule packs. New countries get sibling folders (`rules/de/...`); the loader infers `(jurisdiction, framework)` from the path.
- `apps/processor/src/pipeline/report/templates/jurisdictions/nl/labels.ts` — PDF labels for the compliance report. Template resolves labels via `LABELS_BY_JURISDICTION[country]`, NL by default.
- `apps/portal/src/features/jurisdictions/nl/` — `addressLookup.ts` (PDOK Locatieserver) and `mapThumbnail.ts` (PDOK WMS + `isWithinNetherlands`).
- `packages/map/src/nl/` — `NetherlandsMap` component + RD-aligned projection. `packages/map/src/core/types.ts` holds the country-agnostic `ProjectionConfig` interface.

**`ProjectStatus` / `ProjectPhase` enum values are language-neutral** (`design`, `permit_review`, `construction`, `handover`, `complete` for status; `design`, `tender`, `work_prep`, `shell`, `finishing`, `handover` for phase). Display strings (Dutch terms in the wizard) live in the portal's i18n catalog and the wizard step option labels — DB values stay neutral so a German project can render German labels for the same codes.

### Bilingual (NL + EN) rule

**Hard rule**: every user-visible string the portal can render in either Dutch or English MUST exist in both languages. The portal supports two locales today (`nl`, `en`, declared in `packages/i18n/src/common.ts`). Mixed Dutch-in-English or English-in-Dutch screens are bugs.

Where each kind of string lives:

- **Static UI chrome** (button labels, headings, tab names, table columns, placeholders, error messages, validation messages): add the key to **both** `apps/portal/messages/en.json` and `apps/portal/messages/nl.json` and read it with `useTranslations()`. Never hardcode a Dutch placeholder like `"bv. 4.51"` in a `.tsx` file — that's the smell that started this rule. Whenever you add a new key to one file, add it to the other in the same commit; the two files must stay structurally identical.
- **Jurisdiction-stored labels** (anything on `Jurisdiction`, `RiskTemplate`, `BorgingsmomentTemplate`, `ChecklistItemTemplate` in `apps/api/src/bimstitch_api/jurisdictions/`): every label is a `LocaleMap = dict[str, str]` (locale → label). Provide **both** `"nl"` and `"en"` entries. The `/jurisdictions?locale=` endpoint flattens these via `pick_label()` / `localize_map()`; the portal passes its current `useLocale()` to the query so EN and NL cached separately. Adding a new label field to a Jurisdiction means also bumping the response model in `routers/jurisdictions.py` and threading it through `useWizardOptions.ts` / consumers if it drives UI.
- **DB rows seeded from jurisdiction templates** (`borgingsmomenten.name`, `checklist_items.description`, etc., populated by `_build_plan_from_templates`): pick the locale at seed time from the project's jurisdiction `default_locale`. These rows are single-language by design — regeneration is the way to switch a plan's content language. Don't add bilingual columns to these tables.
- **User-entered content** (custom risks, custom moments, project name/description, notes): single-language. Whatever the user typed.

When you add a new label, template field, or jurisdiction entry: write the `nl` and `en` values in the same edit, never as a follow-up TODO. Same goes for adding any new `t('...')` key in the portal — the en.json and nl.json edits ship together.

**Rate limiting**: Redis-backed via `fastapi-limiter`. Defaults in `config.py`: login 5/min, register 3/hour, refresh 10/min, forgot-password 3/hour.

### Storage

`storage/minio.py` defines a `StorageBackend` Protocol. `S3Storage` is the production implementation (aioboto3, works with MinIO in dev and any S3-compatible service in prod). Tests use a `FakeStorage` via FastAPI dependency override — no real S3 calls in the test suite. `ensure_bucket` runs at app startup in the lifespan handler.

**File upload flow** (two-phase):
1. `POST .../files/initiate` — validates extension/size, creates a `pending` ProjectFile row, returns a presigned PUT URL.
2. Client PUTs bytes directly to MinIO using the presigned URL.
3. `POST .../files/{file_id}/complete` — HEAD-checks the object in MinIO, reads first 2 KB to parse the IFC STEP header (`ifc/header.py`), flips status to `ready` or `rejected`, dispatches extraction to the processor worker.

### Job dispatch flow

Cross-service flow spanning API and the `processor` worker. Same shape for every job type (IFC extraction, PDF extraction, compliance check, compliance-report PDF generation):

1. API creates a `Job` row with `job_type` + `payload` (JSONB), then calls `dispatch_job(job, settings)` which POSTs `{job_id, job_type, payload}` to `{PROCESSOR_URL}/jobs` with shared-secret bearer auth.
2. Worker enqueues a BullMQ job on Redis queue `jobs` (single queue, dispatched by `job_type`).
3. BullMQ worker picks up the job: callbacks `running` status to API, runs the type-specific pipeline (IFC → web-ifc + fragments; PDF metadata → pdfjs-dist; compliance check → MCP arbiter; compliance report → puppeteer + HTML template), uploads artifacts to MinIO.
4. Worker callbacks `succeeded` (with type-specific result keys) or `failed` (with error) to API at `/internal/jobs/callback`.
5. API's `jobs_internal.py` receives the callback and updates the relevant row (ProjectFile for extraction, Report for compliance) plus the Job. Terminal states are idempotent.

**JobType is jurisdiction-blind**: `compliance_check` is the single value for all building-code checks; the regulation framework (`bbl`, `wkb`, future `geg`/`mbo`) lives in `payload.framework`. Lookups by framework use `Job.payload["framework"].astext == "bbl"` rather than a `job_type` filter — see `routers/compliance.py::_load_latest_compliance_job`.

Tests stub the dispatcher via `set_job_dispatcher()` in `jobs/dispatcher.py`. The autouse `_stub_job_dispatcher` fixture in `tests/conftest.py` records every dispatch as `{job_id, job_type, payload}`; tests pull the `job_dispatch_calls` (or alias `extraction_calls`) fixture to assert on the calls.

## Architecture — Portal (`apps/portal`)

Next.js 15 with App Router, React 19, Tailwind CSS, port 3001.

**Route groups**: `(dashboard)` for project CRUD with sidebar layout, `(viewer)` for immersive 3D viewer. Both enforce auth — redirect to `/login` if no tokens.

**Data fetching**: TanStack React Query v5. Query key factories in `features/projects/queryKeys.ts` — all keys derive from `['projects', ...]`. Mutations invalidate via these keys.

**API client**: `lib/api/client.ts` — typed fetch wrapper. Every response is validated through a Zod schema. Throws `ApiError` on non-2xx. `putRaw` for presigned URL uploads omits the auth header (it would break the S3 signature).

**Auth**: `providers/AuthProvider.tsx` stores tokens in `localStorage` under `bimstitch.tokens`. `useAuth()` returns `{ tokens, setTokens, hasHydrated }`. Hydration is deferred to avoid SSR/client mismatch.

**Forms**: React Hook Form + `@hookform/resolvers/zod`. Schemas in `projectFormSchema.ts`, `modelFormSchema.ts`.

**Environment**: Single var `NEXT_PUBLIC_API_URL` (defaults to `http://localhost:8000`), validated by Zod at import time (`lib/env.ts`).

## Architecture — Viewer (`packages/viewer`)

Plugin-based IFC viewer wrapping ThatOpen + Three.js. The abstraction keeps the underlying library swappable — consumers import `<IfcViewer />` and nothing else from ThatOpen.

**Plugin interface**: `Plugin` has `name`, optional `dependencies`, `install(ctx: ViewerContext)`, optional `uninstall()`. `PluginManager` resolves dependency DAG and cleans up commands on uninstall.

**Built-in plugins**: camera, selection, hover-highlight, keyboard-shortcuts, mouse-bindings, viewcube, effects, pivot-rotate. Each in its own subdirectory under `src/plugins/`.

**Core systems**: `EventBus<ViewerEvents>` for typed pub/sub, `CommandRegistry` for named action dispatch.

**Integration**: `IfcViewer` React component (`src/IfcViewer.tsx`) exposes a `ViewerHandle` ref for imperative control (commands, events, plugin registration). Must be dynamically imported with `ssr: false` in Next.js due to WASM dependency. WASM files served from `public/web-ifc/`, fragments worker from `public/fragments/worker.mjs` — both auto-copied by `scripts/copy-wasm.mjs` (runs as `predev`/`prebuild` hook in portal).

## TypeScript conventions (web + packages)

Shared base: `packages/tsconfig/base.json` — `module: NodeNext`, `strict`, `noUncheckedIndexedAccess`, `isolatedModules`, `declaration`.

- Relative imports in `.ts` sources need `.js` extensions because of `NodeNext`.
- Packages publish via the `exports` field pointing at `./dist/index.js`; keep `src/index.ts` as the single public barrel.
- `noUncheckedIndexedAccess` is on — array/record access returns `T | undefined`.

**Task graph caveat**: `turbo.json` declares `build`, `lint`, `type-check`, `test` with `dependsOn: ["^build"]`. Consumers see package changes only after `dist/` is rebuilt — run `pnpm --filter=<pkg> dev` in watch mode while iterating.

## TDD rule

Every new auth/API endpoint lands with a failing test first. The test files in `apps/api/tests/` are the spec; extend them (or add new ones) before implementing. `uv run pytest` must stay green on every commit (currently 253 tests).

## Environment variables

Declared in `turbo.json` `globalEnv` (Node-side cache keys): `NODE_ENV`, `OPENAI_API_KEY`, `DATABASE_URL`.

Python API reads from `apps/api/.env.example` (see that file for the complete list with defaults). Key categories:

- **DB**: `DATABASE_URL`, `TEST_DATABASE_URL`
- **JWT**: `JWT_SECRET`, `JWT_ACCESS_TTL_SECONDS`, `JWT_REFRESH_TTL_SECONDS`
- **Email**: `SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM`, `FRONTEND_VERIFY_URL`, `FRONTEND_RESET_PASSWORD_URL`
- **CORS**: `CORS_ORIGINS`, `CORS_ORIGIN_REGEX`
- **Redis**: `REDIS_URL`, `TEST_REDIS_URL`
- **Rate limits**: `RATE_LIMIT_LOGIN_PER_MIN`, `RATE_LIMIT_REGISTER_PER_HOUR`, `RATE_LIMIT_REFRESH_PER_MIN`, `RATE_LIMIT_FORGOT_PER_HOUR`
- **S3/MinIO**: `S3_ENDPOINT_URL`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_BUCKET_IFC`, `S3_PRESIGN_TTL_SECONDS`, `UPLOAD_MAX_BYTES`
- **Processor worker**: `PROCESSOR_URL`, `PROCESSOR_SHARED_SECRET`, `PROCESSOR_DISPATCH_TIMEOUT_SECONDS`

Portal reads: `NEXT_PUBLIC_API_URL` (defaults to `http://localhost:8000`).

## Docker services

### Dev stack — `docker-compose.yml` (repo root)

The API itself runs on the host (`uv run uvicorn ...`), not in Docker.

- `postgres` — Postgres 16, host port **5434**. User `bim`, password `bim`, database `bimstitch`.
- `mailhog` — SMTP on 1025, web UI at http://localhost:8025.
- `redis` — Redis 7, host port **6380**. Used for rate limiting, JWT blocklist, and BullMQ job queue.
- `minio` — S3-compatible storage, API on port **9000**, console at **9001**. Root credentials: `bimstitch` / `bimstitch-secret`.
- `processor` — built from `apps/processor/Dockerfile`, host port **8088**. Reaches API via `host.docker.internal:8000`. Auth: `PROCESSOR_SHARED_SECRET`. Generic Node.js worker for all background jobs (IFC extraction, PDF extraction, PDF report generation).

### Test stack — `docker-compose.test.yml` (repo root)

Ephemeral, no volumes. Used by `pnpm --filter=portal test:e2e:full`. Project name `bimstitch-test` prevents container collisions with dev.

- `postgres` — port **5435**, container `bimstitch-test-postgres`
- `redis` — port **6381**, container `bimstitch-test-redis`
- `mailhog` — SMTP **1026**, HTTP **8026**, container `bimstitch-test-mailhog`
- `minio` — API **9002**, console **9003**, container `bimstitch-test-minio`

Lifecycle: `docker compose -f docker-compose.test.yml up -d --wait` / `down -v`. The `run-e2e.mjs` script manages this automatically.
