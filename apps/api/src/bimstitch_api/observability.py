"""Sentry initialisation for the API.

Idempotent and env-gated: a missing SENTRY_DSN turns the SDK into a no-op
without raising. Tests don't need to do anything special — they just leave
SENTRY_DSN unset.
"""

from __future__ import annotations

import sentry_sdk
from sentry_sdk.integrations.asyncio import AsyncioIntegration
from sentry_sdk.integrations.fastapi import FastApiIntegration
from sentry_sdk.integrations.starlette import StarletteIntegration

from bimstitch_api.config import get_settings


def init_sentry() -> bool:
    settings = get_settings()
    if not settings.sentry_dsn:
        return False
    sentry_sdk.init(
        dsn=settings.sentry_dsn,
        environment=settings.sentry_environment,
        release=settings.sentry_release,
        traces_sample_rate=settings.sentry_traces_sample_rate,
        integrations=[
            StarletteIntegration(),
            FastApiIntegration(),
            AsyncioIntegration(),
        ],
        send_default_pii=False,
    )
    return True
