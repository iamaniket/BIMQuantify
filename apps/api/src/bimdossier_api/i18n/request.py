"""Per-request locale resolution + response-message helpers.

Two entry points used by the HTTP layer — distinct from the email/notification
helpers in ``resolution.py`` (which key off a stored ``User`` or a project's
country, for code with no live request):

- ``resolve_request_locale(request, user=None)`` — the language to answer THIS
  request in. Chain: ``Accept-Language`` header → authenticated ``User.locale``
  → ``PLATFORM_DEFAULT_LOCALE``. The header is parsed straight off
  ``request.headers`` so it also works inside exception handlers, without
  depending on any middleware having run first.
- ``attach_notice(response, code, request, user=None)`` — attach a localized
  success message to a 2xx response via ``X-Message-Code`` / ``X-Message``
  headers. Purely additive: it never touches the JSON body / ``response_model``.

The matching error path lives in :mod:`bimdossier_api.i18n.http_errors`.
"""

from __future__ import annotations

from typing import TYPE_CHECKING
from urllib.parse import quote

from bimdossier_api.i18n import (
    PLATFORM_DEFAULT_LOCALE,
    SUPPORTED_LOCALES,
    coerce_locale,
    t,
)

if TYPE_CHECKING:
    from starlette.requests import Request
    from starlette.responses import Response

    from bimdossier_api.i18n import Locale
    from bimdossier_api.models.user import User


def parse_accept_language(header: str | None) -> Locale | None:
    """Pick the best supported locale from an ``Accept-Language`` header.

    Tolerates region subtags (``nl-NL`` → ``nl``) and ``;q=`` weights, honours
    weight order, and returns ``None`` when nothing matches — so the caller can
    fall through to the next link in the chain.
    """
    if not header:
        return None
    ranked: list[tuple[float, int, str]] = []
    for index, part in enumerate(header.split(",")):
        token = part.strip()
        if not token:
            continue
        tag, _, params = token.partition(";")
        primary = tag.strip().lower().split("-", 1)[0]
        if not primary or primary == "*":
            continue
        weight = 1.0
        if params:
            for param in params.split(";"):
                key, _, value = param.strip().partition("=")
                if key.strip() == "q":
                    try:
                        weight = float(value)
                    except ValueError:
                        weight = 0.0
        ranked.append((weight, index, primary))
    # Highest weight wins; ties keep original header order (lower index first).
    ranked.sort(key=lambda row: (-row[0], row[1]))
    for _weight, _index, primary in ranked:
        if primary in SUPPORTED_LOCALES:
            return primary
    return None


def resolve_request_locale(request: Request, user: User | None = None) -> Locale:
    """Resolve the locale to answer ``request`` in: header → user → default."""
    header_locale = parse_accept_language(request.headers.get("accept-language"))
    if header_locale is not None:
        return header_locale
    if user is not None and user.locale:
        return coerce_locale(user.locale)
    # Authenticated request with no Accept-Language header: fall back to the
    # locale the current_*_user dependency stashed (auth/fastapi_users.py).
    stashed = getattr(request.state, "user_locale", None)
    if stashed:
        return coerce_locale(stashed)
    return PLATFORM_DEFAULT_LOCALE


def attach_notice(
    response: Response,
    code: str,
    request: Request,
    user: User | None = None,
) -> None:
    """Attach a localized success message to ``response`` as headers.

    ``X-Message-Code`` carries the stable SCREAMING_SNAKE code (for client
    logic); ``X-Message`` carries the percent-encoded localized text (HTTP
    headers are latin-1, so encoding keeps any accented NL/EN text safe). Both
    are exposed cross-origin via the CORS ``expose_headers`` allowlist in
    ``main.py``. Falls back to the bare code if the catalog has no entry.
    """
    locale = resolve_request_locale(request, user)
    try:
        message = t(f"messages.{code}", locale)
    except KeyError:
        message = code
    response.headers["X-Message-Code"] = code
    response.headers["X-Message"] = quote(message)
