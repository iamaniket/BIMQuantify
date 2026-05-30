"""Validate the head of an uploaded CAD file as DXF or DWG.

The API only confirms the file *is* what its extension claims via a cheap
magic-byte / structural sniff; full parsing (and DWG -> DXF conversion) happens
in the processor.

DWG: every DWG opens with a 6-byte version tag `ACxxxx` (e.g. `AC1027` for the
R2013 format). We accept any `AC10`/`AC1`-prefixed tag rather than enumerate
versions — dwg2dxf in the processor is the real gate on whether we can read it.

DXF: two encodings exist.
  * ASCII DXF — a sequence of group-code/value lines. The first group code is
    `0` followed by `SECTION`; near the top there's a `HEADER` section. We accept
    if the (whitespace-stripped) head begins with `0` and contains `SECTION`, or
    contains the `HEADER` marker — tolerant of CRLF/LF and a leading BOM.
  * Binary DXF — opens with the literal sentinel `AutoCAD Binary DXF\r\n\x1a\x00`.
"""

from __future__ import annotations

DWG_MAGIC = b"AC10"
DXF_BINARY_SENTINEL = b"AutoCAD Binary DXF"

_BOM = b"\xef\xbb\xbf"


def looks_like_dwg(blob: bytes) -> bool:
    """True if `blob` opens with a DWG `ACxxxx` version tag."""
    return blob.startswith(DWG_MAGIC)


def looks_like_dxf(blob: bytes) -> bool:
    """True if `blob` is a plausible ASCII or binary DXF."""
    if blob.startswith(DXF_BINARY_SENTINEL):
        return True

    head = blob
    if head.startswith(_BOM):
        head = head[len(_BOM) :]
    head = head.lstrip()

    # ASCII DXF starts with group code 0 then SECTION; HEADER/TABLES/ENTITIES
    # markers appear near the top. Be lenient about which one we see first.
    if head.startswith(b"0") and b"SECTION" in blob:
        return True
    return b"HEADER" in blob and b"SECTION" in blob
