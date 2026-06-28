"""Tests for the throttled-warning helper used by the Redis-outage log paths."""

import logging

import pytest

from bimdossier_api import logging_utils
from bimdossier_api.logging_utils import warn_throttled


def test_warn_throttled_emits_then_suppresses_within_interval(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    logger = logging.getLogger("test.throttle")
    logging_utils._last_warned.pop("k", None)  # isolate this key's state

    clock = {"t": 1000.0}
    monkeypatch.setattr(logging_utils.time, "monotonic", lambda: clock["t"])

    with caplog.at_level(logging.DEBUG, logger="test.throttle"):
        warn_throttled(logger, "k", "msg", interval=30.0)  # first → WARNING
        clock["t"] += 5
        warn_throttled(logger, "k", "msg", interval=30.0)  # within window → DEBUG
        clock["t"] += 30
        warn_throttled(logger, "k", "msg", interval=30.0)  # window elapsed → WARNING

    warnings = [r for r in caplog.records if r.levelno == logging.WARNING]
    debugs = [r for r in caplog.records if r.levelno == logging.DEBUG]
    assert len(warnings) == 2
    assert len(debugs) == 1


def test_warn_throttled_keys_are_independent(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    logger = logging.getLogger("test.throttle")
    for key in ("a", "b"):
        logging_utils._last_warned.pop(key, None)

    monkeypatch.setattr(logging_utils.time, "monotonic", lambda: 2000.0)

    with caplog.at_level(logging.DEBUG, logger="test.throttle"):
        warn_throttled(logger, "a", "msg-a", interval=30.0)  # WARNING
        warn_throttled(logger, "b", "msg-b", interval=30.0)  # WARNING (different key)

    warnings = [r for r in caplog.records if r.levelno == logging.WARNING]
    assert len(warnings) == 2
