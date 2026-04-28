from redis.asyncio import Redis

BLOCK_PREFIX = "blk:jti:"


async def revoke_jti(redis: Redis, jti: str, ttl_seconds: int) -> None:
    await redis.set(f"{BLOCK_PREFIX}{jti}", "1", ex=max(ttl_seconds, 1))


async def is_revoked(redis: Redis, jti: str | None) -> bool:
    if not jti:
        return False
    return bool(await redis.exists(f"{BLOCK_PREFIX}{jti}"))
