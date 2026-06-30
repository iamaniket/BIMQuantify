import logging
from functools import lru_cache
from urllib.parse import urlparse

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
    # Refresh-token rotation grace window (seconds). Each /auth/jwt/refresh call
    # rotates the refresh token (mints a new one, retires the presented one) and
    # detects reuse: replaying a retired token signs the user out everywhere.
    # Within this short window a retired token is re-honored idempotently —
    # returning the SAME successor — so a benign cross-tab race or a network
    # retry doesn't trip reuse detection. Keep it small; it is the only window in
    # which a just-rotated token still functions. 0 disables the grace entirely.
    refresh_rotation_grace_seconds: int = Field(
        default=30, alias="REFRESH_ROTATION_GRACE_SECONDS"
    )
    # Strict-Transport-Security max-age (seconds), emitted on https responses only
    # (the API gates HSTS on request scheme). 31536000 = 1 year. includeSubDomains
    # is always added; preload is not (it's an irreversible browser commitment).
    hsts_max_age_seconds: int = Field(default=31536000, alias="HSTS_MAX_AGE_SECONDS")
    # `/ws/notifications` re-authenticates an open socket on this interval (re-running
    # the full handshake gate set: blocklist / epoch / is_active / membership) and
    # hard-caps its lifetime. Together these bound how long a socket keeps streaming
    # the org feed after a logout-everywhere / password change / deprovision to one
    # interval, instead of the access token's full natural TTL. The lifetime cap must
    # stay <= JWT_ACCESS_TTL_SECONDS (enforced by validate_production_config).
    ws_revalidate_interval_seconds: int = Field(default=30, alias="WS_REVALIDATE_INTERVAL_SECONDS")
    ws_max_lifetime_seconds: int = Field(default=900, alias="WS_MAX_LIFETIME_SECONDS")
    # Max concurrent /ws/notifications sockets per (org, user). A live notification
    # stream is cheap, but unbounded fan-in lets one authenticated member open
    # thousands of sockets — an in-org DoS / memory-growth vector. The handshake
    # refuses sockets past this cap with a 4029 close. 10 comfortably covers real
    # multi-tab / multi-device use.
    ws_max_connections_per_user: int = Field(default=10, alias="WS_MAX_CONNECTIONS_PER_USER")
    impersonation_token_ttl_seconds: int = Field(
        default=900, alias="IMPERSONATION_TOKEN_TTL_SECONDS"
    )
    invite_token_ttl_seconds: int = Field(default=604800, alias="INVITE_TOKEN_TTL_SECONDS")
    invitation_ttl_days: int = Field(default=14, alias="INVITATION_TTL_DAYS")
    # Days a soft-deleted org is retained (schema + storage kept, recoverable)
    # before it becomes eligible for hard purge (storage wipe + DROP SCHEMA).
    org_retention_days: int = Field(default=30, alias="ORG_RETENTION_DAYS")
    invitation_sweep_interval_minutes: int = Field(
        default=60, alias="INVITATION_SWEEP_INTERVAL_MINUTES"
    )
    deadline_sweep_interval_minutes: int = Field(
        default=60, alias="DEADLINE_SWEEP_INTERVAL_MINUTES"
    )
    job_reconcile_interval_minutes: int = Field(default=5, alias="JOB_RECONCILE_INTERVAL_MINUTES")
    job_stuck_timeout_minutes: int = Field(default=60, alias="JOB_STUCK_TIMEOUT_MINUTES")
    # Data-lifecycle reapers (L11). Interval 0 disables a sweep.
    # Abandoned pending uploads: `pending` project_files older than the timeout
    # (default 24h) are soft-deleted and their object best-effort removed.
    pending_upload_sweep_interval_minutes: int = Field(
        default=30, alias="PENDING_UPLOAD_SWEEP_INTERVAL_MINUTES"
    )
    pending_upload_timeout_minutes: int = Field(
        default=1440, alias="PENDING_UPLOAD_TIMEOUT_MINUTES"
    )
    # Expired/revoked capture links that were never used are hard-deleted.
    capture_link_sweep_interval_minutes: int = Field(
        default=60, alias="CAPTURE_LINK_SWEEP_INTERVAL_MINUTES"
    )
    # Max org schemas a per-org sweep (deadlines, job-reconcile) processes
    # concurrently. Bounds DB connection use while keeping one slow tenant from
    # blocking the rest as org count grows.
    sweep_org_concurrency: int = Field(default=8, alias="SWEEP_ORG_CONCURRENCY")

    smtp_host: str = Field(default="localhost", alias="SMTP_HOST")
    smtp_port: int = Field(default=1025, alias="SMTP_PORT")
    smtp_from: EmailStr = Field(default="no-reply@bimdossier.dev", alias="SMTP_FROM")
    # Hard ceiling on a single SMTP send (connect + handshake + data), in seconds.
    # Without it aiosmtplib falls back to its 60s default, so a hung/unreachable
    # mail server pins the request thread for a full minute. Transactional sends
    # are best-effort (see email.transport.send_email_best_effort) so a timeout is
    # logged and swallowed, never surfaced to the caller.
    smtp_timeout_seconds: float = Field(default=10.0, alias="SMTP_TIMEOUT_SECONDS")

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
    # Fail fast when Redis is unreachable so the rate limiter can fail open and
    # the blocklist can fail closed within seconds, instead of hanging the
    # request. health_check_interval pings idle connections so a pool recovers
    # after a managed failover without an app restart. See the Redis HA note in
    # CLAUDE.md / PRODUCTION_READINESS.md.
    redis_socket_timeout: float = Field(default=2.0, alias="REDIS_SOCKET_TIMEOUT")
    redis_connect_timeout: float = Field(default=2.0, alias="REDIS_CONNECT_TIMEOUT")
    redis_health_check_interval: int = Field(default=30, alias="REDIS_HEALTH_CHECK_INTERVAL")

    db_pool_size: int = Field(default=20, alias="DB_POOL_SIZE")
    db_max_overflow: int = Field(default=40, alias="DB_MAX_OVERFLOW")
    db_pool_recycle_seconds: int = Field(default=1800, alias="DB_POOL_RECYCLE_SECONDS")
    db_pool_timeout_seconds: int = Field(default=30, alias="DB_POOL_TIMEOUT_SECONDS")

    rate_limit_login_per_min: int = Field(default=5, alias="RATE_LIMIT_LOGIN_PER_MIN")
    rate_limit_refresh_per_min: int = Field(default=10, alias="RATE_LIMIT_REFRESH_PER_MIN")
    rate_limit_forgot_per_hour: int = Field(default=3, alias="RATE_LIMIT_FORGOT_PER_HOUR")
    # Per-IP/hour budget on the unauthenticated resend-activation endpoint
    # (/auth/request-verify-token), which emails an activation link. Mirrors the
    # forgot-password throttle: account-enumeration-safe (always 202) but an
    # email-bomb vector without a limit.
    rate_limit_verify_request_per_hour: int = Field(
        default=5, alias="RATE_LIMIT_VERIFY_REQUEST_PER_HOUR"
    )
    # Per-IP/hour budget on the PUBLIC free-tier signup endpoint (/auth/signup),
    # which emails an activation link to a brand-new org-less account. Same
    # email-bomb / enumeration posture as forgot-password and request-verify:
    # always 202, never reveals whether the address exists. Only mounted when
    # FREE_TIER_ENABLED — org/founding-partner onboarding stays invite-only.
    rate_limit_signup_per_hour: int = Field(default=5, alias="RATE_LIMIT_SIGNUP_PER_HOUR")
    # Per-user/hour budgets on the expensive authenticated endpoints (synchronous
    # arbiter compliance check, puppeteer report pipeline, upload presign churn,
    # admin invite/resend email fan-out).
    rate_limit_compliance_per_hour: int = Field(default=20, alias="RATE_LIMIT_COMPLIANCE_PER_HOUR")
    rate_limit_report_per_hour: int = Field(default=10, alias="RATE_LIMIT_REPORT_PER_HOUR")
    rate_limit_upload_initiate_per_hour: int = Field(
        default=100, alias="RATE_LIMIT_UPLOAD_INITIATE_PER_HOUR"
    )
    # Per-user/hour budget shared by invite_member + resend_invite (each sends an
    # email, so an unthrottled admin is a mail-bomb / account-enumeration vector).
    rate_limit_invite_per_hour: int = Field(default=30, alias="RATE_LIMIT_INVITE_PER_HOUR")
    # Per-IP/hour budget on the PUBLIC capture-link upload-initiate (unauthenticated
    # presigned-PUT minting). Generous for a real field photo-upload burst, bounded
    # against abuse. Per-IP, so workers behind one site NAT share it.
    rate_limit_capture_initiate_per_hour: int = Field(
        default=120, alias="RATE_LIMIT_CAPTURE_INITIATE_PER_HOUR"
    )
    # Per-account login lockout (H6): a second throttle keyed on the normalized
    # email, independent of source IP, that the per-IP login limiter cannot see.
    # After `max_attempts` failures within `window` seconds the account locks for
    # `base` seconds, doubling per consecutive lockout up to `max` seconds. The
    # counter resets on a successful login / password reset / super-admin unlock.
    login_lockout_max_attempts: int = Field(default=10, alias="LOGIN_LOCKOUT_MAX_ATTEMPTS")
    login_lockout_window_seconds: int = Field(
        default=900, alias="LOGIN_LOCKOUT_WINDOW_SECONDS"
    )
    login_lockout_base_seconds: int = Field(default=900, alias="LOGIN_LOCKOUT_BASE_SECONDS")
    login_lockout_max_seconds: int = Field(default=86400, alias="LOGIN_LOCKOUT_MAX_SECONDS")
    # Comma-separated IPs of trusted reverse proxies sitting directly in front
    # of the API. Rate-limit client identity uses the raw `request.client.host`
    # by default and only honors `X-Forwarded-For` when the immediate peer is
    # in this allowlist — otherwise an attacker rotates the header to mint a
    # fresh login/refresh bucket per request and defeats the throttle. Empty
    # (the default) means trust nothing: always key on the real peer IP.
    trusted_proxy_ips: str = Field(default="", alias="TRUSTED_PROXY_IPS")
    # uvicorn's `--forwarded-allow-ips` / `$FORWARDED_ALLOW_IPS`: the proxy IPs or
    # CIDRs whose `X-Forwarded-For` uvicorn trusts to rewrite `request.client.host`
    # (proxy_headers is on by default). Mirrors uvicorn's own default so the boot
    # guard and the secret-source audit can SEE what uvicorn will trust. The
    # literal `*` makes uvicorn trust XFF from any peer (taking the spoofable
    # left-most hop), re-opening the rate-limit bypass below the app identifier —
    # the production guard rejects it. In prod set the real reverse-proxy /
    # load-balancer subnet; dev keeps the safe loopback default.
    forwarded_allow_ips: str = Field(default="127.0.0.1", alias="FORWARDED_ALLOW_IPS")

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
    # Coarse global cap on the raw HTTP request body, enforced by
    # RequestBodySizeLimitMiddleware. Large files (IFC/3D models, attachments)
    # bypass the API entirely — they go straight to MinIO via presigned PUT — so
    # this is deliberately decoupled from (and far smaller than) upload_max_bytes.
    # The only large body that legitimately transits the API is a BCF import zip.
    request_body_max_bytes: int = Field(default=100 * 1024 * 1024, alias="REQUEST_BODY_MAX_BYTES")
    # Per-endpoint cap on the BCF import upload (a zip parsed in-process). Tighter
    # than the global cap; the structural zip-bomb guards live in bcf/parser.py.
    bcf_import_max_bytes: int = Field(default=50 * 1024 * 1024, alias="BCF_IMPORT_MAX_BYTES")
    attachment_max_bytes: int = Field(default=500 * 1024 * 1024, alias="ATTACHMENT_MAX_BYTES")
    thumbnail_max_bytes: int = Field(default=2 * 1024 * 1024, alias="THUMBNAIL_MAX_BYTES")
    thumbnail_allowed_content_types: str = Field(
        default="image/jpeg,image/png,image/webp", alias="THUMBNAIL_ALLOWED_CONTENT_TYPES"
    )
    capture_link_max_ttl_hours: int = Field(default=720, alias="CAPTURE_LINK_MAX_TTL_HOURS")

    frontend_capture_url: str = Field(
        default="http://localhost:3001/capture", alias="FRONTEND_CAPTURE_URL"
    )

    processor_url: str = Field(default="http://localhost:8088", alias="PROCESSOR_URL")
    # Where the processor should POST its job callbacks back to (L13). Stamped on
    # each dispatch as `callback_url` so the worker reaches THIS API instance
    # rather than a single baked address — the seam that makes multi-API /
    # blue-green deployments safe. Must be the address the processor can reach the
    # API at (behind a proxy/LB: the internal service URL, not localhost).
    api_base_url: str = Field(default="http://localhost:8000", alias="API_BASE_URL")
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

    # Structured application logging (see logging_config.py). LOG_LEVEL is the
    # root logger level; LOG_FORMAT selects the stdout shape ("json" for log
    # aggregation, "console" for human-readable dev). LOG_FORMAT left unset
    # resolves via `resolved_log_format` to json in a production posture and
    # console under DEPLOY_REGION=dev.
    log_level: str = Field(default="INFO", alias="LOG_LEVEL")
    log_format: str | None = Field(default=None, alias="LOG_FORMAT")

    max_concurrent_jobs_per_org: int = Field(default=10, alias="MAX_CONCURRENT_JOBS_PER_ORG")

    # Single-queue job priority by user tier (BullMQ: lower number = higher
    # priority, unset = 0). Paying jobs sort ahead of free-tier jobs on the one
    # shared `jobs` queue. The gap between the two leaves room for a future paid
    # sub-tier (e.g. founding_partner ~5) without a schema change. See
    # jobs/priority.py and docs/free-wedge-implementation-plan.md (D5).
    job_priority_paying: int = Field(default=10, alias="JOB_PRIORITY_PAYING")
    job_priority_free: int = Field(default=100, alias="JOB_PRIORITY_FREE")
    # Global cap on concurrent free-tier extractions (operationally
    # JOB_CONCURRENCY - 1) so free jobs can never occupy every processor slot and
    # starve paying work — priority orders the queue but does not preempt a
    # running job. Enforced at the free-dispatch site (free-wedge Phase 2).
    pooled_extraction_concurrency_global: int = Field(
        default=1, alias="POOLED_EXTRACTION_CONCURRENCY_GLOBAL"
    )
    # Master kill-switch for the whole free-tier ("free wedge") surface: public
    # signup route mounting, every /free/* endpoint, the portal route group. Off
    # by default so the feature ships dark and is flipped on for a capped cohort
    # at soft-launch. A flag only SOME surfaces honor is a half-open door — gate
    # every surface on this. See docs/free-wedge-implementation-plan.md.
    free_tier_enabled: bool = Field(default=False, alias="FREE_TIER_ENABLED")
    # Per-model size cap for free uploads (D4) — well under the 2 GB tenant cap,
    # covers the gevolgklasse-1 ICP while bounding processor + storage cost.
    free_upload_max_bytes: int = Field(
        default=250 * 1024 * 1024, alias="FREE_UPLOAD_MAX_BYTES"
    )
    # Per-user CONTAINER cap (pooled_documents) — a coarse backstop alongside the
    # aggregate storage cap. (Each container holds versioned model files.)
    # Env alias kept as the legacy FREE_MAX_MODELS_PER_USER for back-compat.
    free_max_documents_per_user: int = Field(default=5, alias="FREE_MAX_MODELS_PER_USER")
    # Per-user PROJECT cap (owned pooled_projects; shared projects don't count). The
    # "multiple projects" allowance for a free user — tunable so the cohort limit
    # can be widened/narrowed without a code change. Enforced at project-create.
    free_max_projects_per_user: int = Field(
        default=3, alias="FREE_MAX_PROJECTS_PER_USER"
    )
    # Per-project INVITED-member cap (the owner is not counted, so owner + cap =
    # total seats). The "add up to N collaborators" allowance — tunable. Enforced
    # at member-invite.
    free_max_members_per_project: int = Field(
        default=3, alias="FREE_MAX_MEMBERS_PER_PROJECT"
    )
    # Per-user FINDINGS (snags) cap — a coarse backstop on the only otherwise
    # unbounded write on the shared public heap (findings carry no storage bytes,
    # so they escape the aggregate byte cap). GLOBAL env cap (like
    # `free_upload_max_bytes`), keyed on the project OWNER. Enforced at snag-create.
    free_max_findings_per_user: int = Field(
        default=200, alias="FREE_MAX_FINDINGS_PER_USER"
    )
    # Per-user AGGREGATE storage cap (the 1 GB ceiling) — the binding constraint
    # on a free user's footprint. Enforced at upload-initiate against the sum of
    # the owner's own model bytes (members can't upload, so it is owner-only).
    free_storage_max_bytes: int = Field(
        default=1024 ** 3, alias="FREE_STORAGE_MAX_BYTES"
    )
    # Free-account TRIAL window in days, anchored on `users.created_at`. After it
    # elapses the account goes READ-ONLY (every free write returns 403
    # FREE_ACCOUNT_EXPIRED) to nudge an upgrade; existing data stays viewable.
    # This is the GLOBAL default — a super-admin can override (or exempt) a single
    # account via `public.free_user_limits`. Starts at 90; intended to tighten to
    # ~30 later, which is a pure env change. See free_limits.resolve_free_limits.
    free_account_max_age_days: int = Field(
        default=90, alias="FREE_ACCOUNT_MAX_AGE_DAYS"
    )
    # Per-user/hour presign churn on the free upload-initiate endpoint.
    rate_limit_free_upload_initiate_per_hour: int = Field(
        default=30, alias="RATE_LIMIT_FREE_UPLOAD_INITIATE_PER_HOUR"
    )
    # Per-user/hour write budget on free finding (snag) create + update — bounds
    # churn on the shared public heap alongside the FREE_MAX_FINDINGS_PER_USER cap.
    rate_limit_free_finding_write_per_hour: int = Field(
        default=120, alias="RATE_LIMIT_FREE_FINDING_WRITE_PER_HOUR"
    )
    # Max concurrent in-flight free extractions for a single user (queued+running).
    pooled_extraction_concurrency_per_user: int = Field(
        default=1, alias="POOLED_EXTRACTION_CONCURRENCY_PER_USER"
    )
    # Geometry tessellation threshold for the FREE extraction path — higher than
    # the paid default of 1 (which meshes every element) to shrink frag size +
    # meshing time. The paid path keeps threshold 1 and its visibility test green.
    pooled_job_geometry_threshold: int = Field(
        default=10, alias="POOLED_JOB_GEOMETRY_THRESHOLD"
    )
    # A free container untouched (no viewer-bundle GET) for this many days is reaped.
    # Env alias kept as the legacy FREE_MODEL_IDLE_TTL_DAYS for back-compat.
    pooled_document_idle_ttl_days: int = Field(default=30, alias="FREE_MODEL_IDLE_TTL_DAYS")
    # How often the idle-free-model reaper runs (the TTL is in days, so a long
    # interval is fine). 0 disables it.
    pooled_idle_sweep_interval_minutes: int = Field(
        default=360, alias="POOLED_IDLE_SWEEP_INTERVAL_MINUTES"
    )

    # Ceiling on custom fields per finding template (env-authoritative; the
    # Pydantic MAX_TEMPLATE_FIELDS constant is the UX guardrail mirrored in Zod).
    max_template_fields: int = Field(default=30, alias="MAX_TEMPLATE_FIELDS")

    arbiter_url: str = Field(default="http://localhost:8090", alias="ARBITER_URL")
    arbiter_timeout_seconds: float = Field(default=30.0, alias="ARBITER_TIMEOUT_SECONDS")
    # No dev default (see processor_shared_secret) — a forgotten prod value fails
    # closed instead of calling the rule-rewriting Arbiter MCP unauthenticated.
    # Both services must agree (mirror of PROCESSOR_SHARED_SECRET).
    arbiter_shared_secret: str = Field(alias="ARBITER_SHARED_SECRET")

    deploy_region: str = Field(default="dev", alias="DEPLOY_REGION")
    deploy_node: str = Field(default="local", alias="DEPLOY_NODE")

    @property
    def resolved_log_format(self) -> str:
        """Effective stdout log format: ``"json"`` or ``"console"``.

        An explicit LOG_FORMAT wins (any unrecognised value is ignored). When
        unset, default to structured ``json`` everywhere except an explicit dev
        region, which gets human-readable ``console`` output.
        """
        if self.log_format:
            candidate = self.log_format.strip().lower()
            if candidate in ("json", "console"):
                return candidate
        return "console" if self.deploy_region == "dev" else "json"

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def trusted_proxy_ip_set(self) -> frozenset[str]:
        """Set of trusted reverse-proxy IPs whose `X-Forwarded-For` may be
        honored for rate-limit client identity. Empty by default."""
        return frozenset(ip.strip() for ip in self.trusted_proxy_ips.split(",") if ip.strip())

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
DEV_ARBITER_SHARED_SECRET = "dev-arbiter-secret-change-me"
MIN_JWT_SECRET_LENGTH = 32

# (settings attr, env var name, known dev value). The guard refuses to boot when
# any of these still holds its dev value and we are not explicitly in dev.
_DEV_VALUED_SECRETS: tuple[tuple[str, str, str], ...] = (
    ("s3_access_key_id", "S3_ACCESS_KEY_ID", DEV_S3_ACCESS_KEY_ID),
    ("s3_secret_access_key", "S3_SECRET_ACCESS_KEY", DEV_S3_SECRET_ACCESS_KEY),
    ("processor_shared_secret", "PROCESSOR_SHARED_SECRET", DEV_PROCESSOR_SHARED_SECRET),
    ("arbiter_shared_secret", "ARBITER_SHARED_SECRET", DEV_ARBITER_SHARED_SECRET),
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
    if "*" in [hop.strip() for hop in settings.forwarded_allow_ips.split(",")]:
        errors.append(
            "FORWARDED_ALLOW_IPS contains '*'; uvicorn would trust X-Forwarded-For "
            "from any peer (spoofable). Set the explicit proxy IP/CIDR (e.g. the "
            "load-balancer subnet)."
        )
    if "*" in settings.trusted_proxy_ip_set:
        errors.append("TRUSTED_PROXY_IPS contains '*'; list explicit proxy IPs.")
    if len(settings.jwt_secret) < MIN_JWT_SECRET_LENGTH:
        errors.append(
            f"JWT_SECRET is shorter than {MIN_JWT_SECRET_LENGTH} chars; use a strong random secret."
        )
    if settings.ws_max_lifetime_seconds > settings.jwt_access_ttl_seconds:
        errors.append(
            "WS_MAX_LIFETIME_SECONDS exceeds JWT_ACCESS_TTL_SECONDS; a notification socket "
            "could outlive its access token, defeating the revalidation lifetime cap."
        )
    # Free-tier guardrails: only meaningful once the wedge is live. A free tier
    # with no real caps lets public signups starve the shared processor / blow up
    # storage, so refuse to boot with dangerous defaults (mirrors the dev-secret
    # refusals above).
    if settings.free_tier_enabled:
        if settings.pooled_extraction_concurrency_global < 1:
            errors.append(
                "FREE_TIER_ENABLED is on but POOLED_EXTRACTION_CONCURRENCY_GLOBAL < 1; "
                "set a positive global cap (operationally JOB_CONCURRENCY - 1) so free "
                "extractions can never hold every processor slot."
            )
        if settings.pooled_extraction_concurrency_global > 50:
            errors.append(
                "FREE_TIER_ENABLED is on but POOLED_EXTRACTION_CONCURRENCY_GLOBAL is "
                "effectively unbounded (>50); a long free extraction could starve "
                "paying jobs. Set it to roughly JOB_CONCURRENCY - 1."
            )
        if settings.free_max_documents_per_user < 1:
            errors.append(
                "FREE_TIER_ENABLED is on but FREE_MAX_MODELS_PER_USER < 1; set a "
                "positive per-user container cap to bound storage."
            )
        if settings.free_max_projects_per_user < 1:
            errors.append(
                "FREE_TIER_ENABLED is on but FREE_MAX_PROJECTS_PER_USER < 1; set a "
                "positive per-user project cap (a free user needs at least one)."
            )
        if settings.free_max_members_per_project < 1:
            errors.append(
                "FREE_TIER_ENABLED is on but FREE_MAX_MEMBERS_PER_PROJECT < 1; set a "
                "positive per-project invited-member cap."
            )
        if settings.free_upload_max_bytes < 1:
            errors.append(
                "FREE_TIER_ENABLED is on but FREE_UPLOAD_MAX_BYTES < 1; set a positive "
                "per-model size cap."
            )
        if settings.free_storage_max_bytes < settings.free_upload_max_bytes:
            errors.append(
                "FREE_TIER_ENABLED is on but FREE_STORAGE_MAX_BYTES is below "
                "FREE_UPLOAD_MAX_BYTES; the aggregate cap must be at least one "
                "model's worth or no upload can ever succeed."
            )
        if settings.free_account_max_age_days < 1:
            errors.append(
                "FREE_TIER_ENABLED is on but FREE_ACCOUNT_MAX_AGE_DAYS < 1; set a "
                "positive trial window (a free account needs at least one day "
                "before it goes read-only), or grant individual exemptions."
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
        ("arbiter_shared_secret", "ARBITER_SHARED_SECRET"),
    ):
        source = "env" if attr in settings.model_fields_set else "DEFAULT"
        if attr in dev_values and getattr(settings, attr) == dev_values[attr]:
            logger.warning("  %s: source=%s — DEV-DEFAULT VALUE in use", env_name, source)
        else:
            logger.info("  %s: source=%s", env_name, source)

    # Surface the effective reverse-proxy trust so an operator can confirm uvicorn
    # is resolving real client IPs (rate-limit buckets + audit logs). The loopback
    # default outside dev usually means "behind a proxy but no trust configured",
    # so every client collapses onto the proxy IP and shares one rate-limit bucket.
    fai_source = "env" if "forwarded_allow_ips" in settings.model_fields_set else "DEFAULT"
    logger.info("  FORWARDED_ALLOW_IPS=%r (source=%s)", settings.forwarded_allow_ips, fai_source)
    if not dev_skip and settings.forwarded_allow_ips.strip() == "127.0.0.1":
        logger.warning(
            "  FORWARDED_ALLOW_IPS is the loopback default in a production posture — "
            "if the API sits behind a reverse proxy, set it to the proxy IP/CIDR so "
            "rate limits key on the real client instead of the proxy."
        )

    # Redis is launch-critical: the rate limiter fails open and the JWT blocklist
    # fails closed on a Redis outage, so a single-node localhost Redis in prod is a
    # SPOF for the whole authenticated surface. Warn (not fail) — local-socket /
    # sidecar deployments are legitimate; production should point at HA Redis with
    # AOF persistence (see CLAUDE.md / PRODUCTION_READINESS.md).
    redis_host = (urlparse(settings.redis_url).hostname or "").lower()
    if not dev_skip and redis_host in {"localhost", "127.0.0.1", "::1"}:
        logger.warning(
            "  REDIS_URL points at localhost in a production posture — production "
            "Redis must be highly available (managed/replicated with failover) and "
            "have AOF persistence enabled; a single-node Redis is a SPOF for auth."
        )
