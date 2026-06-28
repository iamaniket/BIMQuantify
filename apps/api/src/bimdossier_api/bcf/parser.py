"""Parse a BCF 2.1 or 3.0 ZIP archive into dataclasses.

The ZIP layout follows the buildingSMART BCF spec:
  bcf.version            — XML declaring the BCF version
  <topic-guid>/
    markup.bcf           — BCF 2.1 topic XML
    topic.json           — BCF 3.0 topic JSON (alternative)
    <viewpoint-guid>.bcfv  — BCF 2.1 viewpoint XML
    <viewpoint-guid>.json  — BCF 3.0 viewpoint JSON
    <viewpoint-guid>.png   — viewpoint snapshot image
"""

from __future__ import annotations

import io
import xml.etree.ElementTree as ET
import zipfile

from defusedxml.ElementTree import fromstring as _safe_fromstring

from bimdossier_api.bcf.json_utils import parse_topic_json, parse_viewpoint_json
from bimdossier_api.bcf.types import ParsedBcf, ParsedViewpoint
from bimdossier_api.bcf.xml_utils import parse_markup_xml, parse_viewpoint_xml

# Structural caps that bound a malicious BCF zip *before any entry is
# decompressed*. Every check reads the central-directory metadata (``ZipInfo``),
# so a bomb is refused without ``zf.read()`` ever inflating it. The raw upload
# byte cap is enforced at the endpoint (``settings.bcf_import_max_bytes``); these
# are security invariants, not per-deploy tunables.
BCF_MAX_ENTRIES = 10_000
BCF_MAX_ENTRY_BYTES = 50 * 1024 * 1024  # 50 MiB uncompressed, any single entry
BCF_MAX_TOTAL_UNCOMPRESSED_BYTES = 250 * 1024 * 1024  # 250 MiB across all entries
BCF_MAX_COMPRESSION_RATIO = 100  # total uncompressed / total compressed


class BcfArchiveError(Exception):
    """The uploaded BCF archive is structurally unacceptable."""


class BcfArchiveTooLargeError(BcfArchiveError):
    """The BCF archive trips a size / entry-count / compression-ratio cap."""


def _validate_archive_safety(zf: zipfile.ZipFile) -> None:
    """Reject zip-bomb-shaped archives using central-directory metadata only.

    No entry is decompressed here — every check reads ``ZipInfo`` fields, so a
    bomb (huge declared size, absurd ratio, entry-count flood) is refused before
    ``zf.read()`` ever inflates it.
    """
    infos = zf.infolist()
    if len(infos) > BCF_MAX_ENTRIES:
        raise BcfArchiveTooLargeError(
            f"BCF archive has {len(infos)} entries (limit {BCF_MAX_ENTRIES})"
        )
    total_uncompressed = 0
    total_compressed = 0
    for info in infos:
        if info.file_size > BCF_MAX_ENTRY_BYTES:
            raise BcfArchiveTooLargeError(
                f"BCF entry {info.filename!r} is {info.file_size} bytes "
                f"(limit {BCF_MAX_ENTRY_BYTES})"
            )
        total_uncompressed += info.file_size
        total_compressed += info.compress_size
    if total_uncompressed > BCF_MAX_TOTAL_UNCOMPRESSED_BYTES:
        raise BcfArchiveTooLargeError(
            f"BCF archive decompresses to {total_uncompressed} bytes "
            f"(limit {BCF_MAX_TOTAL_UNCOMPRESSED_BYTES})"
        )
    if total_compressed > 0 and total_uncompressed / total_compressed > BCF_MAX_COMPRESSION_RATIO:
        ratio = total_uncompressed / total_compressed
        raise BcfArchiveTooLargeError(
            f"BCF archive compression ratio {ratio:.0f}:1 exceeds {BCF_MAX_COMPRESSION_RATIO}:1"
        )


def _detect_version(zf: zipfile.ZipFile) -> str:
    """Read bcf.version to determine BCF 2.1 vs 3.0."""
    try:
        version_data = zf.read("bcf.version")
    except KeyError:
        return "2.1"

    text = version_data.decode("utf-8", errors="replace").strip()

    # BCF 3.0 might use JSON
    if text.startswith("{"):
        import json

        d = json.loads(text)
        return d.get("version_id", "3.0")

    # BCF 2.1 uses XML
    try:
        root = _safe_fromstring(text)
        vid = root.get("VersionId", "")
        if vid:
            return vid
        detail = root.find("DetailedVersion")
        if detail is not None and detail.text:
            return detail.text.strip()
    except ET.ParseError:
        pass

    return "2.1"


def _topic_folders(zf: zipfile.ZipFile) -> dict[str, list[str]]:
    """Group ZIP entries by their top-level folder (the topic GUID)."""
    folders: dict[str, list[str]] = {}
    for name in zf.namelist():
        parts = name.split("/")
        if len(parts) >= 2 and parts[0] not in ("", "bcf.version"):
            folders.setdefault(parts[0], []).append(name)
    return folders


def parse_bcf_archive(data: bytes) -> ParsedBcf:
    """Parse a BCF ZIP archive (2.1 or 3.0) into structured data."""
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        _validate_archive_safety(zf)
        version = _detect_version(zf)
        folders = _topic_folders(zf)

        result = ParsedBcf(version=version)

        for topic_guid, entries in folders.items():
            # Determine the markup file
            markup_name = f"{topic_guid}/markup.bcf"
            topic_json_name = f"{topic_guid}/topic.json"

            if topic_json_name in entries:
                topic = parse_topic_json(zf.read(topic_json_name))
            elif markup_name in entries:
                topic = parse_markup_xml(zf.read(markup_name))
            else:
                continue

            # Ensure guid is set
            if not topic.guid:
                topic.guid = topic_guid

            # Parse viewpoint files and merge with placeholder viewpoints
            vp_by_guid: dict[str, ParsedViewpoint] = {}
            for entry in entries:
                filename = entry.split("/")[-1]
                if filename.endswith(".bcfv"):
                    vp = parse_viewpoint_xml(zf.read(entry))
                    vp_by_guid[vp.guid] = vp
                elif filename.endswith(".json") and filename != "topic.json":
                    vp_guid = filename.removesuffix(".json")
                    vp = parse_viewpoint_json(zf.read(entry))
                    if not vp.guid:
                        vp.guid = vp_guid
                    vp_by_guid[vp.guid] = vp

            # Extract snapshots
            snapshot_by_guid: dict[str, bytes] = {}
            for entry in entries:
                filename = entry.split("/")[-1]
                if filename.endswith(".png"):
                    snap_guid = filename.removesuffix(".png")
                    snapshot_by_guid[snap_guid] = zf.read(entry)

            # Merge viewpoint data with topic's viewpoint references
            merged_viewpoints: list[ParsedViewpoint] = []
            seen_guids: set[str] = set()

            for placeholder in topic.viewpoints:
                if placeholder.guid in vp_by_guid:
                    vp = vp_by_guid[placeholder.guid]
                    vp.index = placeholder.index
                else:
                    vp = placeholder

                if vp.guid in snapshot_by_guid:
                    vp.snapshot_data = snapshot_by_guid[vp.guid]

                merged_viewpoints.append(vp)
                seen_guids.add(vp.guid)

            # Add viewpoints found in files but not referenced in markup
            for vp_guid, vp in vp_by_guid.items():
                if vp_guid not in seen_guids:
                    if vp_guid in snapshot_by_guid:
                        vp.snapshot_data = snapshot_by_guid[vp_guid]
                    vp.index = len(merged_viewpoints)
                    merged_viewpoints.append(vp)

            topic.viewpoints = merged_viewpoints
            result.topics.append(topic)

        return result
