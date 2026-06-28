"""Structured application logging for the API.

Closes M-obs1: without this the API inherits uvicorn's plaintext logging, so a
log line, the ``audit_log`` row, and a Sentry event for the same request share
no common key. ``configure_logging`` installs a single stdout handler whose
output is either one JSON object per line (``LOG_FORMAT=json`` — for log
aggregation in production) or a human-readable line (``LOG_FORMAT=console`` —
for local dev). Every record carries a ``request_id`` (from the request-scoped
context var set by ``RequestIdMiddleware``), which is the same id returned in the
``X-Request-Id`` response header and written to ``audit_log.request_id`` — so the
three correlate.

``configure_logging`` runs from ``create_app`` at import time. Under uvicorn the
app module is imported *after* uvicorn has configured its own logging, so this
config wins for the root logger; uvicorn's own ``uvicorn`` / ``uvicorn.access``
loggers are rerouted through the same handler so the whole stream is one format.
``disable_existing_loggers=False`` keeps already-created loggers alive.
"""

from __future__ import annotations

import json
import logging
import logging.config
import os
from typing import TYPE_CHECKING, Any

from bimdossier_api.logging_utils import get_request_id

if TYPE_CHECKING:
    from bimdossier_api.config import Settings

# Sentinel rendered when a record has no request context (background sweepers,
# startup, the access log emitted after the request scope is torn down).
_NO_REQUEST_ID = "-"

# Standard ``logging.LogRecord`` attributes — everything NOT in here that a
# caller attached via ``logger.info(..., extra={...})`` is merged into the JSON
# payload so structured context survives.
_RESERVED_LOG_RECORD_ATTRS = frozenset(
    {
        "args",
        "asctime",
        "created",
        "exc_info",
        "exc_text",
        "filename",
        "funcName",
        "levelname",
        "levelno",
        "lineno",
        "module",
        "msecs",
        "message",
        "msg",
        "name",
        "pathname",
        "process",
        "processName",
        "relativeCreated",
        "stack_info",
        "taskName",
        "thread",
        "threadName",
        "request_id",
    }
)


class RequestIdFilter(logging.Filter):
    """Stamp every record with the current request's id (or ``"-"``).

    Attached to the handler so any record reaching stdout — whether from an app
    logger via root or from a rerouted uvicorn logger — gets a ``request_id``
    attribute before the formatter runs. An explicit ``extra={"request_id": ...}``
    is left untouched.
    """

    def filter(self, record: logging.LogRecord) -> bool:
        if not hasattr(record, "request_id"):
            record.request_id = get_request_id() or _NO_REQUEST_ID
        return True


class JsonLogFormatter(logging.Formatter):
    """Render a log record as a single compact JSON object.

    One line per record keeps the output ingestible by log shippers
    (CloudWatch / Loki / Datadog) without a multiline-stitch rule.
    """

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "timestamp": self.formatTime(record, self.datefmt),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            "request_id": getattr(record, "request_id", None) or get_request_id() or _NO_REQUEST_ID,
            "module": record.module,
            "line": record.lineno,
        }
        # Merge structured extras (logger.info(..., extra={...})).
        for key, value in record.__dict__.items():
            if key not in _RESERVED_LOG_RECORD_ATTRS and not key.startswith("_"):
                payload.setdefault(key, value)
        if record.exc_info:
            payload["exc_info"] = self.formatException(record.exc_info)
        if record.stack_info:
            payload["stack_info"] = self.formatStack(record.stack_info)
        # default=str so a stray non-serializable extra degrades to its repr
        # instead of raising inside the logging machinery.
        return json.dumps(payload, default=str, ensure_ascii=False)


_CONSOLE_FORMAT = "%(asctime)s %(levelname)-8s [%(request_id)s] %(name)s: %(message)s"

# Set once configure_logging has installed the dictConfig, so repeated
# create_app() calls (every test builds an app) don't thrash the root handlers.
_configured = False


def build_logging_dict_config(settings: Settings) -> dict[str, Any]:
    """Return the ``logging.config.dictConfig`` mapping for the chosen format.

    Pure (no global side effects) so it can be unit-tested directly.
    """
    fmt = settings.resolved_log_format  # "json" | "console"
    level = settings.log_level.strip().upper() or "INFO"
    formatter = "json" if fmt == "json" else "console"
    uvicorn_logger = {
        "handlers": ["default"],
        "level": level,
        "propagate": False,
    }
    return {
        "version": 1,
        "disable_existing_loggers": False,
        "filters": {
            "request_id": {"()": f"{__name__}.RequestIdFilter"},
        },
        "formatters": {
            "json": {"()": f"{__name__}.JsonLogFormatter"},
            "console": {"format": _CONSOLE_FORMAT},
        },
        "handlers": {
            "default": {
                "class": "logging.StreamHandler",
                "stream": "ext://sys.stdout",
                "formatter": formatter,
                "filters": ["request_id"],
            },
        },
        # Root catches app loggers (bimdossier_api.*) and libraries.
        "root": {"handlers": ["default"], "level": level},
        # Reroute uvicorn's own loggers through the same handler so access/error
        # lines share the structured format and request_id instead of staying
        # uvicorn plaintext.
        "loggers": {
            "uvicorn": dict(uvicorn_logger),
            "uvicorn.error": dict(uvicorn_logger),
            "uvicorn.access": dict(uvicorn_logger),
        },
    }


def configure_logging(settings: Settings, *, force: bool = False) -> None:
    """Install the structured-logging dictConfig (idempotent).

    No-op on repeat calls (guarded by ``_configured``) and skipped under pytest
    so it never rips pytest's capture handler off the root logger mid-test — the
    formatter/filter are unit-tested directly via ``force=True``. ``force``
    bypasses both guards for those tests.
    """
    global _configured
    if not force:
        if _configured:
            return
        if "PYTEST_CURRENT_TEST" in os.environ:
            return
    logging.config.dictConfig(build_logging_dict_config(settings))
    if not force:
        _configured = True
