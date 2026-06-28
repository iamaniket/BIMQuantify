"""RFC 6266-safe ``Content-Disposition`` header construction.

User-controlled filenames flow into download headers — ``ProjectFile.original_filename``,
``Project.name`` (BCF export), the ``framework`` query param (compliance CSV).
A bare ``f'attachment; filename="{name}"'`` lets a ``"`` break out of the quoted
string (filename spoofing) and a CR/LF inject a header line. This builds the
header the safe way for every download choke-point:

* a quoted ASCII ``filename="..."`` fallback with control / quote / backslash
  characters neutralized, and
* an RFC 5987 ``filename*=UTF-8''...`` parameter carrying the full UTF-8 name,

so modern clients recover the real (possibly Unicode) name while legacy clients
get a safe ASCII approximation. Used by the storage presign choke-point
(``S3Storage.presigned_get_url`` → S3 ``ResponseContentDisposition``) and the few
routers that stream a body with a user-influenced filename directly.
"""

from __future__ import annotations

import re
from urllib.parse import quote

_DISPOSITIONS = frozenset({"attachment", "inline"})
# Characters that would break out of the quoted-string or inject a header line:
# C0 controls, DEL, the double-quote that closes the value, and the backslash
# that could escape it.
_UNSAFE_ASCII = re.compile(r'[\x00-\x1f\x7f"\\]')


def safe_content_disposition(filename: str, *, disposition: str = "attachment") -> str:
    """Return a header value safe to interpolate from a user-controlled filename."""
    disp = disposition if disposition in _DISPOSITIONS else "attachment"
    raw = (filename or "").strip() or "download"
    # ASCII fallback: drop non-ASCII, then neutralize quote / backslash / controls.
    ascii_name = _UNSAFE_ASCII.sub("_", raw.encode("ascii", "ignore").decode("ascii")).strip()
    if not ascii_name:
        ascii_name = "download"
    # RFC 5987 extended form preserves the full UTF-8 name for modern clients.
    encoded = quote(raw, safe="")
    return f"{disp}; filename=\"{ascii_name}\"; filename*=UTF-8''{encoded}"
