"""Create (or reset) the E2E test database.

Drops and recreates `bimstitch_e2e`, runs alembic master migrations, then
seeds test data.  Called from Playwright's global-setup before starting the
API server.

Usage:
    cd apps/api
    uv run python scripts/setup_e2e_db.py
"""

from __future__ import annotations

import asyncio
import os
import subprocess
import sys
from urllib.parse import urlparse, urlunparse

import asyncpg

E2E_DB_NAME = "bimstitch_e2e"


def _base_url() -> str:
    return os.environ.get(
        "DATABASE_URL",
        "postgresql+asyncpg://bim:bim@localhost:5434/bimstitch",
    )


def _maintenance_dsn() -> str:
    parsed = urlparse(_base_url().replace("+asyncpg", ""))
    return urlunparse(parsed._replace(path="/postgres"))


def _e2e_sqlalchemy_url() -> str:
    parsed = urlparse(_base_url())
    return urlunparse(parsed._replace(path=f"/{E2E_DB_NAME}"))


async def _create_database() -> None:
    dsn = _maintenance_dsn()
    parsed = urlparse(dsn)
    host = parsed.hostname or "localhost"
    port = parsed.port or 5432
    try:
        conn = await asyncpg.connect(dsn)
    except ConnectionRefusedError:
        print(
            f"\n  ERROR: Cannot connect to PostgreSQL at {host}:{port}.\n"
            f"  Is the database running? Try:\n\n"
            f"    docker compose up -d postgres\n",
            file=sys.stderr,
        )
        sys.exit(1)
    except asyncpg.InvalidPasswordError:
        print(
            f"\n  ERROR: Authentication failed for PostgreSQL at {host}:{port}.\n"
            f"  Check DATABASE_URL credentials.\n",
            file=sys.stderr,
        )
        sys.exit(1)
    except OSError as exc:
        print(
            f"\n  ERROR: Could not reach PostgreSQL at {host}:{port}: {exc}\n"
            f"  Ensure the database container is running:\n\n"
            f"    docker compose up -d postgres\n",
            file=sys.stderr,
        )
        sys.exit(1)
    try:
        await conn.execute(
            "SELECT pg_terminate_backend(pid) "
            "FROM pg_stat_activity "
            f"WHERE datname = '{E2E_DB_NAME}' AND pid <> pg_backend_pid()"
        )
        await conn.execute(f'DROP DATABASE IF EXISTS "{E2E_DB_NAME}"')
        await conn.execute(f'CREATE DATABASE "{E2E_DB_NAME}"')

        role_exists = await conn.fetchval(
            "SELECT 1 FROM pg_roles WHERE rolname = 'bim_app'"
        )
        if not role_exists:
            await conn.execute("CREATE ROLE bim_app NOLOGIN")

        print(f"  Created database '{E2E_DB_NAME}'")
    finally:
        await conn.close()


def _run_migrations() -> None:
    e2e_url = _e2e_sqlalchemy_url()
    env = {**os.environ, "DATABASE_URL": e2e_url}

    print("  Running alembic master migrations...")
    result = subprocess.run(
        [sys.executable, "-m", "alembic", "-c", "alembic.master.ini", "upgrade", "head"],
        env=env,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        print(f"Migration failed:\n{result.stderr}", file=sys.stderr)
        sys.exit(1)
    print("  Migrations applied.")


def _run_seed() -> None:
    e2e_url = _e2e_sqlalchemy_url()
    env = {**os.environ, "DATABASE_URL": e2e_url}

    print("  Seeding E2E database...")
    result = subprocess.run(
        [sys.executable, "-m", "bimstitch_api.seed"],
        env=env,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        print(f"Seed failed:\n{result.stderr}", file=sys.stderr)
        sys.exit(1)
    if result.stdout:
        for line in result.stdout.strip().splitlines():
            print(f"    {line}")
    print("  Seed complete.")


async def main() -> None:
    print(f"Setting up E2E database '{E2E_DB_NAME}'...")
    await _create_database()
    _run_migrations()
    _run_seed()
    print(f"E2E database '{E2E_DB_NAME}' is ready.\n")


if __name__ == "__main__":
    asyncio.run(main())
