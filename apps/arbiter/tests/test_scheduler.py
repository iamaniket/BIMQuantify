from __future__ import annotations

import threading
from unittest.mock import patch

from arbiter.config import Settings
from arbiter.rules.loader import RuleIndex
from arbiter.sync.scheduler import start_scheduler


def test_start_scheduler_uses_daemon_thread_without_running_loop() -> None:
    rule_index = RuleIndex()
    settings = Settings(ARBITER_SYNC_INTERVAL_HOURS=24)

    with patch("arbiter.sync.scheduler._run_scheduler_thread") as runner:
        handle = start_scheduler(rule_index, settings)

    assert isinstance(handle, threading.Thread)
    assert handle.daemon is True
    assert handle.name == "arbiter-sync-scheduler"
    handle.join(timeout=1)
    runner.assert_called_once_with(rule_index, settings)