"""Unit tests for `validate_production_config` (the boot-time guard that refuses
to start outside dev with insecure default secrets / wildcard CORS).

Pure-logic: builds a Settings via `model_copy` and asserts on the returned error
list. No DB/Redis fixtures, so these run in the fast pure-logic lane.
"""

import pytest
from pydantic import ValidationError

from bimdossier_api.config import Settings, get_settings, validate_production_config

_SECURE_OVERRIDES = {
    "s3_access_key_id": "AKIAREALKEY",
    "s3_secret_access_key": "a-real-secret-value-from-vault",
    "processor_shared_secret": "a-strong-random-processor-secret-value",
    "cors_origins": "https://app.example.com",
    "jwt_secret": "x" * 40,
}

_INSECURE_OVERRIDES = {
    "s3_access_key_id": "bimdossier",
    "s3_secret_access_key": "bimdossier-secret",
    "processor_shared_secret": "dev-shared-secret-change-me",
    "cors_origins": "*",
    "jwt_secret": "short",
}


def _with_region_unset(settings: Settings) -> Settings:
    """Return ``settings`` with ``deploy_region`` no longer marked as explicitly
    set, simulating an UNSET ``DEPLOY_REGION`` env var (the value falls back to
    the ``dev`` default but is not in ``model_fields_set``). Builds a fresh set
    so the lru-cached base settings is never mutated.
    """
    object.__setattr__(
        settings,
        "__pydantic_fields_set__",
        settings.model_fields_set - {"deploy_region"},
    )
    return settings


def test_dev_region_allows_dev_defaults() -> None:
    # Explicit DEPLOY_REGION=dev is the only thing that skips the guard, even with
    # every dev default in place. (model_copy(update=...) marks the field as set.)
    settings = get_settings().model_copy(update={"deploy_region": "dev", **_INSECURE_OVERRIDES})
    assert validate_production_config(settings) == []


def test_prod_region_flags_every_insecure_default() -> None:
    settings = get_settings().model_copy(update={"deploy_region": "prod", **_INSECURE_OVERRIDES})
    errors = validate_production_config(settings)
    joined = "\n".join(errors)
    assert "S3_ACCESS_KEY_ID" in joined
    assert "S3_SECRET_ACCESS_KEY" in joined
    assert "PROCESSOR_SHARED_SECRET" in joined
    assert "CORS_ORIGINS" in joined
    assert "JWT_SECRET" in joined


def test_prod_region_accepts_secure_config() -> None:
    settings = get_settings().model_copy(update={"deploy_region": "prod", **_SECURE_OVERRIDES})
    assert validate_production_config(settings) == []


def test_prod_region_flags_only_the_offending_secret() -> None:
    # A single dev default among otherwise-secure values yields exactly one error.
    update = {"deploy_region": "prod", **_SECURE_OVERRIDES}
    update["processor_shared_secret"] = "dev-shared-secret-change-me"
    settings = get_settings().model_copy(update=update)
    errors = validate_production_config(settings)
    assert len(errors) == 1
    assert "PROCESSOR_SHARED_SECRET" in errors[0]


def test_unset_region_is_treated_as_production() -> None:
    # The reported fail-open bug: DEPLOY_REGION unset (value falls back to the
    # "dev" default but was never explicitly set). Production is the default
    # posture, so the guard MUST still fire on dev-default secrets instead of
    # silently shipping them.
    settings = _with_region_unset(
        get_settings().model_copy(update={"deploy_region": "dev", **_INSECURE_OVERRIDES})
    )
    errors = validate_production_config(settings)
    joined = "\n".join(errors)
    assert "S3_ACCESS_KEY_ID" in joined
    assert "S3_SECRET_ACCESS_KEY" in joined
    assert "PROCESSOR_SHARED_SECRET" in joined
    assert "CORS_ORIGINS" in joined
    assert "JWT_SECRET" in joined


def test_unset_region_with_secure_config_passes() -> None:
    # A correctly-configured deployment that simply forgot DEPLOY_REGION must
    # still boot — production posture flags only actual dev values, not real ones.
    settings = _with_region_unset(get_settings().model_copy(update=dict(_SECURE_OVERRIDES)))
    assert validate_production_config(settings) == []


def test_missing_credential_fails_at_construction(monkeypatch: pytest.MonkeyPatch) -> None:
    # Defense in depth behind the guard: the credential fields have no code
    # default, so a missing env var raises at construction regardless of region
    # (mirrors JWT_SECRET) — there is no public dev credential to fall back to.
    # Drop the conftest-supplied env var and the dev .env so the field is truly
    # absent.
    monkeypatch.delenv("S3_ACCESS_KEY_ID", raising=False)
    with pytest.raises(ValidationError):
        Settings(
            DATABASE_URL="postgresql+asyncpg://x/y",
            JWT_SECRET="x" * 40,
            S3_SECRET_ACCESS_KEY="s",
            PROCESSOR_SHARED_SECRET="p",
            _env_file=None,  # type: ignore[call-arg]
        )  # S3_ACCESS_KEY_ID omitted -> ValidationError
