"""Locale resolution helpers.

Two patterns coexist:

- **Member-context** (recipient is a known ``User``): resolve from
  ``User.locale``, falling back to the platform default. The user's
  ``users.locale`` column is nullable; NULL means "I haven't told you,
  use the default".
- **Project/org-context** (no specific recipient, or pre-account email):
  resolve from ``Project.country`` → ``jurisdictions.default_locale``.

Both helpers go through ``coerce_locale`` so an unexpected DB value
(stale data, manual edits, future locale rollouts) never crashes.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from bimstitch_api import jurisdictions
from bimstitch_api.i18n._types import Locale

if TYPE_CHECKING:
    from bimstitch_api.models.user import User


def _coerce(value: str | None) -> Locale:
    # Inline to avoid a circular import with bimstitch_api.i18n.
    from bimstitch_api.i18n import PLATFORM_DEFAULT_LOCALE, SUPPORTED_LOCALES

    if value in SUPPORTED_LOCALES:
        return value  # type: ignore[return-value]
    return PLATFORM_DEFAULT_LOCALE


def resolve_user_locale(user: User) -> Locale:
    """Pick ``User.locale`` or fall back to the platform default."""
    return _coerce(user.locale)


def resolve_org_locale(country: str | None) -> Locale:
    """Derive a locale from a country code via the jurisdictions registry.

    Used by code paths that have a project/org context but no specific
    recipient (e.g. system emails not tied to a user — rare today).
    """
    if country is None:
        return _coerce(None)
    j = jurisdictions.get(country)
    return _coerce(j.default_locale if j is not None else None)
