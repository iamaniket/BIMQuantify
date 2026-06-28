"""Tests for the Arbiter production-config guard, focused on ARBITER_SHARED_SECRET."""

from __future__ import annotations

from typing import Any

from arbiter.config import Settings, validate_production_config


def _settings(**overrides: str) -> Settings:
    """Build Settings from explicit aliases (no .env / os.environ dependence).

    Init kwargs win over env, and ``_env_file=None`` disables the dotenv read, so
    this is hermetic regardless of the developer's shell.
    """
    base: dict[str, str] = {
        "S3_ACCESS_KEY_ID": "a-real-access-key",
        "S3_SECRET_ACCESS_KEY": "a-real-secret-key",
        "ARBITER_SHARED_SECRET": "a-strong-random-arbiter-secret",
        "DEPLOY_REGION": "prod",
    }
    base.update(overrides)
    kwargs: dict[str, Any] = dict(base)
    kwargs["_env_file"] = None
    return Settings(**kwargs)


def test_prod_flags_dev_arbiter_secret() -> None:
    settings = _settings(ARBITER_SHARED_SECRET="dev-arbiter-secret-change-me")
    errors = validate_production_config(settings)
    assert len(errors) == 1
    assert "ARBITER_SHARED_SECRET" in errors[0]


def test_prod_accepts_secure_secret() -> None:
    assert validate_production_config(_settings()) == []


def test_dev_region_skips_guard() -> None:
    settings = _settings(
        DEPLOY_REGION="dev",
        ARBITER_SHARED_SECRET="dev-arbiter-secret-change-me",
        S3_ACCESS_KEY_ID="bimdossier",
        S3_SECRET_ACCESS_KEY="bimdossier-secret",
    )
    assert validate_production_config(settings) == []
