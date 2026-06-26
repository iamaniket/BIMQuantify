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


async def http_exception_handler(
    request: Request, exc: StarletteHTTPException
) -> JSONResponse:
    """Localize any ``HTTPException`` (FastAPI or Starlette) into the envelope."""
    locale = resolve_request_locale(request)
    detail = exc.detail
    code = _code_from_detail(detail)
    body = {
        "code": code,
        "message": _error_message(code, locale, detail),
        "detail": detail,
    }
    return JSONResponse(
        status_code=exc.status_code,
        content=jsonable_encoder(body),
        headers=getattr(exc, "headers", None),
    )


async def validation_exception_handler(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    """Localize FastAPI's 422 request-validation errors.

    The per-field ``detail`` list is preserved (encoded) for clients that map
    field errors; ``message`` is a single localized summary.
    """
    locale = resolve_request_locale(request)
    body = {
        "code": "VALIDATION_ERROR",
        "message": t("errors.VALIDATION_ERROR", locale),
        "detail": jsonable_encoder(exc.errors()),
    }
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, content=body
    )
