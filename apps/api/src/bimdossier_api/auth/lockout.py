"""Per-account login lockout (security finding H6).

A second, IP-independent throttle on top of the per-IP login rate limiter
(`LOGIN_RATE_LIMITER`). The per-IP limiter caps how fast *one source* can
hammer; this caps total *failed* attempts against *one account* across *all*
sources — the only layer that sees distributed credential stuffing (an
attacker rotating IPs against a single victim account).

State lives in Redis, keyed on a sha256 hash of the normalized email (fixed
width, and no raw emails sitting in the keyspace):

  login:fail:{h}       INCR counter of failures in the current window (TTL = window)
  login:lock:{h}       presence = locked; TTL = remaining lockout seconds
  login:lockcount:{h}  consecutive-lockout count, for exponential backoff (TTL ~24h)

**Fail-open on RedisError** — deliberately the OPPOSITE of `blocklist.is_revoked`
(which fails closed). The lockout is a dampener layered on top of the password
check, not the authority on whether a credential is valid: if Redis is down the
password still must be correct, so failing open degrades gracefully to "lockout
temporarily disabled". Failing closed here would turn any Redis blip into a 100%
login outage for every tenant — a worse and more likely incident than the narrow
window in which an attacker also needs Redis to be down to benefit.
"""

from __future__ import annotations

import hashlib
import logging
from dataclasses import dataclass
from typing import TYPE_CHECKING

from redis.exceptions import RedisError

from bimdossier_api.logging_utils import warn_throttled

if TYPE_CHECKING:
    from redis.asyncio import Redis

    from bimdossier_api.config import Settings

logger = logging.getLogger(__name__)

FAIL_PREFIX = "login:fail:"
LOCK_PREFIX = "login:lock:"
LOCKCOUNT_PREFIX = "login:lockcount:"

# How long the consecutive-lockout count survives for backoff. Outlives the
# longest single lockout (the 24h cap) so escalation isn't forgotten between
# locks, but expires after a quiet day so a long-dormant account resets to base.
_LOCKCOUNT_TTL_SECONDS = 24 * 3600

# Guard the backoff exponent so `2 ** n` never builds an absurd bignum before the
# `min(..., cap)` clamp (a pathological lockcount would otherwise compute a
# multi-thousand-bit integer for no reason).
_MAX_BACKOFF_SHIFT = 32

# Throttle key so the fail-open warning doesn't flood logs during a Redis outage
# (every login attempt would otherwise emit one).
_WARN_KEY = "lockout_redis_unavailable"


@dataclass(frozen=True)
class FailureResult:
    """Outcome of recording one failed login attempt."""

    locked: bool  # account is locked as of now (just-locked OR already-locked)
    just_locked: bool  # THIS failure crossed the threshold — fire the admin alert
    fail_count: int  # consecutive failures recorded in the current window
    retry_after: int  # seconds until the lock expires (0 when not locked)


def normalize_username(raw: str) -> str:
    """Canonical account key: strip whitespace and lowercase.

    MUST match the case-insensitive form the authenticator resolves, or
    'Victim@x.com' and 'victim@x.com' get independent counters and the lock is
    trivially bypassed by case-rotation.
    """
    return raw.strip().lower()


def _hash(username: str) -> str:
    return hashlib.sha256(normalize_username(username).encode("utf-8")).hexdigest()


async def is_locked(redis: Redis, username: str) -> tuple[bool, int]:
    """Return ``(locked, retry_after_seconds)`` for the account.

    Fails open (``(False, 0)``) on RedisError — see the module docstring.
    """
    key = f"{LOCK_PREFIX}{_hash(username)}"
    try:
        ttl = await redis.ttl(key)  # -2 = no key, -1 = no TTL, >=0 = seconds left
    except RedisError:
        warn_throttled(
            logger,
            _WARN_KEY,
            "Redis unavailable for lockout check — failing open (login allowed)",
        )
        return (False, 0)
    if ttl is None or ttl < 0:
        return (False, 0)
    return (True, int(ttl))


async def register_failure(redis: Redis, username: str, settings: Settings) -> FailureResult:
    """Record one failed auth attempt; lock the account when the threshold is hit.

    On the first failure of a window, stamp the window TTL. When the counter
    reaches ``login_lockout_max_attempts``, set the lock key with an
    exponential-backoff TTL (``base * 2**(prior_lockouts-1)`` capped at
    ``login_lockout_max_seconds``), bump the consecutive-lockout count, and clear
    the fail counter so the next window starts clean once the lock lifts.

    Fails open (a benign not-locked result) on RedisError — the attempt simply
    isn't counted rather than blocking the login flow.
    """
    h = _hash(username)
    fail_key = f"{FAIL_PREFIX}{h}"
    lock_key = f"{LOCK_PREFIX}{h}"
    lockcount_key = f"{LOCKCOUNT_PREFIX}{h}"

    max_attempts = settings.login_lockout_max_attempts
    window = settings.login_lockout_window_seconds
    base = settings.login_lockout_base_seconds
    cap = settings.login_lockout_max_seconds

    try:
        # Already locked? Don't keep incrementing; report the live TTL.
        existing_ttl = await redis.ttl(lock_key)
        if existing_ttl is not None and existing_ttl >= 0:
            return FailureResult(
                locked=True,
                just_locked=False,
                fail_count=max_attempts,
                retry_after=int(existing_ttl),
            )

        count = int(await redis.incr(fail_key))
        if count == 1:
            await redis.expire(fail_key, window)

        if count < max_attempts:
            return FailureResult(locked=False, just_locked=False, fail_count=count, retry_after=0)

        # Threshold reached → lock with exponential backoff.
        prior_lockouts = int(await redis.incr(lockcount_key))
        await redis.expire(lockcount_key, _LOCKCOUNT_TTL_SECONDS)
        shift = min(prior_lockouts - 1, _MAX_BACKOFF_SHIFT)
        duration = min(base * (2**shift), cap)
        await redis.set(lock_key, "1", ex=max(duration, 1))
        await redis.delete(fail_key)  # fresh window after the lock lifts
        return FailureResult(
            locked=True, just_locked=True, fail_count=count, retry_after=int(duration)
        )
    except RedisError:
        warn_throttled(
            logger,
            _WARN_KEY,
            "Redis unavailable while registering login failure — failing open",
        )
        return FailureResult(locked=False, just_locked=False, fail_count=0, retry_after=0)


async def clear_failures(redis: Redis, username: str) -> None:
    """Reset the counter + lock + backoff state.

    Called on successful login, on password reset, and by the super-admin unlock
    endpoint. Best-effort: a RedisError is swallowed — a stale fail counter only
    ever locks the legitimate user slightly early on a later burst, it never
    weakens security, so there is no reason to fail the caller over it.
    """
    h = _hash(username)
    try:
        await redis.delete(f"{FAIL_PREFIX}{h}", f"{LOCK_PREFIX}{h}", f"{LOCKCOUNT_PREFIX}{h}")
    except RedisError:
        warn_throttled(
            logger, _WARN_KEY, "Redis unavailable clearing login lockout state (non-fatal)"
        )


async def locked_map(redis: Redis, emails: list[str]) -> dict[str, bool]:
    """Batched lock-status lookup for a page of users → ``{email: locked}``.

    One pipeline round-trip for the whole page (admin "Locked" badge). Fails
    open: any RedisError → every entry ``False`` so a Redis blip never breaks a
    listing.
    """
    result: dict[str, bool] = {email: False for email in emails}
    if not emails:
        return result
    try:
        async with redis.pipeline(transaction=False) as pipe:
            for email in emails:
                pipe.exists(f"{LOCK_PREFIX}{_hash(email)}")
            existing = await pipe.execute()
    except RedisError:
        warn_throttled(
            logger, _WARN_KEY, "Redis unavailable for lockout badge lookup — failing open"
        )
        return result
    for email, exists in zip(emails, existing, strict=False):
        result[email] = bool(exists)
    return result
