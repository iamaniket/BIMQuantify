"""S3-compatible object storage for IFC uploads.

The default backend is `S3Storage` (boto3/aioboto3 against MinIO in dev or
AWS S3 in prod). `get_storage()` is the FastAPI dependency — tests override
it with an in-memory fake.
"""

from functools import lru_cache

from bimstitch_api.config import get_settings
from bimstitch_api.storage.minio import S3Storage, StorageBackend

__all__ = ["S3Storage", "StorageBackend", "get_storage"]


@lru_cache
def get_storage() -> StorageBackend:
    return S3Storage(get_settings())
