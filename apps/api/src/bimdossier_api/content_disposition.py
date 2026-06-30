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

import os
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


# Canonical MIME per allowed attachment extension. At download time the SERVED
# content-type is derived from the filename extension and passed to S3 as
# ``ResponseContentType``, which OVERRIDES whatever the uploader stored (the stored
# value is caller-controlled — used only to sign the PUT). So a ``.txt`` that was
# initiated declaring ``text/html`` can never be served back inline as HTML
# (stored-XSS on the shared storage origin). Kept in lockstep with
# ``ATTACHMENT_ALLOWED_EXTENSIONS`` (models/project_file.py); unknown extensions
# fall back to the inert octet-stream. See test_attachments / test_pooled_attachments.
_ATTACHMENT_CONTENT_TYPES: dict[str, str] = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".heic": "image/heic",
    ".mp4": "video/mp4",
    ".mov": "video/quicktime",
    ".webm": "video/webm",
    ".mp3": "audio/mpeg",
    ".m4a": "audio/mp4",
    ".wav": "audio/wav",
    ".ogg": "audio/ogg",
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".txt": "text/plain",
}
_FALLBACK_CONTENT_TYPE = "application/octet-stream"
# Only these canonical served types are safe to render INLINE in a browser tab
# (no script execution). Everything else is forced to ``attachment`` regardless of
# the requested disposition — S3 presigned GETs can't carry ``X-Content-Type-Options:
# nosniff``, so a forced download is the backstop for sniffable types.
_INLINE_SAFE_CONTENT_TYPES = frozenset(
    {"image/jpeg", "image/png", "image/webp", "image/heic", "application/pdf"}
)


def safe_attachment_content_type(filename: str) -> str:
    """Canonical, inert MIME type for an attachment, derived from its extension."""
    ext = os.path.splitext(filename or "")[1].lower()
    return _ATTACHMENT_CONTENT_TYPES.get(ext, _FALLBACK_CONTENT_TYPE)


def resolve_attachment_download(
    filename: str, requested_disposition: str
) -> tuple[str, str]:
    """Resolve the safe ``(content_type, disposition)`` for an attachment download.

    Returns the canonical content-type for the file's extension (overriding the
    caller-supplied stored type) and a disposition forced to ``attachment`` unless
    the canonical type is inline-safe (images / PDF) and inline was requested. This
    is the choke-point that lets the snag-photo gallery preview images inline while
    making it impossible to serve uploaded HTML/script inline.
    """
    content_type = safe_attachment_content_type(filename)
    disposition = requested_disposition if requested_disposition in _DISPOSITIONS else "attachment"
    if disposition == "inline" and content_type not in _INLINE_SAFE_CONTENT_TYPES:
        disposition = "attachment"
    return content_type, disposition
