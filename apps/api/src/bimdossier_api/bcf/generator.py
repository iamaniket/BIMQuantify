"""Generate a BCF 2.1 or 3.0 ZIP archive from structured data."""

from __future__ import annotations

import io
import json
import xml.etree.ElementTree as ET
import zipfile

from bimdossier_api.bcf.json_utils import serialize_topic_json, serialize_viewpoint_json
from bimdossier_api.bcf.types import ParsedBcf, ParsedTopic
from bimdossier_api.bcf.xml_utils import serialize_markup_xml, serialize_viewpoint_xml


def _version_file_21() -> bytes:
    root = ET.Element("Version", VersionId="2.1")
    ET.SubElement(root, "DetailedVersion").text = "2.1"
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def _version_file_30() -> bytes:
    return json.dumps({"version_id": "3.0"}, indent=2).encode("utf-8")


def generate_bcf_archive(bcf: ParsedBcf) -> bytes:
    """Build a BCF ZIP archive from parsed data."""
    buf = io.BytesIO()
    is_30 = bcf.version.startswith("3")

    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("bcf.version", _version_file_30() if is_30 else _version_file_21())

        for topic in bcf.topics:
            _write_topic(zf, topic, is_30)

    return buf.getvalue()


def generate_single_topic_archive(topic: ParsedTopic, version: str = "2.1") -> bytes:
    """Convenience: wrap a single topic in a BCF archive."""
    bcf = ParsedBcf(version=version, topics=[topic])
    return generate_bcf_archive(bcf)


def _write_topic(zf: zipfile.ZipFile, topic: ParsedTopic, is_30: bool) -> None:
    prefix = f"{topic.guid}/"

    if is_30:
        zf.writestr(f"{prefix}topic.json", serialize_topic_json(topic))
    else:
        zf.writestr(f"{prefix}markup.bcf", serialize_markup_xml(topic))

    for vp in topic.viewpoints:
        if is_30:
            zf.writestr(f"{prefix}{vp.guid}.json", serialize_viewpoint_json(vp))
        else:
            zf.writestr(f"{prefix}{vp.guid}.bcfv", serialize_viewpoint_xml(vp))

        if vp.snapshot_data:
            zf.writestr(f"{prefix}{vp.guid}.png", vp.snapshot_data)
