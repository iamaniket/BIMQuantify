"""API i18n catalog — single source of truth for every user-facing string
the API emits (emails + in-app notifications).

Public surface:

- ``t(key, locale, **vars)`` — look up + interpolate a single locale.
- ``t_bilingual(key, **vars)`` — return "EN\\n\\n---\\n\\nNL" using the
  existing ``email/deadlines.py`` convention. Used for emails where the
  recipient has no locale preference (activation, reset).
- ``resolve_user_locale(user)`` — coerce ``User.locale`` to a valid
  ``Locale``, defaulting to ``PLATFORM_DEFAULT_LOCALE``.
- ``resolve_org_locale(country)`` — derive a locale from a project
  country code via the jurisdictions registry.
- ``coerce_locale(value)`` — generic narrowing for strings that may
  carry a locale (e.g. ``Report.locale``).

Adding a new string: append the key to BOTH ``messages/en.py`` and
``messages/nl.py`` in the same edit. ``tests/test_i18n_catalog.py``
enforces parity at runtime.
"""

from __future__ import annotations

from bimstitch_api.i18n._types import Catalog, Locale
from bimstitch_api.i18n.messages import en_messages, nl_messages

SUPPORTED_LOCALES: tuple[Locale, ...] = ("en", "nl")
PLATFORM_DEFAULT_LOCALE: Locale = "nl"
BILINGUAL_SEPARATOR = "\n\n---\n\n"

_CATALOGS: dict[Locale, Catalog] = {
    "en": en_messages,
    "nl": nl_messages,
}


def coerce_locale(value: str | None) -> Locale:
    """Narrow any string to a supported ``Locale``, defaulting to platform."""
    if value in SUPPORTED_LOCALES:
        return value  # type: ignore[return-value]
    return PLATFORM_DEFAULT_LOCALE


def t(key: str, locale: Locale, /, **vars: object) -> str:
    """Look up a localized string and interpolate ``{vars}``.

    Falls back to the platform-default locale if a key is missing in the
    requested locale (parity tests prevent this in practice, but the
    fallback keeps production robust against a bad deploy).

    Raises ``KeyError`` if the key exists in no locale — better to fail
    loudly than emit a literal ``{placeholder}``.
    """
    template = _CATALOGS[locale].get(key)
    if template is None:
        template = _CATALOGS[PLATFORM_DEFAULT_LOCALE].get(key)
    if template is None:
        raise KeyError(f"Unknown i18n key: {key!r}")
    return template.format(**vars) if vars else template


def t_bilingual(key: str, /, **vars: object) -> str:
    """Return ``"<EN>{BILINGUAL_SEPARATOR}<NL>"``.

    For emails where the recipient has no locale preference (activation
    email, password reset). Both sections receive the same ``vars`` —
    they share placeholder names by design. Use the imperative
    composition pattern (call ``t`` twice with different vars) when
    locale-specific values are needed (e.g. the deadline label).
    """
    en_section = t(key, "en", **vars)
    nl_section = t(key, "nl", **vars)
    return f"{en_section}{BILINGUAL_SEPARATOR}{nl_section}"


# Re-export resolution helpers so callers only import from one place.
from bimstitch_api.i18n.resolution import (  # noqa: E402 — circular guard
    resolve_org_locale,
    resolve_user_locale,
)

__all__ = [
    "BILINGUAL_SEPARATOR",
    "Catalog",
    "Locale",
    "PLATFORM_DEFAULT_LOCALE",
    "SUPPORTED_LOCALES",
    "coerce_locale",
    "resolve_org_locale",
    "resolve_user_locale",
    "t",
    "t_bilingual",
]
