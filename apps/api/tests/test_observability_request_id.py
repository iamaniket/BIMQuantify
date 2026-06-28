"""Tests for M-obs1: request-id correlation + structured logging.

Covers the whole correlation chain:
* ``RequestIdMiddleware`` always sets an ``X-Request-Id`` response header — a
  fresh one when absent, the inbound one when it's a safe token, a fresh one
  when the inbound value is malformed (anti-injection / column-width guard).
* ``audit._extract_request_context`` reads the request-scoped context var, so
  ``audit_log.request_id`` is populated (never NULL) during a request and
  carries the same id as the response header.
* The logging filter + JSON formatter stamp every record with the id.
* The Sentry ``before_send`` hook tags events with the id.
* ``Settings.resolved_log_format`` picks json/console correctly.
"""

from __future__ import annotations

import contextlib
import json
import logging
import re
from typing import TYPE_CHECKING

import pytest

if TYPE_CHECKING:
    from collections.abc import Iterator

from bimdossier_api.audit import _extract_request_context
from bimdossier_api.logging_config import (
    JsonLogFormatter,
    RequestIdFilter,
    build_logging_dict_config,
)
from bimdossier_api.logging_utils import get_request_id, request_id_ctx
from bimdossier_api.observability import _tag_request_id
from tests.conftest import _TEST_PASSWORD, _audit_rows

_HEX32 = re.compile(r"^[0-9a-f]{32}$")


@contextlib.contextmanager
def _bound_request_id(value: str | None) -> Iterator[None]:
    """Set the request-id context var for the block, restoring it after.

    Passing ``None`` explicitly pins it to "no request context" regardless of
    any leakage from a prior test's context.
    """
    token = request_id_ctx.set(value)
    try:
        yield
    finally:
        request_id_ctx.reset(token)


# ---------------------------------------------------------------------------
# Middleware — response header behaviour
# ---------------------------------------------------------------------------


async def test_response_includes_generated_request_id(client) -> None:
    resp = await client.get("/health")
    assert resp.status_code == 200
    rid = resp.headers.get("X-Request-Id")
    assert rid is not None
    assert _HEX32.match(rid), rid


async def test_valid_inbound_request_id_is_echoed(client) -> None:
    trace = "trace-123_ABC.def"
    resp = await client.get("/health", headers={"X-Request-Id": trace})
    assert resp.headers.get("X-Request-Id") == trace


@pytest.mark.parametrize(
    "bad",
    [
        "x" * 65,  # over the 64-char column width
        "has space",  # space not in the safe-token set
        "bad;value",  # punctuation outside the safe-token set
        "trace@host",  # ditto
    ],
)
async def test_invalid_inbound_request_id_is_replaced(client, bad: str) -> None:
    resp = await client.get("/health", headers={"X-Request-Id": bad})
    rid = resp.headers.get("X-Request-Id")
    assert rid != bad
    assert rid is not None and _HEX32.match(rid), rid


# ---------------------------------------------------------------------------
# End-to-end: the id flows into audit_log.request_id
# ---------------------------------------------------------------------------


async def test_audit_row_carries_request_id(client, org_user, session_maker) -> None:
    """A login audited mid-request gets the request's id — never NULL."""
    trace = "login-trace-xyz789"
    resp = await client.post(
        "/auth/jwt/login",
        data={"username": org_user["email"], "password": _TEST_PASSWORD},
        headers={"X-Request-Id": trace},
    )
    assert resp.status_code == 200, resp.text
    assert resp.headers.get("X-Request-Id") == trace

    rows = await _audit_rows(session_maker, "auth.login.success")
    assert rows, "expected at least one auth.login.success audit row"
    # The login we drove with the custom header is among them...
    assert any(r.request_id == trace for r in rows)
    # ...and no login row landed with a NULL request_id (the original bug):
    # the fixture's own login got a generated id, not NULL.
    assert all(r.request_id for r in rows)


# ---------------------------------------------------------------------------
# audit._extract_request_context — context-var sourcing
# ---------------------------------------------------------------------------


def test_extract_request_context_uses_context_var_without_request() -> None:
    with _bound_request_id("ctx-abc"):
        request_id, ip, ua = _extract_request_context(None)
    assert request_id == "ctx-abc"
    assert ip is None and ua is None


def test_extract_request_context_truncates_to_column_width() -> None:
    with _bound_request_id("z" * 200):
        request_id, _, _ = _extract_request_context(None)
    assert request_id is not None and len(request_id) == 64


def test_extract_request_context_falls_back_to_header() -> None:
    from starlette.requests import Request

    scope = {
        "type": "http",
        "headers": [
            (b"x-request-id", b"header-id"),
            (b"user-agent", b"pytest-agent"),
        ],
        "client": ("203.0.113.7", 5555),
    }
    req = Request(scope)
    # No context var bound (pin to None) → the raw header is the fallback.
    with _bound_request_id(None):
        request_id, ip, ua = _extract_request_context(req)
    assert request_id == "header-id"
    assert ip == "203.0.113.7"
    assert ua == "pytest-agent"


def test_extract_request_context_prefers_context_var_over_header() -> None:
    from starlette.requests import Request

    scope = {
        "type": "http",
        "headers": [(b"x-request-id", b"header-id")],
        "client": ("203.0.113.7", 5555),
    }
    req = Request(scope)
    with _bound_request_id("ctx-wins"):
        request_id, _, _ = _extract_request_context(req)
    assert request_id == "ctx-wins"


# ---------------------------------------------------------------------------
# Logging filter + JSON formatter
# ---------------------------------------------------------------------------


def _make_record(message: str = "hello", *args: object) -> logging.LogRecord:
    return logging.LogRecord(
        name="bimdossier_api.test",
        level=logging.INFO,
        pathname=__file__,
        lineno=10,
        msg=message,
        args=args,
        exc_info=None,
    )


def test_request_id_filter_stamps_id() -> None:
    record = _make_record()
    with _bound_request_id("filt-id"):
        assert RequestIdFilter().filter(record) is True
    assert record.request_id == "filt-id"


def test_request_id_filter_uses_sentinel_outside_request() -> None:
    record = _make_record()
    with _bound_request_id(None):
        RequestIdFilter().filter(record)
    assert record.request_id == "-"


def test_json_formatter_emits_valid_json_with_request_id() -> None:
    record = _make_record("hello %s", "world")
    with _bound_request_id("json-id"):
        line = JsonLogFormatter().format(record)
    data = json.loads(line)
    assert data["message"] == "hello world"
    assert data["level"] == "INFO"
    assert data["logger"] == "bimdossier_api.test"
    assert data["request_id"] == "json-id"


def test_json_formatter_merges_extra_fields() -> None:
    record = _make_record("with extra")
    record.org_id = "org-42"  # mimics logger.info(..., extra={"org_id": ...})
    with _bound_request_id("json-id"):
        data = json.loads(JsonLogFormatter().format(record))
    assert data["org_id"] == "org-42"


def test_json_formatter_includes_exception() -> None:
    try:
        raise ValueError("boom")
    except ValueError:
        import sys

        record = logging.LogRecord(
            name="bimdossier_api.test",
            level=logging.ERROR,
            pathname=__file__,
            lineno=10,
            msg="failed",
            args=(),
            exc_info=sys.exc_info(),
        )
    with _bound_request_id("err-id"):
        data = json.loads(JsonLogFormatter().format(record))
    assert "ValueError: boom" in data["exc_info"]


# ---------------------------------------------------------------------------
# Sentry before_send
# ---------------------------------------------------------------------------


def test_sentry_before_send_tags_request_id() -> None:
    with _bound_request_id("sentry-id"):
        event = _tag_request_id({}, {})
    assert event["tags"]["request_id"] == "sentry-id"


def test_sentry_before_send_is_noop_without_request() -> None:
    with _bound_request_id(None):
        event = _tag_request_id({}, {})
    assert "request_id" not in event.get("tags", {})


def test_get_request_id_default_is_none() -> None:
    with _bound_request_id(None):
        assert get_request_id() is None


# ---------------------------------------------------------------------------
# Config — resolved_log_format + dictConfig shape
# ---------------------------------------------------------------------------


def _settings():
    # _env_file=None → ignore any on-disk .env so the resolver is driven purely
    # by the env vars conftest/monkeypatch set (deterministic).
    from bimdossier_api.config import Settings

    return Settings(_env_file=None)


def test_resolved_log_format(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("LOG_FORMAT", raising=False)
    monkeypatch.setenv("DEPLOY_REGION", "dev")
    assert _settings().resolved_log_format == "console"

    monkeypatch.setenv("DEPLOY_REGION", "eu-west")
    assert _settings().resolved_log_format == "json"

    monkeypatch.setenv("LOG_FORMAT", "console")
    assert _settings().resolved_log_format == "console"

    monkeypatch.setenv("LOG_FORMAT", "JSON")  # case-insensitive
    assert _settings().resolved_log_format == "json"

    monkeypatch.setenv("LOG_FORMAT", "garbage")  # unrecognised → falls back
    assert _settings().resolved_log_format == "json"


def test_build_logging_dict_config_shape(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("LOG_FORMAT", "json")
    cfg = build_logging_dict_config(_settings())
    assert cfg["disable_existing_loggers"] is False
    assert cfg["handlers"]["default"]["formatter"] == "json"
    assert "request_id" in cfg["filters"]
    assert "request_id" in cfg["handlers"]["default"]["filters"]
    # uvicorn's loggers are rerouted through the shared handler.
    assert cfg["loggers"]["uvicorn.access"]["handlers"] == ["default"]
    assert cfg["root"]["handlers"] == ["default"]
