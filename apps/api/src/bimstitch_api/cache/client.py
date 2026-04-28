from collections.abc import AsyncGenerator

from redis.asyncio import Redis, from_url

from bimstitch_api.config import get_settings

_redis: Redis | None = None


def get_redis() -> Redis:
    global _redis
    if _redis is None:
        settings = get_settings()
        _redis = from_url(settings.redis_url, decode_responses=True)
    return _redis


async def get_redis_dep() -> AsyncGenerator[Redis, None]:
    yield get_redis()


async def close_redis() -> None:
    global _redis
    if _redis is not None:
        await _redis.aclose()
        _redis = None
