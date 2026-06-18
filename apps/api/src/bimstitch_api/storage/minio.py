"""Async S3 wrapper. Targets MinIO in dev and any S3-compatible service in prod.

Tests bypass this with a FakeStorage via dependency override; this file is not
exercised by the test suite directly.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any, Protocol

import aioboto3
from botocore.client import Config
from botocore.exceptions import ClientError

if TYPE_CHECKING:
    from bimstitch_api.config import Settings


logger = logging.getLogger(__name__)


class ObjectNotFoundError(Exception):
    """Raised when an S3 object does not exist."""


class StorageBackend(Protocol):
    async def presigned_put_url(
        self, key: str, content_type: str, content_length: int, *, bucket: str | None = None
    ) -> str: ...

    async def presigned_get_url(
        self, key: str, filename: str, *, disposition: str = "attachment", bucket: str | None = None
    ) -> str: ...

    async def put_object(
        self, key: str, content_type: str, data: bytes, *, bucket: str | None = None
    ) -> None: ...

    async def head_object(self, key: str, *, bucket: str | None = None) -> dict[str, object]: ...

    async def get_object_range(
        self, key: str, start: int, end: int, *, bucket: str | None = None
    ) -> bytes: ...

    async def delete_object(self, key: str, *, bucket: str | None = None) -> None: ...

    async def copy_object(
        self, source_key: str, dest_key: str, *, bucket: str | None = None
    ) -> None: ...

    async def ensure_bucket(self, bucket: str | None = None) -> None: ...

    @property
    def presign_ttl(self) -> int: ...


class S3Storage:
    def __init__(self, settings: Settings) -> None:
        self._session = aioboto3.Session()
        self._endpoint = settings.s3_endpoint_url
        # Host the *client* must reach for presigned URLs (LAN/tunnel for phones).
        # Falls back to the internal endpoint, so dev presigns against localhost.
        self._public_endpoint = settings.s3_public_endpoint_url or settings.s3_endpoint_url
        self._region = settings.s3_region
        self._access = settings.s3_access_key_id
        self._secret = settings.s3_secret_access_key
        self._bucket = settings.s3_bucket_ifc
        self._ttl = settings.s3_presign_ttl_seconds
        self._cors_origins = settings.s3_cors_origin_list
        self._client_ctx: Any = None
        self._s3: Any = None
        # A second client bound to the public endpoint, lazily built only when it
        # differs from the internal one (SigV4 signs Host, so presigning against a
        # client whose endpoint matches the URL the client uses is required).
        self._presign_client_ctx: Any = None
        self._presign_s3: Any = None

    @property
    def presign_ttl(self) -> int:
        return self._ttl

    def _client_config(self) -> Config:
        return Config(
            signature_version="s3v4",
            connect_timeout=5,
            read_timeout=10,
            retries={"max_attempts": 2, "mode": "standard"},
            max_pool_connections=15,
        )

    async def _get_client(self) -> Any:
        if self._s3 is None:
            self._client_ctx = self._session.client(
                "s3",
                endpoint_url=self._endpoint,
                region_name=self._region,
                aws_access_key_id=self._access,
                aws_secret_access_key=self._secret,
                config=self._client_config(),
            )
            self._s3 = await self._client_ctx.__aenter__()
        return self._s3

    async def _get_presign_client(self) -> Any:
        """Client used solely to generate presigned URLs. When the public endpoint
        equals the internal one (the common/dev case) this reuses the internal
        client; otherwise it lazily builds a separate client so URLs are signed
        against the host the client will actually request."""
        if self._public_endpoint == self._endpoint:
            return await self._get_client()
        if self._presign_s3 is None:
            self._presign_client_ctx = self._session.client(
                "s3",
                endpoint_url=self._public_endpoint,
                region_name=self._region,
                aws_access_key_id=self._access,
                aws_secret_access_key=self._secret,
                config=self._client_config(),
            )
            self._presign_s3 = await self._presign_client_ctx.__aenter__()
        return self._presign_s3

    async def close(self) -> None:
        if self._client_ctx is not None:
            try:
                await self._client_ctx.__aexit__(None, None, None)
            except Exception:
                logger.warning("Error closing S3 client", exc_info=True)
            finally:
                self._s3 = None
                self._client_ctx = None
        if self._presign_client_ctx is not None:
            try:
                await self._presign_client_ctx.__aexit__(None, None, None)
            except Exception:
                logger.warning("Error closing S3 presign client", exc_info=True)
            finally:
                self._presign_s3 = None
                self._presign_client_ctx = None

    def _resolve_bucket(self, bucket: str | None) -> str:
        return bucket if bucket is not None else self._bucket

    async def presigned_put_url(
        self, key: str, content_type: str, content_length: int, *, bucket: str | None = None
    ) -> str:
        client = await self._get_presign_client()
        url: str = await client.generate_presigned_url(
            "put_object",
            Params={
                "Bucket": self._resolve_bucket(bucket),
                "Key": key,
                "ContentType": content_type,
                "ContentLength": content_length,
            },
            ExpiresIn=self._ttl,
        )
        return url

    async def presigned_get_url(
        self, key: str, filename: str, *, disposition: str = "attachment", bucket: str | None = None
    ) -> str:
        client = await self._get_presign_client()
        url: str = await client.generate_presigned_url(
            "get_object",
            Params={
                "Bucket": self._resolve_bucket(bucket),
                "Key": key,
                "ResponseContentDisposition": f'{disposition}; filename="{filename}"',
            },
            ExpiresIn=self._ttl,
        )
        return url

    async def put_object(
        self, key: str, content_type: str, data: bytes, *, bucket: str | None = None
    ) -> None:
        client = await self._get_client()
        await client.put_object(
            Bucket=self._resolve_bucket(bucket),
            Key=key,
            Body=data,
            ContentType=content_type,
        )

    async def head_object(self, key: str, *, bucket: str | None = None) -> dict[str, object]:
        client = await self._get_client()
        try:
            response: dict[str, object] = await client.head_object(
                Bucket=self._resolve_bucket(bucket), Key=key
            )
            return response
        except ClientError as exc:
            code = exc.response.get("Error", {}).get("Code", "")
            if code in {"404", "NoSuchKey", "NotFound"}:
                raise ObjectNotFoundError(key) from exc
            raise

    async def get_object_range(
        self, key: str, start: int, end: int, *, bucket: str | None = None
    ) -> bytes:
        client = await self._get_client()
        response = await client.get_object(
            Bucket=self._resolve_bucket(bucket), Key=key, Range=f"bytes={start}-{end}"
        )
        body = response["Body"]
        data: bytes = await body.read()
        return data

    async def delete_object(self, key: str, *, bucket: str | None = None) -> None:
        client = await self._get_client()
        await client.delete_object(Bucket=self._resolve_bucket(bucket), Key=key)

    async def copy_object(
        self, source_key: str, dest_key: str, *, bucket: str | None = None
    ) -> None:
        resolved = self._resolve_bucket(bucket)
        client = await self._get_client()
        await client.copy_object(
            Bucket=resolved,
            Key=dest_key,
            CopySource={"Bucket": resolved, "Key": source_key},
        )

    async def ensure_bucket(self, bucket: str | None = None) -> None:
        resolved = self._resolve_bucket(bucket)
        client = await self._get_client()
        try:
            await client.head_bucket(Bucket=resolved)
        except ClientError as exc:
            code = exc.response.get("Error", {}).get("Code", "")
            if code in {"404", "NoSuchBucket", "NotFound"}:
                await client.create_bucket(Bucket=resolved)
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
        try:
            await client.put_bucket_cors(
                Bucket=resolved, CORSConfiguration=cors_config
            )
        except ClientError as exc:
            code = exc.response.get("Error", {}).get("Code", "")
            if code == "NotImplemented":
                logger.debug(
                    "put_bucket_cors is not supported by this storage backend; "
                    "configure CORS on the storage server directly"
                )
            else:
                raise
