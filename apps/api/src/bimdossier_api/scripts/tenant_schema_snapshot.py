"""Tenant-schema drift guard (M-db2).

The tenant Alembic baseline (``0001_initial_tenant.py``) runs
``Base.metadata.create_all`` over the *live* models, so a new model column lands
automatically in freshly-provisioned org schemas AND in the test database
(``conftest`` also uses ``create_all``) — but it reaches EXISTING org schemas only
through a hand-written delta migration fanned out by ``scripts.migrate_all``.
Forget the delta and pre-existing orgs 500 on the missing column, with green CI
the whole way, because nothing compares the models to the migrations.

This module closes that gap. It computes a deterministic fingerprint of the
tenant model schema (every tenant table → columns / indexes / constraints) plus
the current tenant Alembic head, and stores both in a checked-in snapshot
(``tenant_schema_snapshot.json``). Two checks ride on top:

* ``tests/test_tenant_schema_snapshot.py`` fails when the live fingerprint
  diverges from the snapshot — i.e. the tenant model schema changed but the
  snapshot wasn't regenerated.
* ``--write`` REFUSES to regenerate the snapshot when the fingerprint changed
  while the tenant head did NOT advance. So the only green path after a model
  change is: write the delta migration (head advances) → regenerate the snapshot.
  Regenerating alone can't satisfy the guard.

Pure metadata + filesystem — no database connection, so it runs in CI without a
live Postgres.

Usage:
    uv run python -m bimdossier_api.scripts.tenant_schema_snapshot --write
    uv run python -m bimdossier_api.scripts.tenant_schema_snapshot --check
"""

from __future__ import annotations

import argparse
import json
import pathlib
import sys
from typing import TYPE_CHECKING, Any

from sqlalchemy import CheckConstraint, UniqueConstraint
from sqlalchemy.dialects import postgresql

# Importing the models package registers every tenant table on Base.metadata.
import bimdossier_api.models  # noqa: F401
from bimdossier_api.db import Base, is_tenant_table
from bimdossier_api.migrations_check import tenant_heads

if TYPE_CHECKING:
    from sqlalchemy import Column, Index, Table

API_DIR = pathlib.Path(__file__).resolve().parents[3]
SNAPSHOT_PATH = API_DIR / "tenant_schema_snapshot.json"

_PG_DIALECT = postgresql.dialect()  # type: ignore[no-untyped-call]


def _column_type(column: Column[Any]) -> str:
    """Concrete Postgres DDL type ("VARCHAR(255)", "UUID", enum name, …) so the
    fingerprint matches what actually reaches the database."""
    try:
        return str(column.type.compile(dialect=_PG_DIALECT))
    except Exception:
        return str(column.type)


def _column_fingerprint(column: Column[Any]) -> str:
    parts = [_column_type(column), "NULL" if column.nullable else "NOT NULL"]
    if column.primary_key:
        parts.append("PK")
    if column.server_default is not None:
        parts.append("has_server_default")
    parts.extend(
        sorted(
            f"FK={fk.target_fullname}#{(fk.ondelete or 'NO ACTION').upper()}"
            for fk in column.foreign_keys
        )
    )
    return "|".join(parts)


def _index_fingerprint(index: Index) -> str:
    cols = [getattr(expr, "name", None) or str(expr) for expr in index.expressions]
    where_clause = index.dialect_kwargs.get("postgresql_where")
    where = str(where_clause) if where_clause is not None else ""
    return f"unique={bool(index.unique)}|cols={','.join(cols)}|where={where}"


def _table_fingerprint(table: Table) -> dict[str, Any]:
    columns = {c.name: _column_fingerprint(c) for c in table.columns}
    indexes = {ix.name or "": _index_fingerprint(ix) for ix in table.indexes}
    uniques = sorted(
        f"{c.name}|cols={','.join(col.name for col in c.columns)}"
        for c in table.constraints
        if isinstance(c, UniqueConstraint)
    )
    checks = sorted(
        f"{c.name}|{c.sqltext}" for c in table.constraints if isinstance(c, CheckConstraint)
    )
    return {
        "columns": dict(sorted(columns.items())),
        "indexes": dict(sorted(indexes.items())),
        "unique_constraints": uniques,
        "check_constraints": checks,
    }


def compute_fingerprint() -> dict[str, Any]:
    """Deterministic fingerprint of every tenant table in the live model metadata."""
    tables = {
        t.name: _table_fingerprint(t) for t in Base.metadata.tables.values() if is_tenant_table(t)
    }
    return dict(sorted(tables.items()))


def current_tenant_head() -> str:
    """The tenant Alembic head(s), joined (linear chain → one element)."""
    return ",".join(sorted(tenant_heads()))


def build_snapshot() -> dict[str, Any]:
    return {"tenant_head": current_tenant_head(), "tables": compute_fingerprint()}


def load_snapshot() -> dict[str, Any] | None:
    if not SNAPSHOT_PATH.exists():
        return None
    data: dict[str, Any] = json.loads(SNAPSHOT_PATH.read_text(encoding="utf-8"))
    return data


def _write() -> int:
    new = build_snapshot()
    old = load_snapshot()
    if (
        old is not None
        and old.get("tables") != new["tables"]
        and old.get("tenant_head") == new["tenant_head"]
    ):
        print(
            "REFUSING to regenerate the tenant schema snapshot: the model schema "
            f"changed but the tenant Alembic head did not advance (still "
            f"{new['tenant_head']!r}).\n"
            "Existing org schemas receive model changes ONLY through a tenant delta "
            "migration. Write one first:\n"
            "  cd apps/api && uv run alembic -c alembic.tenant.ini revision -m '<change>'\n"
            "then re-run --write and run migrate_all on deploy.",
            file=sys.stderr,
        )
        return 1
    SNAPSHOT_PATH.write_text(json.dumps(new, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(
        f"Wrote {SNAPSHOT_PATH.name} "
        f"(tenant_head={new['tenant_head']}, tables={len(new['tables'])})."
    )
    return 0


def _check() -> int:
    snap = load_snapshot()
    if snap is None:
        print(
            f"No snapshot at {SNAPSHOT_PATH}. Run --write to create it.",
            file=sys.stderr,
        )
        return 1
    current = build_snapshot()
    drift = snap.get("tables") != current["tables"]
    head_drift = snap.get("tenant_head") != current["tenant_head"]
    if not drift and not head_drift:
        print("Tenant schema snapshot is up to date.")
        return 0
    if drift:
        print(
            "Tenant model schema drifted from the snapshot — a column/index/table "
            "changed without regenerating tenant_schema_snapshot.json (M-db2).",
            file=sys.stderr,
        )
    if head_drift:
        print(
            f"Tenant head changed: snapshot={snap.get('tenant_head')!r} "
            f"current={current['tenant_head']!r}.",
            file=sys.stderr,
        )
    return 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Tenant schema drift guard (M-db2).")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--write", action="store_true", help="Regenerate the checked-in snapshot.")
    group.add_argument("--check", action="store_true", help="Exit 1 on drift (no writes).")
    args = parser.parse_args(argv)
    return _write() if args.write else _check()


if __name__ == "__main__":
    sys.exit(main())
