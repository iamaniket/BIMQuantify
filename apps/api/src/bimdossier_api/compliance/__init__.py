"""Compliance checking — MCP client code.

Connects to the Arbiter MCP server and dispatches checks
for any supported framework (BBL, WKB).
"""

from __future__ import annotations

import json
import logging
from typing import Any

import httpx

from bimdossier_api.config import Settings

logger = logging.getLogger(__name__)


class ComplianceCheckError(Exception):
    pass


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
            return json.loads(content)  # type: ignore[no-any-return]
        except json.JSONDecodeError as exc:
            raise ComplianceCheckError(f"Arbiter returned non-JSON content: {exc}") from exc

    if isinstance(result, dict) and "content" in result:
        content_items = result.get("content", [])
        if isinstance(content_items, list) and len(content_items) > 0:
            text = content_items[0].get("text")
            if text is None:
                raise ComplianceCheckError("Arbiter content item had no text")
            try:
                return json.loads(text)  # type: ignore[no-any-return]
            except json.JSONDecodeError as exc:
                raise ComplianceCheckError(f"Arbiter returned non-JSON content: {exc}") from exc
        if isinstance(result.get("structuredContent"), dict):
            return result["structuredContent"]  # type: ignore[no-any-return]

    return result  # type: ignore[no-any-return]
