"""Unit tests for the migrate_all fan-out logic.

These cover the pure orchestration seams (classify / fan_out / summarize /
report_drift) without running real Alembic or spawning processes — the
end-to-end parallel upgrade against scratch schemas is an operator/Phase-0
measurement step, not part of the fast test loop (the suite deliberately keeps
migrations out of the per-test cycle).
"""

from __future__ import annotations

from bimdossier_api.scripts import migrate_all as m


def test_classify_splits_by_head() -> None:
    schemas = ["org_a", "org_b", "org_c"]
    # Head is the single squashed baseline (0001_tenant). org_b sits on a
    # hypothetical older rev, org_c was never migrated — both count as behind.
    revs = {"org_a": "0001_tenant", "org_b": "0000_older", "org_c": None}
    heads = {"0001_tenant"}

    at_head, behind = m.classify(schemas, revs, heads)

    assert at_head == ["org_a"]
    assert behind == ["org_b", "org_c"]  # older rev + never-migrated both count


def test_classify_all_at_head() -> None:
    schemas = ["org_a", "org_b"]
    revs = {"org_a": "0001_tenant", "org_b": "0001_tenant"}
    at_head, behind = m.classify(schemas, revs, {"0001_tenant"})
    assert behind == []
    assert at_head == ["org_a", "org_b"]


def test_fan_out_inline_runs_each_schema() -> None:
    seen: list[str] = []

    def fake_worker(schema: str) -> m.SchemaResult:
        seen.append(schema)
        return (schema, m.UPGRADED, None)

    results = m.fan_out(["a", "b", "c"], concurrency=1, worker=fake_worker)

    assert seen == ["a", "b", "c"]
    assert results == [
        ("a", m.UPGRADED, None),
        ("b", m.UPGRADED, None),
        ("c", m.UPGRADED, None),
    ]


def test_fan_out_empty_is_noop() -> None:
    assert m.fan_out([], concurrency=8) == []


def test_summarize_returns_nonzero_on_failure(capsys) -> None:
    def fake_worker(schema: str) -> m.SchemaResult:
        if schema == "bad":
            return (schema, m.FAILED, "RuntimeError: boom")
        return (schema, m.UPGRADED, None)

    results = m.fan_out(["ok1", "bad", "ok2"], concurrency=1, worker=fake_worker)
    code = m.summarize(at_head=["x"], results=results)

    assert code == 1
    captured = capsys.readouterr()
    assert "up-to-date: 1" in captured.out
    assert "upgraded:   2" in captured.out
    assert "failed:     1" in captured.out
    assert "bad" in captured.err  # failures go to stderr with their error


def test_summarize_returns_zero_when_clean() -> None:
    results = [("a", m.UPGRADED, None), ("b", m.UPGRADED, None)]
    assert m.summarize(at_head=["c"], results=results) == 0


def test_report_drift_exit_codes(capsys) -> None:
    # nothing behind -> 0
    assert m.report_drift({"h"}, at_head=["org_a"], behind=[], revs={"org_a": "h"}) == 0
    # something behind -> 1, and the laggard is named
    code = m.report_drift({"h"}, at_head=[], behind=["org_b"], revs={"org_b": None})
    assert code == 1
    assert "org_b" in capsys.readouterr().out
