from functools import lru_cache
from pathlib import Path

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    s3_endpoint_url: str = Field(default="http://localhost:9000", alias="S3_ENDPOINT_URL")
    s3_region: str = Field(default="us-east-1", alias="S3_REGION")
    s3_access_key_id: str = Field(default="bimstitch", alias="S3_ACCESS_KEY_ID")
    s3_secret_access_key: str = Field(default="bimstitch-secret", alias="S3_SECRET_ACCESS_KEY")
    s3_bucket_ifc: str = Field(default="ifc-files", alias="S3_BUCKET_IFC")

    host: str = Field(
        default="0.0.0.0",
        validation_alias=AliasChoices("COMPLIANCE_HOST", "BBL_HOST"),
    )
    port: int = Field(
        default=8090,
        validation_alias=AliasChoices("COMPLIANCE_PORT", "BBL_PORT"),
    )
    rules_dir: str = Field(
        default="rules",
        validation_alias=AliasChoices("COMPLIANCE_RULES_DIR", "BBL_RULES_DIR"),
    )

    sync_enabled: bool = Field(default=True, alias="COMPLIANCE_SYNC_ENABLED")
    sync_interval_hours: int = Field(default=24, alias="COMPLIANCE_SYNC_INTERVAL_HOURS")
    sync_auto_apply: bool = Field(default=False, alias="COMPLIANCE_SYNC_AUTO_APPLY")

    @property
    def rules_path(self) -> Path:
        return Path(self.rules_dir)


@lru_cache
def get_settings() -> Settings:
    return Settings()
