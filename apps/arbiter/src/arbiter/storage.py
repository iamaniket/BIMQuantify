from __future__ import annotations

import json
import re
from typing import TYPE_CHECKING, Any

import aioboto3
from botocore.config import Config as BotoConfig

if TYPE_CHECKING:
    from arbiter.config import Settings

# Extraction artifact keys are code-generated and deterministic: the API mints
# the source key as ``projects/{uuid}/{kind}/{uuid4}.ifc`` (upload_service.py) and
# the processor derives ``<source>.metadata.json`` / ``<source>.properties.json``
# (apps/processor/src/storage/s3.ts). So a legitimate key only ever uses this
# conservative charset — no spaces, no user filename, no traversal.
_ARTIFACT_KEY_RE = re.compile(r"^[A-Za-z0-9._/-]+$")


def validate_artifact_key(key: str, *, suffix: str) -> str:
    """Validate a caller-supplied S3 artifact key before any read.

    The Arbiter reads from one flat, multi-tenant IFC bucket, so a hostile or
    malformed key (path traversal, an absolute path, or a different object type)
    would cross tenants or read the wrong artifact. We reject anything that does
    not look like a deterministic extraction artifact — cheaply, without coupling
    to the exact bucket prefix. ``suffix`` pins the object type per parameter
    (``.metadata.json`` vs ``.properties.json``). Raises ``ValueError`` so the
    MCP tool surfaces a tool-error rather than reading the object.
    """
    if not key:
        raise ValueError("artifact key must be a non-empty string")
    if ".." in key or "\\" in key:
        raise ValueError("artifact key must not contain '..' or backslashes")
    if key.startswith("/") or "://" in key:
        raise ValueError("artifact key must be a relative bucket key, not an absolute path or URL")
    if not _ARTIFACT_KEY_RE.match(key):
        raise ValueError("artifact key contains disallowed characters")
    if not key.endswith(suffix):
        raise ValueError(f"artifact key must end with '{suffix}'")
    return key


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
