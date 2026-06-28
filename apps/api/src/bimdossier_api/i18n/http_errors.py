"""Localized HTTP error responses.

Central exception handlers that turn the API's stable SCREAMING_SNAKE error
codes into a ``{code, message, detail}`` envelope where ``message`` is
translated into the request's language (Accept-Language → User.locale →
platform default).

``detail`` is preserved exactly as FastAPI would have emitted it (the bare
string for a string code, the original dict for a structured detail), so
existing clients and tests that read ``detail`` keep working unchanged — this
is what makes the rollout low-risk.

Error codes follow a ``CODE`` or ``CODE:context`` convention: the colon suffix
carries dynamic context (a field id, a country, an exception message). The
catalog lookup key is always the part before the first colon.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

from fastapi.encoders import jsonable_encoder
from starlette import status
from starlette.responses import JSONResponse

from bimdossier_api.i18n import t
from bimdossier_api.i18n.request import resolve_request_locale

if TYPE_CHECKING:
    from collections.abc import Sequence

    from fastapi.exceptions import RequestValidationError
    from starlette.exceptions import HTTPException as StarletteHTTPException
    from starlette.requests import Request

    from bimdossier_api.i18n import Locale

logger = logging.getLogger(__name__)


def _code_from_detail(detail: Any) -> str:
    """Extract the catalog lookup code from an ``HTTPException.detail``."""
    if isinstance(detail, dict):
        code = detail.get("code")
        return str(code) if code else "ERROR"
    if isinstance(detail, str):
        # "CODE" or "CODE:context" — the catalog key is the bare code.
        return detail.split(":", 1)[0].strip() or "ERROR"
    return "ERROR"


def _error_message(code: str, locale: Locale, detail: Any) -> str:
    """Localized message for ``code``, with graceful fallbacks."""
    try:
        return t(f"errors.{code}", locale)
    except KeyError:
        # No catalog entry: prefer a structured detail's bundled English
        # message, else the code itself. We never 500 on an un-catalogued
        # code; tests/test_error_catalog.py drives coverage to completion.
        if isinstance(detail, dict):
            bundled = detail.get("message")
            if isinstance(bundled, str) and bundled:
                return bundled
        logger.warning("i18n: no errors.%s catalog entry", code)
        return code


def build_localized_error(
    request: Request,
    status_code: int,
    code: str,
    detail: Any,
    headers: dict[str, str] | None = None,
) -> JSONResponse:
    """Build the ``{code, message<localized>, detail}`` envelope as a JSONResponse.

    Shared by ``http_exception_handler`` (the registered handler) and by
    middleware that runs *outside* Starlette's ``ExceptionMiddleware`` — an
    ``HTTPException`` raised there is never caught by the handler, so such
    middleware must construct the localized response itself. Keeping both paths
    on this helper guarantees a byte-identical envelope.
    """
    locale = resolve_request_locale(request)
    body = {
        "code": code,
        "message": _error_message(code, locale, detail),
        "detail": detail,
    }
    return JSONResponse(
        status_code=status_code,
        content=jsonable_encoder(body),
        headers=headers,
    )


async def http_exception_handler(request: Request, exc: StarletteHTTPException) -> JSONResponse:
    """Localize any ``HTTPException`` (FastAPI or Starlette) into the envelope."""
    detail = exc.detail
    return build_localized_error(
        request,
        exc.status_code,
        _code_from_detail(detail),
        detail,
        headers=getattr(exc, "headers", None),
    )


def _redact_validation_errors(errors: Sequence[Any]) -> list[Any]:
    """Drop the echoed ``input`` value from each validation-error item.

    Pydantic/Starlette put the *submitted value* under ``input`` in every error.
    For a request body that fails validation that reflects user secrets straight
    back: a malformed ``/auth/activate`` body returns the plaintext ``password``,
    and a body that fails to JSON-parse echoes the raw bytes. Stripping ``input``
    (equivalent to Pydantic's ``include_input=False``) closes the leak while
    leaving ``loc``/``type``/``msg``/``ctx`` — the fields clients use to map field
    errors — untouched.
    """
    redacted: list[Any] = []
    for err in errors:
        if isinstance(err, dict) and "input" in err:
            err = {k: v for k, v in err.items() if k != "input"}
        redacted.append(err)
    return redacted


async def validation_exception_handler(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    """Localize FastAPI's 422 request-validation errors.

    The per-field ``detail`` list is preserved (encoded) for clients that map
    field errors; ``message`` is a single localized summary. The submitted
    ``input`` is redacted from each item so the response never echoes a secret
    (see ``_redact_validation_errors``).
    """
    locale = resolve_request_locale(request)
    body = {
        "code": "VALIDATION_ERROR",
        "message": t("errors.VALIDATION_ERROR", locale),
        "detail": jsonable_encoder(_redact_validation_errors(exc.errors())),
    }
    return JSONResponse(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, content=body)


async def generic_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Catch-all for any otherwise-unhandled exception → localized 500 envelope.

    Only ``StarletteHTTPException`` and ``RequestValidationError`` have dedicated
    handlers; without this, anything else (a bug, or a ``RedisError`` surfacing
    past the resilient rate limiter) bypasses the ``{code, message, detail}``
    envelope the portal parses and returns Starlette's bare ``Internal Server
    Error`` text. We log the traceback and return a generic body that never
    echoes ``str(exc)`` to the client.

    Registered against the base ``Exception`` so Starlette's
    ``ServerErrorMiddleware`` invokes it; that middleware re-raises afterwards,
    so server-level logging and Sentry capture still fire.
    """
    logger.error(
        "Unhandled exception on %s %s",
        request.method,
        request.url.path,
        exc_info=exc,
    )
    return build_localized_error(
        request,
        status.HTTP_500_INTERNAL_SERVER_ERROR,
        "INTERNAL_ERROR",
        "INTERNAL_ERROR",
    )
