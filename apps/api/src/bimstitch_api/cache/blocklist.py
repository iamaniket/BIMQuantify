import logging
import time

from redis.asyncio import Redis
from redis.exceptions import RedisError

logger = logging.getLogger(__name__)

BLOCK_PREFIX = "blk:jti:"

_circuit_open = False
_circuit_opened_at = 0.0
_CIRCUIT_RETRY_AFTER = 30.0


def _check_circuit() -> bool:
    global _circuit_open, _circuit_opened_at
    if not _circuit_open:
        return False
    if time.monotonic() - _circuit_opened_at > _CIRCUIT_RETRY_AFTER:
        _circuit_open = False
        return False
    return True


def _open_circuit() -> None:
    global _circuit_open, _circuit_opened_at
    _circuit_open = True
    _circuit_opened_at = time.monotonic()


async def revoke_jti(redis: Redis, jti: str, ttl_seconds: int) -> None:
    try:
        await redis.set(f"{BLOCK_PREFIX}{jti}", "1", ex=max(ttl_seconds, 1))
    except RedisError:
        logger.warning("Redis unavailable during JTI revocation — token may remain valid")
        _open_circuit()


async def is_revoked(redis: Redis, jti: str | None) -> bool:
    if not jti:
        return False
    if _check_circuit():
        return False
    try:
        result = bool(await redis.exists(f"{BLOCK_PREFIX}{jti}"))
        return result
    except RedisError:
        logger.warning("Redis unavailable for blocklist check — failing open")
        _open_circuit()
        return False
