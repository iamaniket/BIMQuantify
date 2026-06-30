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
    "arbiter_shared_secret": "a-strong-random-arbiter-secret-value",
    "cors_origins": "https://app.example.com",
    "jwt_secret": "x" * 40,
}

_INSECURE_OVERRIDES = {
    "s3_access_key_id": "bimdossier",
    "s3_secret_access_key": "bimdossier-secret",
    "processor_shared_secret": "dev-shared-secret-change-me",
    "arbiter_shared_secret": "dev-arbiter-secret-change-me",
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
    assert "ARBITER_SHARED_SECRET" in joined
    assert "CORS_ORIGINS" in joined
    assert "JWT_SECRET" in joined


def test_prod_region_accepts_secure_config() -> None:
    settings = get_settings().model_copy(update={"deploy_region": "prod", **_SECURE_OVERRIDES})
    assert validate_production_config(settings) == []


def test_free_tier_disabled_skips_free_checks() -> None:
    # Dangerous free values are ignored entirely while the wedge is off.
    settings = get_settings().model_copy(
        update={
            "deploy_region": "prod",
            **_SECURE_OVERRIDES,
            "free_tier_enabled": False,
            "pooled_extraction_concurrency_global": 100000,
            "free_max_documents_per_user": 0,
        }
    )
    assert validate_production_config(settings) == []


def test_free_tier_enabled_flags_unbounded_global_cap() -> None:
    settings = get_settings().model_copy(
        update={
            "deploy_region": "prod",
            **_SECURE_OVERRIDES,
            "free_tier_enabled": True,
            "pooled_extraction_concurrency_global": 100000,
        }
    )
    joined = "\n".join(validate_production_config(settings))
    assert "POOLED_EXTRACTION_CONCURRENCY_GLOBAL" in joined


def test_free_tier_enabled_flags_zero_caps() -> None:
    settings = get_settings().model_copy(
        update={
            "deploy_region": "prod",
            **_SECURE_OVERRIDES,
            "free_tier_enabled": True,
            "pooled_extraction_concurrency_global": 0,
            "free_max_documents_per_user": 0,
            "free_upload_max_bytes": 0,
        }
    )
    joined = "\n".join(validate_production_config(settings))
    assert "POOLED_EXTRACTION_CONCURRENCY_GLOBAL" in joined
    assert "FREE_MAX_MODELS_PER_USER" in joined
    assert "FREE_UPLOAD_MAX_BYTES" in joined


def test_free_tier_enabled_with_sane_caps_passes() -> None:
    settings = get_settings().model_copy(
        update={
            "deploy_region": "prod",
            **_SECURE_OVERRIDES,
            "free_tier_enabled": True,
            "pooled_extraction_concurrency_global": 1,
            "free_max_documents_per_user": 5,
            "free_upload_max_bytes": 250 * 1024 * 1024,
        }
    )
    assert validate_production_config(settings) == []


def test_prod_region_flags_only_the_offending_secret() -> None:
    # A single dev default among otherwise-secure values yields exactly one error.
    update = {"deploy_region": "prod", **_SECURE_OVERRIDES}
    update["processor_shared_secret"] = "dev-shared-secret-change-me"
    settings = get_settings().model_copy(update=update)
    errors = validate_production_config(settings)
    assert len(errors) == 1
    assert "PROCESSOR_SHARED_SECRET" in errors[0]


def test_prod_region_flags_only_the_arbiter_secret() -> None:
    # The Arbiter shared secret is guarded exactly like the processor's: a lone
    # dev value among secure ones yields exactly one ARBITER_SHARED_SECRET error.
    update = {"deploy_region": "prod", **_SECURE_OVERRIDES}
    update["arbiter_shared_secret"] = "dev-arbiter-secret-change-me"
    settings = get_settings().model_copy(update=update)
    errors = validate_production_config(settings)
    assert len(errors) == 1
    assert "ARBITER_SHARED_SECRET" in errors[0]


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


# ---------------------------------------------------------------------------
# Forwarded-headers / reverse-proxy trust. uvicorn (proxy_headers=True) rewrites
# request.client.host from X-Forwarded-For for any peer when FORWARDED_ALLOW_IPS
# is "*", taking the spoofable left-most hop — re-opening the rate-limit bypass
# one layer below the app identifier. The guard refuses "*" outside dev for both
# the uvicorn-level (FORWARDED_ALLOW_IPS) and app-level (TRUSTED_PROXY_IPS) knobs.
# ---------------------------------------------------------------------------


def test_prod_region_flags_wildcard_forwarded_allow_ips() -> None:
    settings = get_settings().model_copy(
        update={"deploy_region": "prod", **_SECURE_OVERRIDES, "forwarded_allow_ips": "*"}
    )
    errors = validate_production_config(settings)
    assert len(errors) == 1
    assert "FORWARDED_ALLOW_IPS" in errors[0]


def test_prod_region_flags_wildcard_in_forwarded_allow_ips_list() -> None:
    # "*" anywhere in the comma list is still always-trust to uvicorn.
    settings = get_settings().model_copy(
        update={"deploy_region": "prod", **_SECURE_OVERRIDES, "forwarded_allow_ips": "10.0.0.1, *"}
    )
    errors = validate_production_config(settings)
    assert any("FORWARDED_ALLOW_IPS" in e for e in errors)


def test_prod_region_flags_wildcard_trusted_proxy_ips() -> None:
    settings = get_settings().model_copy(
        update={"deploy_region": "prod", **_SECURE_OVERRIDES, "trusted_proxy_ips": "*"}
    )
    errors = validate_production_config(settings)
    assert len(errors) == 1
    assert "TRUSTED_PROXY_IPS" in errors[0]


def test_prod_region_accepts_real_cidr_forwarded_allow_ips() -> None:
    # An explicit proxy subnet (the safe production setting) must not be flagged.
    settings = get_settings().model_copy(
        update={"deploy_region": "prod", **_SECURE_OVERRIDES, "forwarded_allow_ips": "10.0.0.0/8"}
    )
    assert validate_production_config(settings) == []


def test_dev_region_allows_wildcard_forwarded_allow_ips() -> None:
    # Explicit dev opt-in skips the guard entirely, including the XFF wildcard.
    settings = get_settings().model_copy(
        update={"deploy_region": "dev", **_INSECURE_OVERRIDES, "forwarded_allow_ips": "*"}
    )
    assert validate_production_config(settings) == []


# ---------------------------------------------------------------------------
# WebSocket lifetime cap. A notification socket re-authenticates on an interval
# and is hard-capped at WS_MAX_LIFETIME_SECONDS. If that cap exceeds the access
# token's own TTL, a socket could outlive its token, defeating the lifetime cap
# (the whole point of the H5 fix). The guard refuses to boot on that inversion.
# ---------------------------------------------------------------------------


def test_prod_region_flags_ws_lifetime_exceeding_access_ttl() -> None:
    settings = get_settings().model_copy(
        update={
            "deploy_region": "prod",
            **_SECURE_OVERRIDES,
            "jwt_access_ttl_seconds": 900,
            "ws_max_lifetime_seconds": 3600,
        }
    )
    errors = validate_production_config(settings)
    assert len(errors) == 1
    assert "WS_MAX_LIFETIME_SECONDS" in errors[0]


def test_prod_region_accepts_ws_lifetime_within_access_ttl() -> None:
    # Cap below the access TTL is the safe configuration — no error.
    settings = get_settings().model_copy(
        update={
            "deploy_region": "prod",
            **_SECURE_OVERRIDES,
            "jwt_access_ttl_seconds": 900,
            "ws_max_lifetime_seconds": 600,
        }
    )
    assert validate_production_config(settings) == []


def test_dev_region_allows_ws_lifetime_exceeding_access_ttl() -> None:
    # Explicit dev opt-in skips the guard, including the lifetime inversion.
    settings = get_settings().model_copy(
        update={
            "deploy_region": "dev",
            **_INSECURE_OVERRIDES,
            "jwt_access_ttl_seconds": 900,
            "ws_max_lifetime_seconds": 3600,
        }
    )
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
