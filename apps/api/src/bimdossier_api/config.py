import logging
from functools import lru_cache

from pydantic import EmailStr, Field
from pydantic_settings import BaseSettings, SettingsConfigDict

logger = logging.getLogger(__name__)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    database_url: str = Field(alias="DATABASE_URL")
    admin_database_url: str | None = Field(default=None, alias="BIMDOSSIER_ADMIN_DATABASE_URL")
    test_database_url: str | None = Field(default=None, alias="TEST_DATABASE_URL")

    jwt_secret: str = Field(alias="JWT_SECRET")
    jwt_access_ttl_seconds: int = Field(default=900, alias="JWT_ACCESS_TTL_SECONDS")
    jwt_refresh_ttl_seconds: int = Field(default=604800, alias="JWT_REFRESH_TTL_SECONDS")
    impersonation_token_ttl_seconds: int = Field(
        default=900, alias="IMPERSONATION_TOKEN_TTL_SECONDS"
    )
    invite_token_ttl_seconds: int = Field(default=604800, alias="INVITE_TOKEN_TTL_SECONDS")
    invitation_ttl_days: int = Field(default=14, alias="INVITATION_TTL_DAYS")
    invitation_sweep_interval_minutes: int = Field(
        default=60, alias="INVITATION_SWEEP_INTERVAL_MINUTES"
    )
    deadline_sweep_interval_minutes: int = Field(
        default=60, alias="DEADLINE_SWEEP_INTERVAL_MINUTES"
    )
    job_reconcile_interval_minutes: int = Field(
        default=5, alias="JOB_RECONCILE_INTERVAL_MINUTES"
    )
    job_stuck_timeout_minutes: int = Field(
        default=60, alias="JOB_STUCK_TIMEOUT_MINUTES"
    )
    # Max org schemas a per-org sweep (deadlines, job-reconcile) processes
    # concurrently. Bounds DB connection use while keeping one slow tenant from
    # blocking the rest as org count grows.
    sweep_org_concurrency: int = Field(default=8, alias="SWEEP_ORG_CONCURRENCY")

    smtp_host: str = Field(default="localhost", alias="SMTP_HOST")
    smtp_port: int = Field(default=1025, alias="SMTP_PORT")
    smtp_from: EmailStr = Field(default="no-reply@bimdossier.dev", alias="SMTP_FROM")

    email_transport: str = Field(default="smtp", alias="EMAIL_TRANSPORT")
    postmark_server_token: str | None = Field(default=None, alias="POSTMARK_SERVER_TOKEN")
    postmark_message_stream: str = Field(default="outbound", alias="POSTMARK_MESSAGE_STREAM")

    frontend_verify_url: str = Field(
        default="http://localhost:3000/auth/verify", alias="FRONTEND_VERIFY_URL"
    )
    frontend_reset_password_url: str = Field(
        default="http://localhost:3001/reset-password", alias="FRONTEND_RESET_PASSWORD_URL"
    )
    frontend_activate_url: str = Field(
        default="http://localhost:3001/activate", alias="FRONTEND_ACTIVATE_URL"
    )
    frontend_invitations_url: str = Field(
        default="http://localhost:3001/account", alias="FRONTEND_INVITATIONS_URL"
    )
    frontend_project_url: str = Field(
        default="http://localhost:3001/projects", alias="FRONTEND_PROJECT_URL"
    )

    cors_origins: str = Field(default="http://localhost:3000", alias="CORS_ORIGINS")
    cors_origin_regex: str | None = Field(default=None, alias="CORS_ORIGIN_REGEX")
    # CORS allow-list applied to the storage buckets (PutBucketCORS), decoupled
    # from the API's own `cors_origins`. The IFC bucket holds only presigned,
    # credential-less objects, so a permissive `*` here is safe and lets the mobile
    # WebView / iOS origins fetch model bytes without widening the API allow-list.
    # Falls back to `cors_origin_list` when unset.
    s3_cors_origins: str | None = Field(default=None, alias="S3_CORS_ORIGINS")

    redis_url: str = Field(default="redis://localhost:6380/0", alias="REDIS_URL")
    test_redis_url: str | None = Field(default=None, alias="TEST_REDIS_URL")
    redis_max_connections: int = Field(default=50, alias="REDIS_MAX_CONNECTIONS")

    db_pool_size: int = Field(default=20, alias="DB_POOL_SIZE")
    db_max_overflow: int = Field(default=40, alias="DB_MAX_OVERFLOW")
    db_pool_recycle_seconds: int = Field(default=1800, alias="DB_POOL_RECYCLE_SECONDS")
    db_pool_timeout_seconds: int = Field(default=30, alias="DB_POOL_TIMEOUT_SECONDS")

    rate_limit_login_per_min: int = Field(default=5, alias="RATE_LIMIT_LOGIN_PER_MIN")
    rate_limit_register_per_hour: int = Field(default=3, alias="RATE_LIMIT_REGISTER_PER_HOUR")
    rate_limit_refresh_per_min: int = Field(default=10, alias="RATE_LIMIT_REFRESH_PER_MIN")
    rate_limit_forgot_per_hour: int = Field(default=3, alias="RATE_LIMIT_FORGOT_PER_HOUR")
    # Per-user/hour budgets on the expensive authenticated endpoints (synchronous
    # arbiter compliance check, puppeteer report pipeline, upload presign churn).
    rate_limit_compliance_per_hour: int = Field(
        default=20, alias="RATE_LIMIT_COMPLIANCE_PER_HOUR"
    )
    rate_limit_report_per_hour: int = Field(default=10, alias="RATE_LIMIT_REPORT_PER_HOUR")
    rate_limit_upload_initiate_per_hour: int = Field(
        default=100, alias="RATE_LIMIT_UPLOAD_INITIATE_PER_HOUR"
    )
    # Comma-separated IPs of trusted reverse proxies sitting directly in front
    # of the API. Rate-limit client identity uses the raw `request.client.host`
    # by default and only honors `X-Forwarded-For` when the immediate peer is
    # in this allowlist — otherwise an attacker rotates the header to mint a
    # fresh login/refresh bucket per request and defeats the throttle. Empty
    # (the default) means trust nothing: always key on the real peer IP.
    trusted_proxy_ips: str = Field(default="", alias="TRUSTED_PROXY_IPS")

    s3_endpoint_url: str = Field(default="http://localhost:9000", alias="S3_ENDPOINT_URL")
    # The host baked into presigned URLs that *clients* must reach (browser, mobile
    # WebView). Defaults to `s3_endpoint_url` when unset, so dev/CI are unchanged.
    # Set this to a LAN IP or tunnel host when a phone must fetch model bytes that
    # the API presigns against an otherwise-internal `localhost` MinIO. SigV4 signs
    # the Host header, so the URL must be presigned against the host the client
    # uses — it cannot be rewritten after signing.
    s3_public_endpoint_url: str | None = Field(default=None, alias="S3_PUBLIC_ENDPOINT_URL")
    s3_region: str = Field(default="us-east-1", alias="S3_REGION")
    # No dev default: a missing value fails closed at construction (exactly like
    # jwt_secret), so a forgotten prod env var can never silently fall back to the
    # publicly-known MinIO root key. Dev/CI/tests supply these via .env /
    # docker-compose / tests/conftest.py.
    s3_access_key_id: str = Field(alias="S3_ACCESS_KEY_ID")
    s3_secret_access_key: str = Field(alias="S3_SECRET_ACCESS_KEY")
    s3_bucket_ifc: str = Field(default="ifc-files", alias="S3_BUCKET_IFC")
    s3_bucket_attachments: str = Field(default="attachments", alias="S3_BUCKET_ATTACHMENTS")
    s3_presign_ttl_seconds: int = Field(default=900, alias="S3_PRESIGN_TTL_SECONDS")
    upload_max_bytes: int = Field(default=2 * 1024 * 1024 * 1024, alias="UPLOAD_MAX_BYTES")
    attachment_max_bytes: int = Field(
        default=500 * 1024 * 1024, alias="ATTACHMENT_MAX_BYTES"
    )
    thumbnail_max_bytes: int = Field(default=2 * 1024 * 1024, alias="THUMBNAIL_MAX_BYTES")
    thumbnail_allowed_content_types: str = Field(
        default="image/jpeg,image/png,image/webp", alias="THUMBNAIL_ALLOWED_CONTENT_TYPES"
    )
    capture_link_max_ttl_hours: int = Field(default=720, alias="CAPTURE_LINK_MAX_TTL_HOURS")

    frontend_capture_url: str = Field(
        default="http://localhost:3001/capture", alias="FRONTEND_CAPTURE_URL"
    )

    processor_url: str = Field(default="http://localhost:8088", alias="PROCESSOR_URL")
    # No dev default (see s3_access_key_id) — a forgotten prod value fails closed
    # instead of shipping the public dev shared secret an attacker could use to
    # forge /internal/jobs/callback requests.
    processor_shared_secret: str = Field(alias="PROCESSOR_SHARED_SECRET")
    processor_dispatch_timeout_seconds: float = Field(
        default=5.0, alias="PROCESSOR_DISPATCH_TIMEOUT_SECONDS"
    )

    sentry_dsn: str | None = Field(default=None, alias="SENTRY_DSN")
    sentry_environment: str | None = Field(default=None, alias="SENTRY_ENVIRONMENT")
    sentry_traces_sample_rate: float = Field(default=0.1, alias="SENTRY_TRACES_SAMPLE_RATE")
    sentry_release: str | None = Field(default=None, alias="SENTRY_RELEASE")

    max_concurrent_jobs_per_org: int = Field(default=10, alias="MAX_CONCURRENT_JOBS_PER_ORG")

    # Ceiling on custom fields per finding template (env-authoritative; the
    # Pydantic MAX_TEMPLATE_FIELDS constant is the UX guardrail mirrored in Zod).
    max_template_fields: int = Field(default=30, alias="MAX_TEMPLATE_FIELDS")

    arbiter_url: str = Field(default="http://localhost:8090", alias="ARBITER_URL")
    arbiter_timeout_seconds: float = Field(default=30.0, alias="ARBITER_TIMEOUT_SECONDS")

    deploy_region: str = Field(default="dev", alias="DEPLOY_REGION")
    deploy_node: str = Field(default="local", alias="DEPLOY_NODE")

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def trusted_proxy_ip_set(self) -> frozenset[str]:
        """Set of trusted reverse-proxy IPs whose `X-Forwarded-For` may be
        honored for rate-limit client identity. Empty by default."""
        return frozenset(
            ip.strip() for ip in self.trusted_proxy_ips.split(",") if ip.strip()
        )

    @property
    def s3_cors_origin_list(self) -> list[str]:
        """Origins for the storage-bucket CORS policy. Falls back to the API's
        own allow-list when `S3_CORS_ORIGINS` is unset."""
        if self.s3_cors_origins is None:
            return self.cors_origin_list
        return [origin.strip() for origin in self.s3_cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()


# Known dev-only default secret VALUES. The credential *fields* no longer carry
# these as Pydantic defaults — a missing env var fails closed at construction
# (exactly like JWT_SECRET). These constants only let the guard and the boot-time
# source audit RECOGNISE a dev value that was supplied explicitly (e.g. a prod
# .env copied from .env.example without changing the credentials).
DEV_S3_ACCESS_KEY_ID = "bimdossier"
DEV_S3_SECRET_ACCESS_KEY = "bimdossier-secret"
DEV_PROCESSOR_SHARED_SECRET = "dev-shared-secret-change-me"
MIN_JWT_SECRET_LENGTH = 32

# (settings attr, env var name, known dev value). The guard refuses to boot when
# any of these still holds its dev value and we are not explicitly in dev.
_DEV_VALUED_SECRETS: tuple[tuple[str, str, str], ...] = (
    ("s3_access_key_id", "S3_ACCESS_KEY_ID", DEV_S3_ACCESS_KEY_ID),
    ("s3_secret_access_key", "S3_SECRET_ACCESS_KEY", DEV_S3_SECRET_ACCESS_KEY),
    ("processor_shared_secret", "PROCESSOR_SHARED_SECRET", DEV_PROCESSOR_SHARED_SECRET),
)


def _dev_region_opted_in(settings: Settings) -> bool:
    """True only when ``DEPLOY_REGION`` is *explicitly* set to ``dev``.

    ``deploy_region`` still DEFAULTS to ``dev`` (so the public status badge keeps
    reporting a friendly region locally), but an UNSET ``DEPLOY_REGION`` must not
    be read as "we're in dev": production is the default posture and dev is
    opt-in. ``model_fields_set`` records whether the value came from the
    environment / ``.env`` (explicit) or fell back to the field default (unset) —
    exactly the distinction the guard needs. Without it, a forgotten
    ``DEPLOY_REGION`` in production would silently skip every check below (the
    fail-open bug this guard exists to prevent).
    """
    return settings.deploy_region == "dev" and "deploy_region" in settings.model_fields_set


def validate_production_config(settings: Settings) -> list[str]:
    """Return insecure-config errors unless ``DEPLOY_REGION`` is explicitly ``dev``.

    Production is the *default* posture: a missing/implicit ``DEPLOY_REGION`` is
    treated as production so a forgotten env var fails loudly at startup instead
    of silently skipping the guard. Returns ``[]`` only when an operator has
    explicitly opted into dev (``DEPLOY_REGION=dev``).

    Pure logic — the boot-time WARN and the env-vs-default source audit live in
    ``log_secret_sources`` so this stays trivially unit-testable. Called from the
    app lifespan; the processor has its own mirror in ``config.ts``.
    """
    if _dev_region_opted_in(settings):
        return []
    errors: list[str] = []
    for attr, env_name, dev_value in _DEV_VALUED_SECRETS:
        if getattr(settings, attr) == dev_value:
            errors.append(f"{env_name} is the dev default; set a real value.")
    if "*" in settings.cors_origin_list:
        errors.append("CORS_ORIGINS contains '*'; set an explicit origin allowlist.")
    if len(settings.jwt_secret) < MIN_JWT_SECRET_LENGTH:
        errors.append(
            f"JWT_SECRET is shorter than {MIN_JWT_SECRET_LENGTH} chars; use a strong random secret."
        )
    return errors


def log_secret_sources(settings: Settings) -> None:
    """Log, at boot, the source of each protected secret and the guard posture.

    Never logs a secret value — only env-vs-default and a dev-value verdict.
    Emits a loud WARN when the guard is in dev-skip mode so an operator who left
    ``DEPLOY_REGION=dev`` in a real deployment sees it. Called once from the app
    lifespan, before ``validate_production_config``.
    """
    dev_skip = _dev_region_opted_in(settings)
    if dev_skip:
        bar = "=" * 60
        logger.warning(
            "%s\nProduction-config guard is in DEV-SKIP mode (DEPLOY_REGION=dev "
            "set explicitly). Dev-default credentials and wildcard CORS are NOT "
            "enforced — this MUST NOT appear in a production deployment.\n%s",
            bar,
            bar,
        )
    dev_values = {attr: dev_value for attr, _name, dev_value in _DEV_VALUED_SECRETS}
    logger.info(
        "Secret source audit (deploy_region=%r, guard=%s):",
        settings.deploy_region,
        "DEV-SKIP" if dev_skip else "ENFORCED",
    )
    for attr, env_name in (
        ("jwt_secret", "JWT_SECRET"),
        ("s3_access_key_id", "S3_ACCESS_KEY_ID"),
        ("s3_secret_access_key", "S3_SECRET_ACCESS_KEY"),
        ("processor_shared_secret", "PROCESSOR_SHARED_SECRET"),
    ):
        source = "env" if attr in settings.model_fields_set else "DEFAULT"
        if attr in dev_values and getattr(settings, attr) == dev_values[attr]:
            logger.warning("  %s: source=%s — DEV-DEFAULT VALUE in use", env_name, source)
        else:
            logger.info("  %s: source=%s", env_name, source)
