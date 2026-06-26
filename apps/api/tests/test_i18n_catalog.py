"""Catalog parity + var-rendering smoke tests for `bimdossier_api.i18n`.

These run as part of the regular pytest sweep; they don't need the DB,
HTTP client, or any fixtures. The whole point is to fail loudly the
moment ``messages/en.py`` and ``messages/nl.py`` drift apart, or when a
caller is going to hit a ``KeyError`` because a placeholder was renamed
in one locale but not the other.
"""

from __future__ import annotations

import re

import pytest

from bimdossier_api.i18n import (
    BILINGUAL_SEPARATOR,
    PLATFORM_DEFAULT_LOCALE,
    SUPPORTED_LOCALES,
    coerce_locale,
    t,
    t_bilingual,
)
from bimdossier_api.i18n.messages import en_messages, nl_messages


_PLACEHOLDER_RE = re.compile(r"\{([a-zA-Z_][a-zA-Z0-9_]*)\}")


def _placeholders(template: str) -> set[str]:
    return set(_PLACEHOLDER_RE.findall(template))


def test_catalogs_have_identical_keys() -> None:
    """Drift between en.py and nl.py is a build break."""
    en_keys = set(en_messages.keys())
    nl_keys = set(nl_messages.keys())
    only_en = en_keys - nl_keys
    only_nl = nl_keys - en_keys
    assert not only_en, f"keys present in en.py but missing from nl.py: {sorted(only_en)}"
    assert not only_nl, f"keys present in nl.py but missing from en.py: {sorted(only_nl)}"


def test_catalogs_have_matching_placeholders() -> None:
    """Each key's {placeholders} must match across locales — a caller passes the
    same vars regardless of locale, so a renamed placeholder on one side
    silently emits the literal text on the other."""
    mismatches: list[str] = []
    for key in en_messages:
        en_vars = _placeholders(en_messages[key])
        nl_vars = _placeholders(nl_messages[key])
        if en_vars != nl_vars:
            mismatches.append(
                f"{key}: en={sorted(en_vars)} vs nl={sorted(nl_vars)}"
            )
    assert not mismatches, "placeholder drift:\n  " + "\n  ".join(mismatches)


def test_t_returns_localized_string() -> None:
    en = t("auth.activate_email.subject", "en")
    nl = t("auth.activate_email.subject", "nl")
    assert "BimDossier" in en
    assert "BimDossier" in nl
    assert en != nl  # Different languages


def test_t_interpolates_placeholders() -> None:
    body = t(
        "auth.activate_email.body",
        "en",
        name="Alice",
        url="https://example.com/x",
        token="tok123",
    )
    assert "Alice" in body
    assert "https://example.com/x" in body
    assert "tok123" in body


def test_t_falls_back_to_platform_default_on_missing_locale_key(monkeypatch: pytest.MonkeyPatch) -> None:
    """A bad deploy that loses a key from one locale should still render
    something readable rather than crashing the email send."""
    # Inject a temporary key only in the platform-default catalog.
    from bimdossier_api.i18n import _CATALOGS

    monkeypatch.setitem(
        _CATALOGS[PLATFORM_DEFAULT_LOCALE], "_test.only_in_default", "fallback"
    )
    other_locale = "en" if PLATFORM_DEFAULT_LOCALE == "nl" else "nl"
    assert t("_test.only_in_default", other_locale) == "fallback"


def test_t_raises_on_unknown_key() -> None:
    with pytest.raises(KeyError):
        t("not.a.real.key", "en")


def test_t_bilingual_joins_both_sections() -> None:
    body = t_bilingual(
        "auth.activate_email.body",
        name="Alice",
        url="https://example.com/x",
        token="tok123",
    )
    assert BILINGUAL_SEPARATOR in body
    en_part, nl_part = body.split(BILINGUAL_SEPARATOR)
    assert "Alice" in en_part and "Alice" in nl_part
    # English vs Dutch markers — picking phrases unique to each locale's
    # catalog template ("Activate" only in en, "Activeer" only in nl).
    assert "Activate" in en_part
    assert "Activeer" in nl_part


def test_coerce_locale_narrows_strings() -> None:
    assert coerce_locale("en") == "en"
    assert coerce_locale("nl") == "nl"
    # Unknown / None falls back to platform default
    assert coerce_locale(None) == PLATFORM_DEFAULT_LOCALE
    assert coerce_locale("de") == PLATFORM_DEFAULT_LOCALE
    assert coerce_locale("") == PLATFORM_DEFAULT_LOCALE


def test_supported_locales_matches_catalog_keys() -> None:
    """If we add a new locale module, this should stay in sync."""
    from bimdossier_api.i18n import _CATALOGS

    assert set(SUPPORTED_LOCALES) == set(_CATALOGS.keys())
