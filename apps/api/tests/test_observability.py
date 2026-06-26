from __future__ import annotations

import pytest

from bimdossier_api.observability import resolve_release


# Override conftest's autouse DB/Redis fixtures — pure unit test, no app.
@pytest.fixture(autouse=True)
def _clean_tables() -> None:
    return None


@pytest.fixture(autouse=True)
def _flush_redis() -> None:
    return None


@pytest.fixture(autouse=True)
def _stub_extraction_dispatcher() -> None:
    return None


@pytest.fixture(autouse=True)
def _scrub_release_env(monkeypatch: pytest.MonkeyPatch) -> None:
    for var in ("SENTRY_RELEASE", "VERCEL_GIT_COMMIT_SHA", "GITHUB_SHA", "GIT_SHA"):
        monkeypatch.delenv(var, raising=False)


def test_resolve_release_prefers_explicit_value() -> None:
    assert resolve_release("v1.2.3") == "v1.2.3"


def test_resolve_release_falls_back_to_sentry_release_env(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("SENTRY_RELEASE", "abc123")
    assert resolve_release(None) == "abc123"


def test_resolve_release_walks_ci_env_vars(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GITHUB_SHA", "github-sha")
    assert resolve_release(None) == "github-sha"

    monkeypatch.setenv("VERCEL_GIT_COMMIT_SHA", "vercel-sha")
    # Vercel ranks above GITHUB_SHA in the precedence list.
    assert resolve_release(None) == "vercel-sha"


def test_resolve_release_returns_none_when_nothing_set() -> None:
    # autouse fixture scrubs all candidate envs.
    assert resolve_release(None) is None


def test_resolve_release_treats_empty_strings_as_unset(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("SENTRY_RELEASE", "   ")
    monkeypatch.setenv("GIT_SHA", "real-sha")
    assert resolve_release(None) == "real-sha"
