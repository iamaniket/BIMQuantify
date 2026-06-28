from collections.abc import AsyncGenerator

from redis.asyncio import ConnectionPool, Redis

from bimdossier_api.config import get_settings

_redis: Redis | None = None


def get_redis() -> Redis:
    global _redis
    if _redis is None:
        settings = get_settings()
        pool = ConnectionPool.from_url(
            settings.redis_url,
            max_connections=settings.redis_max_connections,
            decode_responses=True,
            # Fail fast instead of hanging when Redis is unreachable, so the rate
            # limiter fails open and the blocklist fails closed within seconds.
            # health_check_interval pings idle connections so the pool recovers
            # after a managed failover without an app restart.
            socket_timeout=settings.redis_socket_timeout,
            socket_connect_timeout=settings.redis_connect_timeout,
            socket_keepalive=True,
            health_check_interval=settings.redis_health_check_interval,
        )
        _redis = Redis(connection_pool=pool)
    return _redis


async def get_redis_dep() -> AsyncGenerator[Redis, None]:
    yield get_redis()


async def close_redis() -> None:
    global _redis
    if _redis is not None:
        await _redis.aclose()
        _redis = None
