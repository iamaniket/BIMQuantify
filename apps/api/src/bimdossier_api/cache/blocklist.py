import logging

from redis.asyncio import Redis
from redis.exceptions import RedisError

from bimdossier_api.logging_utils import warn_throttled

logger = logging.getLogger(__name__)

BLOCK_PREFIX = "blk:jti:"
# Refresh-token rotation markers (distinct from the BLOCK_PREFIX logout
# blocklist so a rotated token's replay can be told apart from a deliberately
# logged-out token's replay — the former is reuse → sign-out-everywhere, the
# latter stays a plain REFRESH_TOKEN_REVOKED). See auth/refresh.py.
ROTATED_PREFIX = "refresh:rot:"  # value "1"; lives for the retired token's remaining life
SUCCESSOR_PREFIX = "refresh:succ:"  # value = successor refresh token; lives for the grace window


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
        # Throttled: during an outage this fires on every authed request, so a
        # per-request WARNING would flood the logs.
        warn_throttled(
            logger,
            "blocklist_redis_unavailable",
            "Redis unavailable for blocklist check — failing closed (token treated as revoked)",
        )
        return True


async def mark_refresh_rotated(
    redis: Redis,
    jti: str,
    successor_token: str,
    *,
    remaining_seconds: int,
    grace_seconds: int,
) -> None:
    """Record that the refresh token `jti` was rotated.

    Writes two keys atomically (pipeline):
      - ROTATED_PREFIX:jti = "1" for `remaining_seconds` — marks the token as
        retired for the rest of its natural life. While this exists, replaying
        the token is detectable as reuse.
      - SUCCESSOR_PREFIX:jti = `successor_token` for `grace_seconds` — lets a
        benign concurrent/retry replay re-fetch the SAME successor instead of
        tripping reuse detection. Skipped when `grace_seconds <= 0`.

    Propagates `RedisError` so the caller can refuse to hand out a rotated pair
    it couldn't durably retire (otherwise the old token would silently keep
    working — the opposite of rotation).
    """
    pipe = redis.pipeline()
    pipe.set(f"{ROTATED_PREFIX}{jti}", "1", ex=max(remaining_seconds, 1))
    if grace_seconds > 0:
        pipe.set(f"{SUCCESSOR_PREFIX}{jti}", successor_token, ex=grace_seconds)
    await pipe.execute()


async def get_refresh_rotation(redis: Redis, jti: str | None) -> tuple[bool, str | None]:
    """Return `(was_rotated, successor_within_grace)` for a refresh token JTI.

    `was_rotated` is True once `mark_refresh_rotated` ran for this JTI (until the
    token's natural expiry). `successor_within_grace` is the successor token if it
    is still inside the grace window, else None.

    Fails SOFT: on a Redis error returns `(False, None)` so the refresh proceeds
    down the normal path rather than spuriously declaring reuse. The refresh
    endpoint checks the fail-CLOSED blocklist (`is_revoked`) first, so a real
    Redis outage already rejects the refresh before this is reached.
    """
    if not jti:
        return False, None
    try:
        pipe = redis.pipeline()
        pipe.exists(f"{ROTATED_PREFIX}{jti}")
        pipe.get(f"{SUCCESSOR_PREFIX}{jti}")
        rotated_raw, successor = await pipe.execute()
        return bool(rotated_raw), successor
    except RedisError:
        warn_throttled(
            logger,
            "rotation_redis_unavailable",
            "Redis unavailable for refresh-rotation check — proceeding without reuse detection",
        )
        return False, None
