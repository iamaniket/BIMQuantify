# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository shape

Polyglot monorepo:
- **Node/TypeScript workspaces** (`apps/web`, `packages/*`) coordinated by pnpm + Turborepo.
- **Python FastAPI backend** in `apps/api/` (managed by `uv`, not pnpm; deliberately excluded from Turborepo).

`apps/api` is a Python package, not a pnpm workspace. `pnpm-workspace.yaml` matches `apps/*` but the api has no `package.json`, so pnpm silently ignores it.

## Commands

### Node side (web + packages)

Requires Node ≥20 and pnpm ≥9 (`engines` in `package.json`). Package manager pinned to `pnpm@10.33.2`.

- `pnpm install` — bootstrap the workspace.
- `pnpm --filter=web dev` — web only (Next.js, port 3000).
- `pnpm --filter=@bim-quantify/<pkg> build` — build a single package. Apps use bare names (`web`); internal packages use the `@bim-quantify/*` scope.
- `pnpm build` / `pnpm lint` / `pnpm type-check` / `pnpm test` — turbo-coordinated across the TS graph.

### Python side (API)

All commands run from `apps/api/`. Requires Python 3.12 and `uv`.

```bash
# one-time
docker compose up -d postgres mailhog   # from repo root; Postgres on :5434, MailHog UI on :8025
cp .env.example .env
uv sync
uv run alembic upgrade head
uv run python -m bimquantify_api.seed   # creates 3 default dev users (superadmin / admin / user)

# dev server
uv run uvicorn bimquantify_api.main:app --reload --port 8000

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

**Test database**: `tests/conftest.py` points at `bimquantify_test` on `localhost:5434` (or `TEST_DATABASE_URL`). Create it once with `docker exec bimquantify-postgres psql -U bim -d postgres -c "CREATE DATABASE bimquantify_test;"`. The conftest does `create_all`/`drop_all` per session and truncates tables between tests — no migrations in the test loop.

## Architecture — Python API

**Package**: `src/bimquantify_api/` (src layout). Entry point: `bimquantify_api.main:app`.

**Auth stack**: FastAPI Users handles registration, verification, password reset, and the `/users/*` router. Two pieces are custom:

1. `auth/routes.py::login` overrides `/auth/jwt/login` to return **both** access + refresh tokens (FastAPI Users' built-in login only returns access). Uses `OAuth2PasswordRequestForm`, gates on `is_verified`, responds with `TokenPair`.
2. `auth/refresh.py` exposes `POST /auth/jwt/refresh` — decodes the refresh JWT, verifies `typ=refresh`, issues a fresh access token.

**Token separation** (`auth/tokens.py`): access and refresh tokens share the same secret/algorithm but use **different audiences** (`"fastapi-users:auth"` vs `"bimquantify:refresh"`). FastAPI Users' default `JWTStrategy` is pinned to the access audience, so presenting a refresh token at `/users/me` yields 401 — this is the only thing stopping refresh tokens from being accepted as access. Both tokens also carry a `typ` claim, which `decode_token` checks defensively.

**Signup → org link flow**:
1. `POST /auth/register` receives `email, password, full_name, organization_name`.
2. Custom route in `auth/routes.py` stores `organization_name` on `request.state` before calling `user_manager.create`.
3. `UserCreate.create_update_dict` strips `organization_name` so it never reaches the `User` SQLAlchemy model.
4. `UserManager.on_after_register` pops `organization_name` off `request.state`, upserts the `Organization` (race-safe via `IntegrityError` + reselect), writes `organization_id` onto both the DB row and the in-memory instance so the response reflects it.
5. `request_verify` fires — `on_after_request_verify` emails the token via `email.transport.get_email_transport()`.

**Email transport** is a small `Protocol` with two implementations in `email/transport.py`: `SMTPEmailTransport` (MailHog in dev, real SMTP in prod) and `InMemoryEmailTransport` (tests). The `email_transport` pytest fixture swaps in the in-memory one and exposes `last_for(email)` so tests read the verification token out of the email body directly.

**DB session lifecycle**: `db.py` lazily builds a single `AsyncEngine` + `async_sessionmaker`. `get_async_session` is the FastAPI dependency; `get_session_maker()` is used by code outside a request (e.g. `UserManager._link_to_organization`). Tests monkey-patch `db._engine` / `db._session_maker` before `create_app()` so the app uses the test DB.

## TypeScript conventions (web + packages)

Shared base: `packages/tsconfig/base.json` — `module: NodeNext`, `strict`, `noUncheckedIndexedAccess`, `isolatedModules`, `declaration`.

- Relative imports in `.ts` sources need `.js` extensions because of `NodeNext`.
- Packages publish via the `exports` field pointing at `./dist/index.js`; keep `src/index.ts` as the single public barrel.
- `noUncheckedIndexedAccess` is on — array/record access returns `T | undefined`.

**Task graph caveat**: `turbo.json` declares `build`, `lint`, `type-check`, `test` with `dependsOn: ["^build"]`. Consumers see package changes only after `dist/` is rebuilt — run `pnpm --filter=<pkg> dev` in watch mode while iterating.

## TDD rule

Every new auth/API endpoint lands with a failing test first. The seven test files in `apps/api/tests/` are the spec; extend them (or add new ones) before implementing. `uv run pytest` must stay green on every commit.

## Environment variables

Declared in `turbo.json` `globalEnv` (Node-side cache keys): `NODE_ENV`, `OPENAI_API_KEY`, `DATABASE_URL`.

Python API reads (see `apps/api/.env.example`): `DATABASE_URL`, `TEST_DATABASE_URL`, `JWT_SECRET`, `JWT_ACCESS_TTL_SECONDS`, `JWT_REFRESH_TTL_SECONDS`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM`, `FRONTEND_VERIFY_URL`, `FRONTEND_RESET_PASSWORD_URL`, `CORS_ORIGINS`.

## Docker services

`docker-compose.yml` at repo root:
- `postgres` — Postgres 16, host port **5434** (5432 is often taken by other projects on this machine).
- `mailhog` — SMTP on 1025, web UI at http://localhost:8025.

## Out of scope (for now)

The old Fastify API's IFC/BCF/takeoff routes have not been ported yet — `packages/ifc-parser`, `packages/bcf-parser`, and `packages/ai-takeoff` still exist but nothing consumes them server-side. The current `apps/api` is auth-only. Porting the parsers is the next iteration.
