"""Async S3 wrapper. Targets MinIO in dev and any S3-compatible service in prod.

Tests bypass this with a FakeStorage via dependency override; this file is not
exercised by the test suite directly.
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import TYPE_CHECKING, Protocol

import aioboto3
from botocore.client import Config
from botocore.exceptions import ClientError

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

    from bimstitch_api.config import Settings


logger = logging.getLogger(__name__)


class ObjectNotFoundError(Exception):
    """Raised when an S3 object does not exist."""


class StorageBackend(Protocol):
    async def presigned_put_url(self, key: str, content_type: str, content_length: int) -> str: ...

    async def presigned_get_url(self, key: str, filename: str) -> str: ...

    async def put_object(self, key: str, content_type: str, data: bytes) -> None: ...

    async def head_object(self, key: str) -> dict[str, object]: ...

    async def get_object_range(self, key: str, start: int, end: int) -> bytes: ...

    async def delete_object(self, key: str) -> None: ...

    async def ensure_bucket(self) -> None: ...

    @property
    def presign_ttl(self) -> int: ...


class S3Storage:
    def __init__(self, settings: Settings) -> None:
        self._session = aioboto3.Session()
        self._endpoint = settings.s3_endpoint_url
        self._region = settings.s3_region
        self._access = settings.s3_access_key_id
        self._secret = settings.s3_secret_access_key
        self._bucket = settings.s3_bucket_ifc
        self._ttl = settings.s3_presign_ttl_seconds
        self._cors_origins = settings.cors_origin_list

    @property
    def presign_ttl(self) -> int:
        return self._ttl

    @asynccontextmanager
    async def _client(self) -> AsyncIterator[object]:
        async with self._session.client(
            "s3",
            endpoint_url=self._endpoint,
            region_name=self._region,
            aws_access_key_id=self._access,
            aws_secret_access_key=self._secret,
            config=Config(signature_version="s3v4"),
        ) as client:
            yield client

    async def presigned_put_url(self, key: str, content_type: str, content_length: int) -> str:
        async with self._client() as client:
            url: str = await client.generate_presigned_url(  # type: ignore[attr-defined]
                "put_object",
                Params={
                    "Bucket": self._bucket,
                    "Key": key,
                    "ContentType": content_type,
                    "ContentLength": content_length,
                },
                ExpiresIn=self._ttl,
            )
            return url

    async def presigned_get_url(self, key: str, filename: str) -> str:
        async with self._client() as client:
            url: str = await client.generate_presigned_url(  # type: ignore[attr-defined]
                "get_object",
                Params={
                    "Bucket": self._bucket,
                    "Key": key,
                    "ResponseContentDisposition": f'attachment; filename="{filename}"',
                },
                ExpiresIn=self._ttl,
            )
            return url

    async def put_object(self, key: str, content_type: str, data: bytes) -> None:
        async with self._client() as client:
            await client.put_object(  # type: ignore[attr-defined]
                Bucket=self._bucket,
                Key=key,
                Body=data,
                ContentType=content_type,
            )

    async def head_object(self, key: str) -> dict[str, object]:
        async with self._client() as client:
            try:
                response: dict[str, object] = await client.head_object(  # type: ignore[attr-defined]
                    Bucket=self._bucket, Key=key
                )
                return response
            except ClientError as exc:
                code = exc.response.get("Error", {}).get("Code", "")
                if code in {"404", "NoSuchKey", "NotFound"}:
                    raise ObjectNotFoundError(key) from exc
                raise

    async def get_object_range(self, key: str, start: int, end: int) -> bytes:
        async with self._client() as client:
            response = await client.get_object(  # type: ignore[attr-defined]
                Bucket=self._bucket, Key=key, Range=f"bytes={start}-{end}"
            )
            body = response["Body"]
            data: bytes = await body.read()
            return data

    async def delete_object(self, key: str) -> None:
        async with self._client() as client:
            await client.delete_object(Bucket=self._bucket, Key=key)  # type: ignore[attr-defined]

    async def ensure_bucket(self) -> None:
        async with self._client() as client:
            try:
                await client.head_bucket(Bucket=self._bucket)  # type: ignore[attr-defined]
            except ClientError as exc:
                code = exc.response.get("Error", {}).get("Code", "")
                if code in {"404", "NoSuchBucket", "NotFound"}:
                    await client.create_bucket(Bucket=self._bucket)  # type: ignore[attr-defined]
                else:
                    raise

            cors_config = {
                "CORSRules": [
                    {
                        "AllowedOrigins": self._cors_origins or ["*"],
                        "AllowedMethods": ["PUT", "GET", "HEAD"],
                        "AllowedHeaders": ["*"],
                        "ExposeHeaders": ["ETag"],
                        "MaxAgeSeconds": 3000,
                    }
                ]
            }
            await client.put_bucket_cors(  # type: ignore[attr-defined]
                Bucket=self._bucket, CORSConfiguration=cors_config
            )
