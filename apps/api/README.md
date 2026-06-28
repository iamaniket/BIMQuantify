# BimDossier API

FastAPI backend for BimDossier. Auth (signup + email verification + JWT login + refresh) is the current scope; IFC/BCF/takeoff endpoints come next.

## Prerequisites

- Python 3.12
- [uv](https://docs.astral.sh/uv/) (`pipx install uv` or `pip install uv`)
- Docker (for Postgres + MailHog)

## Setup

```bash
# From repo root
docker compose up -d postgres mailhog

# In apps/api
cp .env.example .env
uv sync
uv run alembic upgrade head
```

## Run

```bash
uv run uvicorn bimdossier_api.main:app --reload --port 8000
```

Open http://localhost:8000/docs for Swagger UI.

## Tests (TDD)

```bash
uv run pytest                        # all
uv run pytest tests/test_signup.py   # one file
uv run pytest -k "login and unverified"
```

## Quality

```bash
uv run ruff check .
uv run ruff format .
uv run mypy src
```

## Migrations

Two Alembic chains: a **master** chain (the shared `public` schema — `users`,
`organizations`, …) and a **tenant** chain (replicated into every `org_<hex>`
schema).

```bash
uv run alembic revision --autogenerate -m "message"
uv run alembic upgrade head
uv run alembic downgrade -1
```

### Release gate — master upgrade → `migrate_all` (do not skip)

A deploy that ships a **tenant** migration MUST run the fan-out, or pre-existing
orgs are left missing the new column/table/enum and 500 on the new code path
(only newly-provisioned orgs get the change in-process):

```bash
# 1. master / public chain
uv run alembic -c alembic.master.ini upgrade head
# 2. fan the tenant chain out across every active org schema
uv run python -m bimdossier_api.scripts.migrate_all
# verify — exits non-zero if any schema is behind the tenant head
uv run python -m bimdossier_api.scripts.migrate_all --check
```

The API logs a loud `TENANT SCHEMAS BEHIND` warning at startup
(`check_tenant_schema_drift`) if any active org schema is behind the tenant
head — a backstop, not a substitute for step 2.
