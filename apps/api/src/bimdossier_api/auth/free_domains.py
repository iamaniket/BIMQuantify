"""Shared blocklist of free-email providers.

Used by access-request validation to require a work email. The portal
restates the same set client-side so users see immediate feedback, but the
server is authoritative.
"""

from __future__ import annotations

FREE_EMAIL_DOMAINS: frozenset[str] = frozenset(
    {
        "gmail.com", "googlemail.com",
        "yahoo.com", "yahoo.co.uk", "yahoo.fr", "ymail.com", "rocketmail.com",
        "hotmail.com", "hotmail.co.uk", "hotmail.nl",
        "outlook.com", "live.com", "msn.com",
        "icloud.com", "me.com", "mac.com",
        "aol.com",
        "protonmail.com", "proton.me", "pm.me",
        "gmx.com", "gmx.de", "gmx.net",
        "mail.com", "zoho.com", "yandex.com", "yandex.ru",
        "fastmail.com", "tutanota.com", "tutanota.de", "hey.com",
        "web.de", "t-online.de",
        "orange.fr", "wanadoo.fr", "free.fr",
        "ziggo.nl", "kpnmail.nl", "planet.nl", "home.nl", "xs4all.nl",
    }
)


def is_free_email_domain(email: str) -> bool:
    parts = email.lower().split("@", 1)
    if len(parts) != 2:
        return False
    return parts[1] in FREE_EMAIL_DOMAINS
