from functools import lru_cache

from pydantic import EmailStr, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    database_url: str = Field(alias="DATABASE_URL")
    test_database_url: str | None = Field(default=None, alias="TEST_DATABASE_URL")

    jwt_secret: str = Field(alias="JWT_SECRET")
    jwt_access_ttl_seconds: int = Field(default=900, alias="JWT_ACCESS_TTL_SECONDS")
    jwt_refresh_ttl_seconds: int = Field(default=604800, alias="JWT_REFRESH_TTL_SECONDS")

    smtp_host: str = Field(default="localhost", alias="SMTP_HOST")
    smtp_port: int = Field(default=1025, alias="SMTP_PORT")
    smtp_from: EmailStr = Field(default="no-reply@bimstitch.dev", alias="SMTP_FROM")

    frontend_verify_url: str = Field(
        default="http://localhost:3000/auth/verify", alias="FRONTEND_VERIFY_URL"
    )
    frontend_reset_password_url: str = Field(
        default="http://localhost:3000/auth/reset-password", alias="FRONTEND_RESET_PASSWORD_URL"
    )

    cors_origins: str = Field(default="http://localhost:3000", alias="CORS_ORIGINS")

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

    extractor_url: str = Field(default="http://localhost:8088", alias="EXTRACTOR_URL")
    extractor_shared_secret: str = Field(
        default="dev-shared-secret-change-me", alias="EXTRACTOR_SHARED_SECRET"
    )
    extractor_dispatch_timeout_seconds: float = Field(
        default=5.0, alias="EXTRACTOR_DISPATCH_TIMEOUT_SECONDS"
    )

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
