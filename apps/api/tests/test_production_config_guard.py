"""Unit tests for `validate_production_config` (the boot-time guard that refuses
to start outside dev with insecure default secrets / wildcard CORS).

Pure-logic: builds a Settings via `model_copy` and asserts on the returned error
list. No DB/Redis fixtures, so these run in the fast pure-logic lane.
"""

from bimstitch_api.config import get_settings, validate_production_config

_SECURE_OVERRIDES = {
    "s3_access_key_id": "AKIAREALKEY",
    "s3_secret_access_key": "a-real-secret-value-from-vault",
    "processor_shared_secret": "a-strong-random-processor-secret-value",
    "cors_origins": "https://app.example.com",
    "jwt_secret": "x" * 40,
}

_INSECURE_OVERRIDES = {
    "s3_access_key_id": "bimstitch",
    "s3_secret_access_key": "bimstitch-secret",
    "processor_shared_secret": "dev-shared-secret-change-me",
    "cors_origins": "*",
    "jwt_secret": "short",
}


def test_dev_region_allows_dev_defaults() -> None:
    # In dev the guard is a no-op even with every dev default in place.
    settings = get_settings().model_copy(
        update={"deploy_region": "dev", **_INSECURE_OVERRIDES}
    )
    assert validate_production_config(settings) == []


def test_prod_region_flags_every_insecure_default() -> None:
    settings = get_settings().model_copy(
        update={"deploy_region": "prod", **_INSECURE_OVERRIDES}
    )
    errors = validate_production_config(settings)
    joined = "\n".join(errors)
    assert "S3_ACCESS_KEY_ID" in joined
    assert "S3_SECRET_ACCESS_KEY" in joined
    assert "PROCESSOR_SHARED_SECRET" in joined
    assert "CORS_ORIGINS" in joined
    assert "JWT_SECRET" in joined


def test_prod_region_accepts_secure_config() -> None:
    settings = get_settings().model_copy(
        update={"deploy_region": "prod", **_SECURE_OVERRIDES}
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
