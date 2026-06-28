import logging
from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

logger = logging.getLogger("arbiter")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    s3_endpoint_url: str = Field(default="http://localhost:9000", alias="S3_ENDPOINT_URL")
    s3_region: str = Field(default="us-east-1", alias="S3_REGION")
    # No dev default: a missing value fails closed at construction (mirrors
    # apps/api/config.py), so a forgotten prod env var can never silently fall
    # back to the publicly-known MinIO root key. Dev/CI supply these via .env /
    # docker-compose.
    s3_access_key_id: str = Field(alias="S3_ACCESS_KEY_ID")
    s3_secret_access_key: str = Field(alias="S3_SECRET_ACCESS_KEY")
    s3_bucket_ifc: str = Field(default="ifc-files", alias="S3_BUCKET_IFC")

    # Shared bearer between the API and this MCP server. No dev default (same
    # fail-closed rationale as the S3 creds): a missing value fails at
    # construction so an unauthenticated MCP transport can never ship by
    # accident. Must match the API's ARBITER_SHARED_SECRET. See auth.py.
    shared_secret: str = Field(alias="ARBITER_SHARED_SECRET")

    host: str = Field(default="0.0.0.0", alias="ARBITER_HOST")
    port: int = Field(default=8090, alias="ARBITER_PORT")
    rules_dir: str = Field(default="rules", alias="ARBITER_RULES_DIR")

    sync_enabled: bool = Field(default=True, alias="ARBITER_SYNC_ENABLED")
    sync_interval_hours: int = Field(default=24, alias="ARBITER_SYNC_INTERVAL_HOURS")
    sync_auto_apply: bool = Field(default=False, alias="ARBITER_SYNC_AUTO_APPLY")

    # Production is the default posture (see validate_production_config). Set
    # DEPLOY_REGION=dev explicitly to opt into the dev-config skip.
    deploy_region: str = Field(default="dev", alias="DEPLOY_REGION")

    @property
    def rules_path(self) -> Path:
        return Path(self.rules_dir)


@lru_cache
def get_settings() -> Settings:
    return Settings()


# Known dev-only credential VALUES. The credential *fields* no longer carry
# these as Pydantic defaults — a missing env var fails closed at construction.
# These constants only let the guard RECOGNISE a dev value supplied explicitly
# (e.g. a prod .env copied from .env.example without changing the credentials).
DEV_S3_ACCESS_KEY_ID = "bimdossier"
DEV_S3_SECRET_ACCESS_KEY = "bimdossier-secret"
DEV_ARBITER_SHARED_SECRET = "dev-arbiter-secret-change-me"

_DEV_VALUED_SECRETS: tuple[tuple[str, str, str], ...] = (
    ("s3_access_key_id", "S3_ACCESS_KEY_ID", DEV_S3_ACCESS_KEY_ID),
    ("s3_secret_access_key", "S3_SECRET_ACCESS_KEY", DEV_S3_SECRET_ACCESS_KEY),
    ("shared_secret", "ARBITER_SHARED_SECRET", DEV_ARBITER_SHARED_SECRET),
)


def _dev_region_opted_in(settings: Settings) -> bool:
    """True only when ``DEPLOY_REGION`` is *explicitly* set to ``dev``.

    An UNSET ``DEPLOY_REGION`` must not be read as "we're in dev": production is
    the default posture and dev is opt-in. ``model_fields_set`` distinguishes an
    explicit value from the field default, so a forgotten ``DEPLOY_REGION`` in
    production fails the guard instead of silently skipping it.
    """
    return settings.deploy_region == "dev" and "deploy_region" in settings.model_fields_set


def validate_production_config(settings: Settings) -> list[str]:
    """Return insecure-config errors unless ``DEPLOY_REGION`` is explicitly ``dev``.

    Production is the default posture: a missing/implicit ``DEPLOY_REGION`` is
    treated as production so a dev credential copied into a real deploy fails
    loudly at startup. Returns ``[]`` only when an operator has explicitly opted
    into dev (``DEPLOY_REGION=dev``).
    """
    if _dev_region_opted_in(settings):
        return []
    errors: list[str] = []
    for attr, env_name, dev_value in _DEV_VALUED_SECRETS:
        if getattr(settings, attr) == dev_value:
            errors.append(f"{env_name} is the dev default; set a real value.")
    return errors


def enforce_production_config(settings: Settings) -> None:
    """Fail closed at startup when a dev credential is in use outside dev.

    Logs a loud WARN when the guard is skipped (DEPLOY_REGION=dev set explicitly)
    so an operator who left it in a real deployment sees it; raises otherwise.
    Called once from ``server.main`` before the MCP server starts serving.
    """
    if _dev_region_opted_in(settings):
        logger.warning(
            "Arbiter production-config guard is in DEV-SKIP mode (DEPLOY_REGION=dev "
            "set explicitly). Dev-default credentials are NOT enforced — this MUST "
            "NOT appear in a production deployment."
        )
        return
    errors = validate_production_config(settings)
    if errors:
        raise RuntimeError(
            "Refusing to start: insecure production config:\n  - " + "\n  - ".join(errors)
        )
