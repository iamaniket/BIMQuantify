"""Compliance checking — MCP client code.

Connects to the compliance checker MCP server and dispatches checks
for any supported framework (BBL, WKB).
"""

from __future__ import annotations

import logging
from typing import Any

import httpx

from bimstitch_api.config import Settings

logger = logging.getLogger(__name__)


class ComplianceCheckError(Exception):
    pass


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
    """Call the compliance checker MCP server's check_compliance tool."""
    url = f"{settings.compliance_checker_url}/mcp"
    timeout = settings.compliance_checker_timeout_seconds

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
                headers={"Content-Type": "application/json"},
            )
            response.raise_for_status()
    except httpx.HTTPError as exc:
        logger.error("Compliance checker request failed: %s", exc)
        raise ComplianceCheckError(f"Compliance checker unreachable: {exc}") from exc

    data = response.json()

    if "error" in data:
        error_msg = data["error"].get("message", "Unknown MCP error")
        raise ComplianceCheckError(f"Compliance checker error: {error_msg}")

    result = data.get("result")
    if result is None:
        raise ComplianceCheckError("Compliance checker returned empty result")

    if isinstance(result, list) and len(result) > 0:
        content = result[0].get("text", "{}")
        import json

        return json.loads(content)  # type: ignore[no-any-return]

    return result  # type: ignore[no-any-return]
