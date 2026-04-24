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
    smtp_from: EmailStr = Field(default="no-reply@bimquantify.dev", alias="SMTP_FROM")

    frontend_verify_url: str = Field(
        default="http://localhost:3000/auth/verify", alias="FRONTEND_VERIFY_URL"
    )
    frontend_reset_password_url: str = Field(
        default="http://localhost:3000/auth/reset-password", alias="FRONTEND_RESET_PASSWORD_URL"
    )

    cors_origins: str = Field(default="http://localhost:3000", alias="CORS_ORIGINS")

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
