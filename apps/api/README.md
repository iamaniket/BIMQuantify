# BIMQuantify API

FastAPI backend for BIMQuantify. Auth (signup + email verification + JWT login + refresh) is the current scope; IFC/BCF/takeoff endpoints come next.

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
uv run uvicorn bimquantify_api.main:app --reload --port 8000
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

```bash
uv run alembic revision --autogenerate -m "message"
uv run alembic upgrade head
uv run alembic downgrade -1
```
