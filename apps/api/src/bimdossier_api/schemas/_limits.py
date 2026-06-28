"""Shared input-size guards for request schemas (M-input hardening).

The global body-size middleware (B3, ``RequestBodySizeLimitMiddleware``) caps a
request at a coarse 100 MB — far too loose to stop a single JSONB column from
ballooning a tenant row, or an unbounded list field from amplifying into a
million-row insert. These per-field caps are the tight, defense-in-depth layer:

* item-count + per-item caps on list fields (applied as ``Field(max_length=...)``
  and ``Annotated[str, StringConstraints(...)]`` at the use site), and
* a serialized-byte cap on free-form ``dict[str, Any]`` JSONB fields — which a
  scalar ``max_length`` can only bound by *key count*, never by depth or value
  size, so a single key with a 90 MB string value would slip through.
"""

from __future__ import annotations

import json
from typing import Annotated, Any

from pydantic import AfterValidator

# Free-form JSONB dict byte caps. ``device`` is a small client fingerprint
# (user-agent / platform / screen) on an *unauthenticated* capture upload;
# ``annotation_state`` is a vector-markup document that can hold many shapes.
DEVICE_METADATA_MAX_BYTES = 16 * 1024
ANNOTATION_STATE_MAX_BYTES = 1024 * 1024


def _bounded_json(max_bytes: int) -> AfterValidator:
    """An ``AfterValidator`` that rejects a dict serializing past ``max_bytes``."""

    def _check(value: Any) -> Any:
        if value is None:
            return value
        # Compact separators so the cap reflects payload size, not formatting.
        encoded = json.dumps(value, separators=(",", ":"), default=str)
        if len(encoded.encode("utf-8")) > max_bytes:
            raise ValueError(f"JSON payload exceeds {max_bytes} bytes")
        return value

    return AfterValidator(_check)


BoundedDeviceMetadata = Annotated[dict[str, Any], _bounded_json(DEVICE_METADATA_MAX_BYTES)]
BoundedAnnotationState = Annotated[dict[str, Any], _bounded_json(ANNOTATION_STATE_MAX_BYTES)]
