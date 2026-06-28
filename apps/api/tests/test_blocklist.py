"""Unit tests for the JWT blocklist fail-closed behavior (`cache/blocklist.py`).

The blocklist is the security boundary: if Redis is unreachable we cannot prove a
token is still valid, so it must be treated as revoked. This is the deliberate
counterpart to the rate limiter, which fails OPEN (see `test_rate_limit.py`).
"""

from redis.exceptions import ConnectionError as RedisConnectionError

from bimdossier_api.cache.blocklist import is_revoked


class _BoomRedis:
    """Stand-in whose `exists` raises as if Redis were unreachable."""

    async def exists(self, *args: object, **kwargs: object) -> int:
        raise RedisConnectionError("redis is down")


async def test_is_revoked_fails_closed_when_redis_unavailable() -> None:
    # Redis blind → token treated as revoked. Rejecting every authed request for
    # the duration of an outage is the intended availability-for-security tradeoff.
    assert await is_revoked(_BoomRedis(), "some-jti") is True


async def test_is_revoked_returns_false_for_missing_jti() -> None:
    # No jti to check → not revoked, and Redis is never touched.
    assert await is_revoked(_BoomRedis(), None) is False
