"""Compliance checking — MCP client code.

Connects to the Arbiter MCP server and dispatches checks
for any supported framework (BBL, WKB).
"""

from __future__ import annotations

import json
import logging
from typing import TYPE_CHECKING, Any

import httpx
from pydantic import ValidationError

from bimdossier_api.schemas.compliance import ArbiterComplianceResult

if TYPE_CHECKING:
    from bimdossier_api.config import Settings

logger = logging.getLogger(__name__)


class ComplianceCheckError(Exception):
    pass


def _validate_arbiter_result(parsed: Any) -> dict[str, Any]:
    """Gate a parsed Arbiter payload against the expected compliance shape.

    The caller persists this as a SUCCEEDED job result and reads it with
    ``result.get(key, <empty default>)``; a payload missing the structural keys
    would otherwise be stored as a clean 0-rule report — a silent false-pass.
    We require those keys (``checked_at``/``total_rules``/``rules_summary``/…) and
    raise ``ComplianceCheckError`` on any mismatch so the caller records a FAILED
    job and returns 503. The original dict is returned unchanged, so Arbiter
    extras (``file_id``, ``details[].reasoning``, …) are preserved.
    """
    if not isinstance(parsed, dict):
        raise ComplianceCheckError(
            f"Arbiter returned a non-object compliance result ({type(parsed).__name__})"
        )
    try:
        ArbiterComplianceResult.model_validate(parsed)
    except ValidationError as exc:
        errors = exc.errors()
        summary = f"{errors[0]['loc']}: {errors[0]['msg']}" if errors else "no detail"
        raise ComplianceCheckError(
            f"Arbiter returned a malformed compliance result: "
            f"{len(errors)} validation error(s); {summary}"
        ) from exc
    return parsed


def _parse_mcp_response(response: httpx.Response) -> dict[str, Any]:
    """Parse an MCP Streamable HTTP response (handles both JSON and SSE)."""
    content_type = response.headers.get("content-type", "")
    if "text/event-stream" in content_type:
        for line in response.text.splitlines():
            if line.startswith("data:"):
                payload = line[5:].strip()
                if payload:
                    return json.loads(payload)  # type: ignore[no-any-return]
        raise ComplianceCheckError("Empty SSE response from arbiter")
    return response.json()  # type: ignore[no-any-return]


async def run_compliance_check(
    *,
    metadata_key: str,
    properties_key: str,
    file_id: str,
    settings: Settings,
    building_type: str = "all",
    categories: list[str] | None = None,
    framework: str = "bbl",
) -> dict[str, Any]:
    """Call the Arbiter MCP server's check_compliance tool."""
    url = f"{settings.arbiter_url}/mcp"
    timeout = settings.arbiter_timeout_seconds

    tool_args: dict[str, Any] = {
        "metadata_key": metadata_key,
        "properties_key": properties_key,
        "file_id": file_id,
        "building_type": building_type,
        "framework": framework,
    }
    if categories:
        tool_args["categories"] = ",".join(categories)

    mcp_request = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/call",
        "params": {
            "name": "check_compliance",
            "arguments": tool_args,
        },
    }

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.post(
                url,
                json=mcp_request,
                headers={
                    "Content-Type": "application/json",
                    "Accept": "application/json, text/event-stream",
                    "Authorization": f"Bearer {settings.arbiter_shared_secret}",
                },
            )
            response.raise_for_status()
    except httpx.HTTPError as exc:
        logger.error("Arbiter request failed: %s", exc)
        raise ComplianceCheckError(f"Arbiter unreachable: {exc}") from exc

    data = _parse_mcp_response(response)

    if "error" in data:
        error_msg = data["error"].get("message", "Unknown MCP error")
        raise ComplianceCheckError(f"Arbiter error: {error_msg}")

    result = data.get("result")
    if result is None:
        raise ComplianceCheckError("Arbiter returned empty result")

    # A tool that raised is reported as a *successful* JSON-RPC response with
    # `isError: true` and the message in `content` (the MCP tool-error
    # convention) — NOT a protocol-level `data["error"]`. Without this check a
    # raised arbiter error would be json.loads'd as an empty/garbage result and
    # stored as a "0 rules / nothing checked" SUCCEEDED report (silent pass).
    if isinstance(result, dict) and result.get("isError"):
        text = ""
        content_items = result.get("content")
        if isinstance(content_items, list) and content_items:
            text = content_items[0].get("text", "")
        raise ComplianceCheckError(f"Arbiter tool error: {text or 'unknown'}")

    if isinstance(result, list) and len(result) > 0:
        content = result[0].get("text")
        if content is None:
            raise ComplianceCheckError("Arbiter result item had no text content")
        try:
            parsed = json.loads(content)
        except json.JSONDecodeError as exc:
            raise ComplianceCheckError(f"Arbiter returned non-JSON content: {exc}") from exc
        return _validate_arbiter_result(parsed)

    if isinstance(result, dict) and "content" in result:
        content_items = result.get("content", [])
        if isinstance(content_items, list) and len(content_items) > 0:
            text = content_items[0].get("text")
            if text is None:
                raise ComplianceCheckError("Arbiter content item had no text")
            try:
                parsed = json.loads(text)
            except json.JSONDecodeError as exc:
                raise ComplianceCheckError(f"Arbiter returned non-JSON content: {exc}") from exc
            return _validate_arbiter_result(parsed)
        if isinstance(result.get("structuredContent"), dict):
            return _validate_arbiter_result(result["structuredContent"])

    return _validate_arbiter_result(result)
