"""Unit tests for the API → Arbiter MCP client (`run_compliance_check`).

Two concerns covered here:
- The Arbiter reads the shared IFC bucket and rewrites rule packs, so every MCP
  call MUST carry the shared-secret bearer (asserted on a well-formed result).
- A malformed/empty Arbiter payload must NOT be returned verbatim — the caller
  would persist it as a SUCCEEDED 0-rule "clean" report (a silent false-pass), so
  the client validates the structural shape and raises ``ComplianceCheckError``.

The rest of the compliance plumbing is covered by test_compliance_check.py.
"""

from __future__ import annotations

import json
from typing import Any, ClassVar

import httpx
import pytest

from bimdossier_api.compliance import ComplianceCheckError, run_compliance_check
from bimdossier_api.config import get_settings

# A minimal but structurally-complete Arbiter result (0 rules applicable). Every
# key the consumer reads is present, so it validates and round-trips unchanged.
_VALID_RESULT: dict[str, Any] = {
    "file_id": "00000000-0000-0000-0000-000000000000",
    "framework": "bbl",
    "checked_at": "2026-01-01T00:00:00+00:00",
    "total_rules": 0,
    "total_elements_checked": 0,
    "rules_summary": [],
    "category_summary": [],
    "details": [],
}


def _stub_arbiter(monkeypatch: pytest.MonkeyPatch, *, text: str, captured: dict[str, Any]) -> None:
    """Patch ``httpx.AsyncClient`` to return one MCP tool result whose
    ``result.content[0].text`` is ``text`` and record the outgoing request."""

    class _Resp:
        headers: ClassVar[dict[str, str]] = {"content-type": "application/json"}

        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict[str, Any]:
            return {"jsonrpc": "2.0", "id": 1, "result": {"content": [{"text": text}]}}

    class _Client:
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            pass

        async def __aenter__(self) -> _Client:
            return self

        async def __aexit__(self, *args: Any) -> bool:
            return False

        async def post(self, url: str, *, json: Any, headers: dict[str, str]) -> _Resp:
            captured["url"] = url
            captured["headers"] = headers
            return _Resp()

    monkeypatch.setattr(httpx, "AsyncClient", _Client)


async def _run() -> dict[str, Any]:
    return await run_compliance_check(
        metadata_key="projects/x/source/y.metadata.json",
        properties_key="projects/x/source/y.properties.json",
        file_id="00000000-0000-0000-0000-000000000000",
        settings=get_settings(),
        framework="bbl",
    )


async def test_run_compliance_check_sends_bearer(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, Any] = {}
    _stub_arbiter(monkeypatch, text=json.dumps(_VALID_RESULT), captured=captured)

    result = await _run()

    assert result == _VALID_RESULT
    assert captured["url"].endswith("/mcp")
    assert captured["headers"]["Authorization"] == "Bearer dev-arbiter-secret-change-me"


async def test_run_compliance_check_rejects_empty_result(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # An empty object is missing every structural key. The old code returned it
    # verbatim and the caller persisted a SUCCEEDED 0-rule report; it must now
    # raise so the caller records a FAILED job and returns 503.
    _stub_arbiter(monkeypatch, text="{}", captured={})

    with pytest.raises(ComplianceCheckError):
        await _run()


async def test_run_compliance_check_rejects_partial_result(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # A payload that looks populated but omits one structural key (here
    # `rules_summary`) must be rejected rather than read as "zero rules".
    partial = {k: v for k, v in _VALID_RESULT.items() if k != "rules_summary"}
    _stub_arbiter(monkeypatch, text=json.dumps(partial), captured={})

    with pytest.raises(ComplianceCheckError):
        await _run()
