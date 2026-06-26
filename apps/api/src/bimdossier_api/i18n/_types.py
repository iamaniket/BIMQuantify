"""Type aliases for the API i18n catalog.

Kept tiny on purpose. The catalog itself is a flat ``dict[str, str]``
with dotted keys (e.g. ``"auth.activate_email.subject"``) — no nested
``TypedDict`` enforcement. Parity between locales is checked at runtime
by ``tests/test_i18n_catalog.py``; structural drift is the kind of bug
``mypy`` cannot reliably catch with recursive dicts anyway.
"""

from __future__ import annotations

from typing import Literal

# The two locales the platform ships today. Adding a third is a matter of
# extending this tuple and dropping a sibling ``messages/<code>.py``.
Locale = Literal["en", "nl"]

# Catalog shape — flat for ergonomics. Dotted keys keep namespacing
# without forcing every leaf into a TypedDict class.
Catalog = dict[str, str]
