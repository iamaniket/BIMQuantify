from functools import lru_cache

from pydantic import EmailStr, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    database_url: str = Field(alias="DATABASE_URL")
    admin_database_url: str | None = Field(default=None, alias="BIMSTITCH_ADMIN_DATABASE_URL")
    test_database_url: str | None = Field(default=None, alias="TEST_DATABASE_URL")

    jwt_secret: str = Field(alias="JWT_SECRET")
    jwt_access_ttl_seconds: int = Field(default=900, alias="JWT_ACCESS_TTL_SECONDS")
    jwt_refresh_ttl_seconds: int = Field(default=604800, alias="JWT_REFRESH_TTL_SECONDS")
    invite_token_ttl_seconds: int = Field(default=604800, alias="INVITE_TOKEN_TTL_SECONDS")
    invitation_ttl_days: int = Field(default=14, alias="INVITATION_TTL_DAYS")
    invitation_sweep_interval_minutes: int = Field(
        default=60, alias="INVITATION_SWEEP_INTERVAL_MINUTES"
    )

    smtp_host: str = Field(default="localhost", alias="SMTP_HOST")
    smtp_port: int = Field(default=1025, alias="SMTP_PORT")
    smtp_from: EmailStr = Field(default="no-reply@bimstitch.dev", alias="SMTP_FROM")

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
        default="http://localhost:3001/invitations", alias="FRONTEND_INVITATIONS_URL"
    )

    cors_origins: str = Field(default="http://localhost:3000", alias="CORS_ORIGINS")
    cors_origin_regex: str | None = Field(default=None, alias="CORS_ORIGIN_REGEX")

    redis_url: str = Field(default="redis://localhost:6380/0", alias="REDIS_URL")
    test_redis_url: str | None = Field(default=None, alias="TEST_REDIS_URL")

    rate_limit_login_per_min: int = Field(default=5, alias="RATE_LIMIT_LOGIN_PER_MIN")
    rate_limit_register_per_hour: int = Field(default=3, alias="RATE_LIMIT_REGISTER_PER_HOUR")
    rate_limit_refresh_per_min: int = Field(default=10, alias="RATE_LIMIT_REFRESH_PER_MIN")
    rate_limit_forgot_per_hour: int = Field(default=3, alias="RATE_LIMIT_FORGOT_PER_HOUR")

    s3_endpoint_url: str = Field(default="http://localhost:9000", alias="S3_ENDPOINT_URL")
    s3_region: str = Field(default="us-east-1", alias="S3_REGION")
    s3_access_key_id: str = Field(default="bimstitch", alias="S3_ACCESS_KEY_ID")
    s3_secret_access_key: str = Field(default="bimstitch-secret", alias="S3_SECRET_ACCESS_KEY")
    s3_bucket_ifc: str = Field(default="ifc-files", alias="S3_BUCKET_IFC")
    s3_presign_ttl_seconds: int = Field(default=900, alias="S3_PRESIGN_TTL_SECONDS")
    upload_max_bytes: int = Field(default=2 * 1024 * 1024 * 1024, alias="UPLOAD_MAX_BYTES")
    thumbnail_max_bytes: int = Field(default=2 * 1024 * 1024, alias="THUMBNAIL_MAX_BYTES")
    thumbnail_allowed_content_types: str = Field(
        default="image/jpeg,image/png,image/webp", alias="THUMBNAIL_ALLOWED_CONTENT_TYPES"
    )

    processor_url: str = Field(default="http://localhost:8088", alias="PROCESSOR_URL")
    processor_shared_secret: str = Field(
        default="dev-shared-secret-change-me", alias="PROCESSOR_SHARED_SECRET"
    )
    processor_dispatch_timeout_seconds: float = Field(
        default=5.0, alias="PROCESSOR_DISPATCH_TIMEOUT_SECONDS"
    )

    sentry_dsn: str | None = Field(default=None, alias="SENTRY_DSN")
    sentry_environment: str | None = Field(default=None, alias="SENTRY_ENVIRONMENT")
    sentry_traces_sample_rate: float = Field(default=0.1, alias="SENTRY_TRACES_SAMPLE_RATE")
    sentry_release: str | None = Field(default=None, alias="SENTRY_RELEASE")

    arbiter_url: str = Field(default="http://localhost:8090", alias="ARBITER_URL")
    arbiter_timeout_seconds: float = Field(default=30.0, alias="ARBITER_TIMEOUT_SECONDS")

    deploy_region: str = Field(default="dev", alias="DEPLOY_REGION")
    deploy_node: str = Field(default="local", alias="DEPLOY_NODE")

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
