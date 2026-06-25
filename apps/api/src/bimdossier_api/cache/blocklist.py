import logging

from redis.asyncio import Redis
from redis.exceptions import RedisError

logger = logging.getLogger(__name__)

BLOCK_PREFIX = "blk:jti:"


async def revoke_jti(redis: Redis, jti: str, ttl_seconds: int) -> None:
    """Add a token's JTI to the blocklist until it would naturally expire.

    Propagates `RedisError` so callers can surface that the revocation did
    not persist. Swallowing it would let a "revoked" token spring back to
    life once Redis recovers — the opposite of fail-closed.
    """
    await redis.set(f"{BLOCK_PREFIX}{jti}", "1", ex=max(ttl_seconds, 1))


async def is_revoked(redis: Redis, jti: str | None) -> bool:
    """Return True if the JTI has been blocklisted.

    Fails closed: if Redis is unreachable we cannot prove a token is still
    valid, so we treat it as revoked. This rejects every authenticated
    request for the duration of a Redis outage — a deliberate
    availability-for-security tradeoff so a stolen or logged-out token is
    never honoured while the blocklist is blind.
    """
    if not jti:
        return False
    try:
        return bool(await redis.exists(f"{BLOCK_PREFIX}{jti}"))
    except RedisError:
        logger.warning(
            "Redis unavailable for blocklist check — failing closed (token treated as revoked)"
        )
        return True
