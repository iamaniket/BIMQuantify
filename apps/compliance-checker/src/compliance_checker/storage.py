from __future__ import annotations

import json
from typing import Any

import aioboto3
from botocore.config import Config as BotoConfig

from compliance_checker.config import Settings


class ArtifactReader:
    """Reads extractor artifacts (metadata.json, properties.json) from S3/MinIO."""

    def __init__(self, settings: Settings) -> None:
        self._session = aioboto3.Session()
        self._endpoint = settings.s3_endpoint_url
        self._region = settings.s3_region
        self._access = settings.s3_access_key_id
        self._secret = settings.s3_secret_access_key
        self._bucket = settings.s3_bucket_ifc

    def _client(self) -> Any:
        return self._session.client(
            "s3",
            endpoint_url=self._endpoint,
            region_name=self._region,
            aws_access_key_id=self._access,
            aws_secret_access_key=self._secret,
            config=BotoConfig(signature_version="s3v4"),
        )

    async def get_object(self, key: str) -> bytes:
        async with self._client() as client:
            response = await client.get_object(Bucket=self._bucket, Key=key)
            body = response["Body"]
            return await body.read()  # type: ignore[no-any-return]

    async def get_json(self, key: str) -> dict[str, Any] | list[Any]:
        data = await self.get_object(key)
        return json.loads(data)  # type: ignore[no-any-return]
