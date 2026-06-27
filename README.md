# BimDossier

> BIM compliance & dossier platform for the Dutch building sector (Wkb / Bbl), EU-ready — IFC, PDF drawings, and BCF in one place.

[![Turborepo](https://img.shields.io/badge/turborepo-enabled-blue)](https://turbo.build)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)](https://www.typescriptlang.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Overview

BimDossier ingests **IFC** 3D models, **PDF** drawings, and **BCF** issues, runs them through a
jurisdiction-aware compliance engine (NL-first: **Bbl** building code + **Wkb** quality
assurance), and produces compliance reports and a structured project dossier. It ships a
web dashboard, an immersive 2D/3D viewer, and a native mobile snagging app.

Architecture is **schema-per-tenant**: each organization gets its own Postgres schema, so
tenant data is physically isolated rather than filtered by an `organization_id` column.

> **Working on the code?** The authoritative architecture guide is [`CLAUDE.md`](CLAUDE.md) —
> it covers the auth stack, multi-tenancy rules, job dispatch, the viewer plugin system,
> bilingual (NL/EN) i18n rules, and hard-won operational gotchas in depth.

---

## Monorepo structure

A polyglot monorepo coordinated by **pnpm + Turborepo** (Node/TS) with a Python backend
managed by **uv**.

```
BimDossier/
├── apps/
│   ├── portal/        # Next.js 16 — main app: project CRUD + 2D/3D viewer (port 3001)
│   ├── web/           # Next.js 16 — marketing / public site (port 3000)
│   ├── api/           # Python 3.12 FastAPI backend, managed by uv (port 8000)
│   ├── processor/     # Node Fastify + BullMQ worker — IFC/PDF extraction & PDF reports
│   ├── arbiter/       # Python compliance rules engine (rule packs: nl/bbl, nl/wkb)
│   ├── mobile/        # React Native / Expo snagging app
│   └── viewer-embed/  # Viewer bundled for the mobile WebView
├── packages/
│   ├── viewer/        # Plugin-based IFC viewer (ThatOpen + Three.js)
│   ├── ui/            # Shared React component library + design-token Tailwind classes
│   ├── i18n/          # Shared NL/EN message catalogs & helpers
│   ├── contracts/     # Cross-package "magic value" contracts (hand-written CJS)
│   ├── map/           # Country-aware map components (NL RD projection)
│   ├── brand/         # Brand assets & components
│   ├── design-tokens/ # CSS-variable design tokens
│   ├── tailwind-config/
│   └── tsconfig/      # Shared TypeScript presets
├── docker-compose.yml         # dev services (postgres, mailhog, redis, minio, processor)
├── docker-compose.test.yml    # ephemeral E2E test stack
├── turbo.json
├── pnpm-workspace.yaml
└── package.json
```

---

## Getting started

### Prerequisites

- **Node.js** ≥ 20 and **pnpm** ≥ 9 (package manager pinned to `pnpm@10.33.2`)
- **Python** 3.12 and [**uv**](https://docs.astral.sh/uv/) (for `apps/api` and `apps/arbiter`)
- **Docker** (for postgres, redis, minio, mailhog, and the processor worker)

### 1. Install & start services

```bash
pnpm install
docker compose up -d            # postgres, mailhog, redis, minio, processor
```

### 2. Python API (`apps/api`)

```bash
cd apps/api
cp .env.example .env
uv sync
uv run alembic -c alembic.master.ini upgrade head   # master chain → public schema
uv run python -m bimdossier_api.seed                 # platform + demo orgs & users
uv run uvicorn bimdossier_api.main:app --reload --port 8000
```

### 3. Frontends

```bash
pnpm --filter=portal dev        # main app  → http://localhost:3001
pnpm --filter=web dev           # marketing → http://localhost:3000
```

### 4. Processor worker

```bash
docker compose up -d processor          # preferred (host port 8088)
# or run standalone (needs redis + minio):
cd apps/processor && npm run dev        # Fastify + BullMQ on port 8080
```

### 5. Mobile app (optional)

```bash
cd apps/mobile && pnpm start            # Expo
```

---

## Testing

```bash
# Python API (TDD — run constantly)
cd apps/api && uv run pytest

# Node/TS workspaces (turbo-coordinated)
pnpm test

# Processor worker (Vitest)
cd apps/processor && npm test

# End-to-end (Playwright, fully isolated test containers)
pnpm --filter=portal test:e2e:full
```

## Quality gates

```bash
# Node side
pnpm lint            # i18n parity + brand/font-size checks + turbo lint
pnpm type-check

# Python side (from apps/api)
uv run ruff check .
uv run ruff format .
uv run mypy src
```

---

## Dev services (`docker-compose.yml`)

The API itself runs on the host (`uv run uvicorn ...`); everything else is containerized.

| Service    | Purpose                                   | Host port(s)        |
|------------|-------------------------------------------|---------------------|
| postgres   | Postgres 16 (`bim` / `bim` / `bimdossier`) | 5434                |
| redis      | rate limiting, JWT blocklist, BullMQ queue | 6380                |
| minio      | S3-compatible object storage              | 9000 (API), 9001 (console) |
| mailhog    | dev SMTP + web inbox                       | 1025 (SMTP), 8025 (UI) |
| processor  | background job worker                      | 8088                |

---

## Environment variables

- **Python API** reads from `apps/api/.env` (template: `apps/api/.env.example`) — DB, JWT,
  email/SMTP, CORS, Redis, rate limits, S3/MinIO, and processor-dispatch settings.
- **Portal / web** read `NEXT_PUBLIC_API_URL` (defaults to `http://localhost:8000`).

See `apps/api/.env.example` and `apps/portal/.env.example` for the complete lists.

---

## License

MIT © iamaniket
