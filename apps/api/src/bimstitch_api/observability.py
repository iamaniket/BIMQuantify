"""Sentry initialisation for the API.

Idempotent and env-gated: a missing SENTRY_DSN turns the SDK into a no-op
without raising. Tests don't need to do anything special — they just leave
SENTRY_DSN unset.
"""

from __future__ import annotations

import os

import sentry_sdk
from sentry_sdk.integrations.asyncio import AsyncioIntegration
from sentry_sdk.integrations.fastapi import FastApiIntegration
from sentry_sdk.integrations.starlette import StarletteIntegration

from bimstitch_api.config import get_settings


def resolve_release(explicit: str | None = None) -> str | None:
    """Resolve the Sentry release tag.

    Order: explicit Settings value, then common CI envs so deploys ship the
    same SHA Sentry sees from the bundled source maps. Returns None when
    nothing matches — callers should leave release unset rather than send
    "unknown".
    """
    candidates = [
        explicit,
        os.environ.get("SENTRY_RELEASE"),
        os.environ.get("VERCEL_GIT_COMMIT_SHA"),
        os.environ.get("GITHUB_SHA"),
        os.environ.get("GIT_SHA"),
    ]
    for c in candidates:
        if c is not None and c.strip() != "":
            return c
    return None


def init_sentry() -> bool:
    settings = get_settings()
    if not settings.sentry_dsn:
        return False
    sentry_sdk.init(
        dsn=settings.sentry_dsn,
        environment=settings.sentry_environment,
        release=resolve_release(settings.sentry_release),
        traces_sample_rate=settings.sentry_traces_sample_rate,
        integrations=[
            StarletteIntegration(),
            FastApiIntegration(),
            AsyncioIntegration(),
        ],
        send_default_pii=False,
    )
    return True
