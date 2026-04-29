"""Validate the head of an uploaded file as an IFC STEP file.

STEP-21 (ISO 10303-21) header looks like:

    ISO-10303-21;
    HEADER;
    FILE_DESCRIPTION(...);
    FILE_NAME(...);
    FILE_SCHEMA(('IFC4'));
    ENDSEC;
    DATA;
    ...

We only care about the magic line and the FILE_SCHEMA name.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from enum import StrEnum

from bimstitch_api.models.project_file import IfcSchema

ISO_MAGIC = b"ISO-10303-21"

# Tolerate FILE_SCHEMA(('IFC4')) and FILE_SCHEMA(("IFC4")) and whitespace/newlines.
_FILE_SCHEMA_RE = re.compile(rb"FILE_SCHEMA\s*\(\s*\(\s*['\"]([A-Za-z0-9_]+)['\"]")

# Supported schemas: IFC2X3, IFC4 (4.0), IFC4X3 (4.3). IFC4X1 is intentionally
# excluded — see plan; the IfcSchema enum still carries ifc4x1 for backwards-
# compat with any historical rows but the parser will not accept it.
_KNOWN_SCHEMAS: dict[str, IfcSchema] = {
    "IFC2X3": IfcSchema.ifc2x3,
    "IFC4": IfcSchema.ifc4,
    "IFC4X3": IfcSchema.ifc4x3,
}

# UTF-8 BOM, occasionally seen in files exported by Windows tooling.
_BOM = b"\xef\xbb\xbf"


class HeaderRejection(StrEnum):
    not_step = "FILE_NOT_ISO_10303_21"
    no_schema = "FILE_SCHEMA_MISSING"
    unknown_schema = "FILE_SCHEMA_UNSUPPORTED"


@dataclass(frozen=True)
class HeaderResult:
    schema: IfcSchema | None
    rejection: HeaderRejection | None


def parse_ifc_header(blob: bytes) -> HeaderResult:
    head = blob
    if head.startswith(_BOM):
        head = head[len(_BOM) :]
    head = head.lstrip()
    if not head.startswith(ISO_MAGIC):
        return HeaderResult(schema=None, rejection=HeaderRejection.not_step)

    match = _FILE_SCHEMA_RE.search(blob)
    if match is None:
        return HeaderResult(schema=None, rejection=HeaderRejection.no_schema)

    raw = match.group(1).decode("ascii", "replace").upper()
    matched = _KNOWN_SCHEMAS.get(raw)
    if matched is None:
        return HeaderResult(schema=IfcSchema.unknown, rejection=HeaderRejection.unknown_schema)
    return HeaderResult(schema=matched, rejection=None)
