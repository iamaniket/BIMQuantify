"""M-db2 — tenant-schema drift guard.

The tenant Alembic baseline is ``Base.metadata.create_all`` over the live models
(``0001_initial_tenant.py``), so a new model column lands in new org schemas and
the test DB automatically but reaches EXISTING orgs only via a hand-written delta
migration. These tests are the CI tripwire: they fail when the tenant model
schema drifts from the checked-in snapshot, forcing a conscious "did I write the
migration?" checkpoint. Pure metadata — no database.
"""

from __future__ import annotations

import json

from bimdossier_api.scripts import tenant_schema_snapshot as snap


def test_snapshot_matches_live_models() -> None:
    stored = snap.load_snapshot()
    assert stored is not None, (
        "tenant_schema_snapshot.json is missing. Generate it with: "
        "uv run python -m bimdossier_api.scripts.tenant_schema_snapshot --write"
    )
    current = snap.compute_fingerprint()
    assert stored["tables"] == current, (
        "Tenant model schema drifted from tenant_schema_snapshot.json (M-db2).\n"
        "Because the tenant baseline is create_all over the live models, a "
        "new/changed table/column/index is INVISIBLE to existing org schemas "
        "unless a tenant delta migration is written and fanned out by migrate_all "
        "— yet new orgs and this test DB (also create_all) pass without it. "
        "Resolve:\n"
        "  1. cd apps/api && uv run alembic -c alembic.tenant.ini revision -m '<change>'\n"
        "  2. uv run python -m bimdossier_api.scripts.tenant_schema_snapshot --write\n"
        "  3. On deploy: uv run python -m bimdossier_api.scripts.migrate_all"
    )


def test_snapshot_records_current_tenant_head() -> None:
    stored = snap.load_snapshot()
    assert stored is not None
    assert stored["tenant_head"] == snap.current_tenant_head(), (
        "tenant_schema_snapshot.json records a stale tenant Alembic head. After "
        "adding a tenant migration, regenerate the snapshot: "
        "uv run python -m bimdossier_api.scripts.tenant_schema_snapshot --write"
    )


def test_write_refuses_when_model_changed_but_head_unchanged(monkeypatch, tmp_path) -> None:
    """The airtight half of the guard: you cannot satisfy it by regenerating the
    snapshot alone — if the fingerprint changed while the tenant head did not
    advance, --write refuses (forcing a delta migration first)."""
    fake_path = tmp_path / "snap.json"
    # Stored fingerprint differs from the live one, but the head matches.
    stale = {"tenant_head": snap.current_tenant_head(), "tables": {"projects": {"columns": {}}}}
    fake_path.write_text(json.dumps(stale), encoding="utf-8")
    monkeypatch.setattr(snap, "SNAPSHOT_PATH", fake_path)

    assert snap._write() == 1
    # The on-disk snapshot is left untouched (not silently overwritten).
    assert json.loads(fake_path.read_text(encoding="utf-8")) == stale


def test_write_proceeds_when_head_advanced(monkeypatch, tmp_path) -> None:
    """When a new migration advanced the head, --write regenerates the snapshot."""
    fake_path = tmp_path / "snap.json"
    stale = {"tenant_head": "0000_ancient", "tables": {"projects": {"columns": {}}}}
    fake_path.write_text(json.dumps(stale), encoding="utf-8")
    monkeypatch.setattr(snap, "SNAPSHOT_PATH", fake_path)

    assert snap._write() == 0
    written = json.loads(fake_path.read_text(encoding="utf-8"))
    assert written["tenant_head"] == snap.current_tenant_head()
    assert "projects" in written["tables"]


def test_check_passes_against_committed_snapshot() -> None:
    """The real checked-in snapshot must be in sync (else CI is already red)."""
    assert snap._check() == 0
