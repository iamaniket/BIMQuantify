"""Unit tests for BCF parser/generator — pure parsing, no database."""

from __future__ import annotations

import io
import json
import uuid
import xml.etree.ElementTree as ET
import zipfile
from datetime import datetime, timezone


from bimstitch_api.bcf.generator import generate_bcf_archive, generate_single_topic_archive
from bimstitch_api.bcf.json_utils import (
    parse_topic_json,
    parse_viewpoint_json,
    serialize_topic_json,
    serialize_viewpoint_json,
)
from bimstitch_api.bcf.parser import parse_bcf_archive
from bimstitch_api.bcf.types import (
    BcfComponents,
    ClippingPlane,
    ParsedBcf,
    ParsedComment,
    ParsedFile,
    ParsedTopic,
    ParsedViewpoint,
    Vec3,
)
from bimstitch_api.bcf.xml_utils import (
    parse_markup_xml,
    parse_viewpoint_xml,
    serialize_markup_xml,
    serialize_viewpoint_xml,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_version_xml(version: str = "2.1") -> bytes:
    root = ET.Element("Version", VersionId=version)
    ET.SubElement(root, "DetailedVersion").text = version
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def _make_bcf_21_zip(topics: list[tuple[bytes, list[tuple[str, bytes]], bytes | None]]) -> bytes:
    """Build a minimal BCF 2.1 ZIP.

    topics: list of (markup_xml, [(vp_guid, vp_bcfv), ...], snapshot_bytes|None)
    """
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("bcf.version", _make_version_xml("2.1"))
        for markup_xml, viewpoints, _snapshot in topics:
            root = ET.fromstring(markup_xml)
            topic_el = root.find("Topic")
            guid = topic_el.get("Guid", str(uuid.uuid4())) if topic_el is not None else str(uuid.uuid4())
            zf.writestr(f"{guid}/markup.bcf", markup_xml)
            for vp_guid, vp_data in viewpoints:
                zf.writestr(f"{guid}/{vp_guid}.bcfv", vp_data)
                if _snapshot:
                    zf.writestr(f"{guid}/{vp_guid}.png", _snapshot)
    return buf.getvalue()


def _minimal_markup(
    guid: str | None = None,
    title: str = "Test Issue",
    status: str = "Open",
    topic_type: str = "Issue",
) -> bytes:
    guid = guid or str(uuid.uuid4())
    root = ET.Element("Markup")
    topic = ET.SubElement(root, "Topic", Guid=guid, TopicType=topic_type, TopicStatus=status)
    ET.SubElement(topic, "Title").text = title
    ET.SubElement(topic, "CreationAuthor").text = "tester@example.com"
    ET.SubElement(topic, "CreationDate").text = "2026-06-01T10:00:00+0000"
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def _minimal_viewpoint(guid: str | None = None) -> bytes:
    guid = guid or str(uuid.uuid4())
    root = ET.Element("VisualizationInfo", Guid=guid)
    persp = ET.SubElement(root, "PerspectiveCamera")
    for tag, vals in [
        ("CameraViewPoint", (10, 20, 30)),
        ("CameraDirection", (0, 0, -1)),
        ("CameraUpVector", (0, 1, 0)),
    ]:
        el = ET.SubElement(persp, tag)
        ET.SubElement(el, "X").text = str(vals[0])
        ET.SubElement(el, "Y").text = str(vals[1])
        ET.SubElement(el, "Z").text = str(vals[2])
    ET.SubElement(persp, "FieldOfView").text = "60.0"
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


# ---------------------------------------------------------------------------
# BCF 2.1 XML — Viewpoint
# ---------------------------------------------------------------------------


class TestViewpointXml:
    def test_parse_perspective_camera(self) -> None:
        vp = parse_viewpoint_xml(_minimal_viewpoint("vp-1"))
        assert vp.guid == "vp-1"
        assert vp.camera_type == "perspective"
        assert vp.camera_view_point.x == 10.0
        assert vp.camera_view_point.y == 20.0
        assert vp.camera_view_point.z == 30.0
        assert vp.field_of_view == 60.0
        assert vp.field_of_height is None

    def test_parse_orthographic_camera(self) -> None:
        root = ET.Element("VisualizationInfo", Guid="vp-ortho")
        cam = ET.SubElement(root, "OrthogonalCamera")
        for tag, vals in [
            ("CameraViewPoint", (5, 5, 0)),
            ("CameraDirection", (0, 0, -1)),
            ("CameraUpVector", (0, 1, 0)),
        ]:
            el = ET.SubElement(cam, tag)
            ET.SubElement(el, "X").text = str(vals[0])
            ET.SubElement(el, "Y").text = str(vals[1])
            ET.SubElement(el, "Z").text = str(vals[2])
        ET.SubElement(cam, "ViewToWorldScale").text = "2.5"
        data = ET.tostring(root, encoding="utf-8", xml_declaration=True)

        vp = parse_viewpoint_xml(data)
        assert vp.camera_type == "orthographic"
        assert vp.field_of_height == 2.5
        assert vp.field_of_view is None

    def test_parse_components(self) -> None:
        root = ET.Element("VisualizationInfo", Guid="vp-comp")
        persp = ET.SubElement(root, "PerspectiveCamera")
        for tag in ("CameraViewPoint", "CameraDirection", "CameraUpVector"):
            el = ET.SubElement(persp, tag)
            ET.SubElement(el, "X").text = "0"
            ET.SubElement(el, "Y").text = "0"
            ET.SubElement(el, "Z").text = "0"
        ET.SubElement(persp, "FieldOfView").text = "60"

        comps = ET.SubElement(root, "Components")
        vis = ET.SubElement(comps, "Visibility", DefaultVisibility="false")
        exc = ET.SubElement(vis, "Exceptions")
        ET.SubElement(exc, "Component", IfcGuid="abc123")
        ET.SubElement(exc, "Component", IfcGuid="def456")
        sel = ET.SubElement(comps, "Selection")
        ET.SubElement(sel, "Component", IfcGuid="sel001")

        data = ET.tostring(root, encoding="utf-8", xml_declaration=True)
        vp = parse_viewpoint_xml(data)

        assert vp.components is not None
        assert vp.components.default_visibility is False
        assert vp.components.visibility_exceptions == ["abc123", "def456"]
        assert vp.components.selection == ["sel001"]

    def test_parse_clipping_planes(self) -> None:
        root = ET.Element("VisualizationInfo", Guid="vp-clip")
        persp = ET.SubElement(root, "PerspectiveCamera")
        for tag in ("CameraViewPoint", "CameraDirection", "CameraUpVector"):
            el = ET.SubElement(persp, tag)
            for axis in ("X", "Y", "Z"):
                ET.SubElement(el, axis).text = "0"
        ET.SubElement(persp, "FieldOfView").text = "60"

        planes = ET.SubElement(root, "ClippingPlanes")
        plane = ET.SubElement(planes, "ClippingPlane")
        loc = ET.SubElement(plane, "Location")
        ET.SubElement(loc, "X").text = "1"
        ET.SubElement(loc, "Y").text = "2"
        ET.SubElement(loc, "Z").text = "3"
        d = ET.SubElement(plane, "Direction")
        ET.SubElement(d, "X").text = "0"
        ET.SubElement(d, "Y").text = "0"
        ET.SubElement(d, "Z").text = "1"

        data = ET.tostring(root, encoding="utf-8", xml_declaration=True)
        vp = parse_viewpoint_xml(data)

        assert len(vp.clipping_planes) == 1
        assert vp.clipping_planes[0].location.x == 1.0
        assert vp.clipping_planes[0].direction.z == 1.0

    def test_roundtrip_viewpoint_xml(self) -> None:
        original = ParsedViewpoint(
            guid="rt-vp",
            camera_type="perspective",
            camera_view_point=Vec3(1, 2, 3),
            camera_direction=Vec3(0, 0, -1),
            camera_up_vector=Vec3(0, 1, 0),
            field_of_view=45.0,
            components=BcfComponents(
                default_visibility=False,
                visibility_exceptions=["guid-a"],
                selection=["guid-b"],
            ),
            clipping_planes=[
                ClippingPlane(location=Vec3(5, 5, 5), direction=Vec3(1, 0, 0)),
            ],
        )

        xml_bytes = serialize_viewpoint_xml(original)
        parsed = parse_viewpoint_xml(xml_bytes)

        assert parsed.guid == original.guid
        assert parsed.camera_type == "perspective"
        assert parsed.camera_view_point.x == 1.0
        assert parsed.field_of_view == 45.0
        assert parsed.components is not None
        assert parsed.components.visibility_exceptions == ["guid-a"]
        assert len(parsed.clipping_planes) == 1


# ---------------------------------------------------------------------------
# BCF 2.1 XML — Markup
# ---------------------------------------------------------------------------


class TestMarkupXml:
    def test_parse_minimal_markup(self) -> None:
        topic = parse_markup_xml(_minimal_markup(guid="t-1", title="Wall crack"))
        assert topic.guid == "t-1"
        assert topic.title == "Wall crack"
        assert topic.topic_status == "Open"
        assert topic.topic_type == "Issue"
        assert topic.creation_author == "tester@example.com"

    def test_parse_labels_and_references(self) -> None:
        root = ET.Element("Markup")
        t = ET.SubElement(root, "Topic", Guid="t-label", TopicType="Issue", TopicStatus="Open")
        ET.SubElement(t, "Title").text = "Labeled"
        ET.SubElement(t, "CreationAuthor").text = "a@b.com"
        ET.SubElement(t, "Labels").text = "Architecture"
        ET.SubElement(t, "Labels").text = "Structural"
        ET.SubElement(t, "ReferenceLink").text = "https://example.com"

        data = ET.tostring(root, encoding="utf-8", xml_declaration=True)
        topic = parse_markup_xml(data)

        assert topic.labels == ["Architecture", "Structural"]
        assert topic.reference_links == ["https://example.com"]

    def test_parse_comments(self) -> None:
        root = ET.Element("Markup")
        t = ET.SubElement(root, "Topic", Guid="t-cmt", TopicType="Issue", TopicStatus="Open")
        ET.SubElement(t, "Title").text = "With Comments"
        ET.SubElement(t, "CreationAuthor").text = "a@b.com"

        c = ET.SubElement(root, "Comment", Guid="c-1")
        ET.SubElement(c, "Date").text = "2026-06-02T14:30:00+0000"
        ET.SubElement(c, "Author").text = "reviewer@b.com"
        ET.SubElement(c, "Comment").text = "Please fix this"

        data = ET.tostring(root, encoding="utf-8", xml_declaration=True)
        topic = parse_markup_xml(data)

        assert len(topic.comments) == 1
        assert topic.comments[0].text == "Please fix this"
        assert topic.comments[0].author == "reviewer@b.com"

    def test_roundtrip_markup_xml(self) -> None:
        original = ParsedTopic(
            guid="rt-topic",
            title="Round-trip Test",
            description="Desc here",
            topic_type="Request",
            topic_status="Closed",
            priority="High",
            assigned_to="user@example.com",
            labels=["MEP", "Review"],
            creation_author="author@test.com",
            creation_date=datetime(2026, 1, 15, 12, 0, 0, tzinfo=timezone.utc),
            viewpoints=[
                ParsedViewpoint(guid="vp-a", index=0),
            ],
            comments=[
                ParsedComment(
                    guid="c-a",
                    text="First comment",
                    author="a@b.com",
                    date=datetime(2026, 1, 16, 9, 0, 0, tzinfo=timezone.utc),
                ),
            ],
        )

        xml_bytes = serialize_markup_xml(original)
        parsed = parse_markup_xml(xml_bytes)

        assert parsed.guid == "rt-topic"
        assert parsed.title == "Round-trip Test"
        assert parsed.topic_type == "Request"
        assert parsed.topic_status == "Closed"
        assert parsed.priority == "High"
        assert parsed.labels == ["MEP", "Review"]
        assert len(parsed.viewpoints) == 1
        assert parsed.viewpoints[0].guid == "vp-a"
        assert len(parsed.comments) == 1
        assert parsed.comments[0].text == "First comment"


# ---------------------------------------------------------------------------
# BCF 3.0 JSON — Viewpoint
# ---------------------------------------------------------------------------


class TestViewpointJson:
    def test_parse_perspective(self) -> None:
        data = json.dumps({
            "guid": "j-vp-1",
            "perspective_camera": {
                "camera_view_point": {"x": 1, "y": 2, "z": 3},
                "camera_direction": {"x": 0, "y": 0, "z": -1},
                "camera_up_vector": {"x": 0, "y": 1, "z": 0},
                "field_of_view": 45,
            },
        }).encode()
        vp = parse_viewpoint_json(data)
        assert vp.guid == "j-vp-1"
        assert vp.camera_type == "perspective"
        assert vp.camera_view_point.z == 3.0
        assert vp.field_of_view == 45.0

    def test_parse_orthographic(self) -> None:
        data = json.dumps({
            "guid": "j-vp-2",
            "orthogonal_camera": {
                "camera_view_point": {"x": 0, "y": 0, "z": 0},
                "camera_direction": {"x": 0, "y": 0, "z": -1},
                "camera_up_vector": {"x": 0, "y": 1, "z": 0},
                "view_to_world_scale": 3.5,
            },
        }).encode()
        vp = parse_viewpoint_json(data)
        assert vp.camera_type == "orthographic"
        assert vp.field_of_height == 3.5

    def test_roundtrip_viewpoint_json(self) -> None:
        original = ParsedViewpoint(
            guid="j-rt-vp",
            camera_type="perspective",
            camera_view_point=Vec3(10, 20, 30),
            camera_direction=Vec3(0, 0, -1),
            camera_up_vector=Vec3(0, 1, 0),
            field_of_view=60.0,
            components=BcfComponents(
                default_visibility=True,
                visibility_exceptions=["g1"],
                selection=["g2"],
            ),
        )
        data = serialize_viewpoint_json(original)
        parsed = parse_viewpoint_json(data)

        assert parsed.guid == "j-rt-vp"
        assert parsed.camera_view_point.x == 10.0
        assert parsed.components is not None
        assert parsed.components.visibility_exceptions == ["g1"]


# ---------------------------------------------------------------------------
# BCF 3.0 JSON — Topic
# ---------------------------------------------------------------------------


class TestTopicJson:
    def test_parse_topic(self) -> None:
        data = json.dumps({
            "guid": "j-t-1",
            "title": "JSON topic",
            "topic_type": "Request",
            "topic_status": "Active",
            "priority": "Normal",
            "creation_author": "json@test.com",
            "creation_date": "2026-06-03T10:00:00+0000",
            "labels": ["Fire", "Safety"],
            "comments": [
                {
                    "guid": "jc-1",
                    "comment": "Check this",
                    "author": "r@t.com",
                    "date": "2026-06-03T11:00:00+0000",
                },
            ],
        }).encode()
        topic = parse_topic_json(data)

        assert topic.guid == "j-t-1"
        assert topic.title == "JSON topic"
        assert topic.topic_status == "Active"
        assert topic.labels == ["Fire", "Safety"]
        assert len(topic.comments) == 1
        assert topic.comments[0].text == "Check this"

    def test_roundtrip_topic_json(self) -> None:
        original = ParsedTopic(
            guid="j-rt",
            title="JSON Round-trip",
            description="desc",
            topic_type="Issue",
            topic_status="Open",
            priority="High",
            labels=["Arch"],
            creation_author="a@b.com",
            creation_date=datetime(2026, 3, 1, 8, 0, 0, tzinfo=timezone.utc),
            comments=[
                ParsedComment(
                    guid="jc-rt",
                    text="Hello",
                    author="c@d.com",
                    date=datetime(2026, 3, 2, 9, 0, 0, tzinfo=timezone.utc),
                ),
            ],
        )

        data = serialize_topic_json(original)
        parsed = parse_topic_json(data)

        assert parsed.guid == "j-rt"
        assert parsed.title == "JSON Round-trip"
        assert parsed.priority == "High"
        assert len(parsed.comments) == 1


# ---------------------------------------------------------------------------
# Full archive parse/generate round-trip
# ---------------------------------------------------------------------------


class TestArchiveRoundTrip:
    def test_parse_bcf_21_archive(self) -> None:
        topic_guid = str(uuid.uuid4())
        vp_guid = str(uuid.uuid4())
        snapshot = b"\x89PNG\r\n\x1a\nfake-snapshot-data"

        markup = _minimal_markup(guid=topic_guid, title="Archive Test")
        # Inject viewpoint reference into markup
        root = ET.fromstring(markup)
        vp_el = ET.SubElement(root, "Viewpoints", Guid=vp_guid)
        ET.SubElement(vp_el, "Viewpoint").text = f"{vp_guid}.bcfv"
        ET.SubElement(vp_el, "Snapshot").text = f"{vp_guid}.png"
        markup = ET.tostring(root, encoding="utf-8", xml_declaration=True)

        viewpoint_data = _minimal_viewpoint(guid=vp_guid)

        data = _make_bcf_21_zip([(markup, [(vp_guid, viewpoint_data)], snapshot)])
        result = parse_bcf_archive(data)

        assert result.version == "2.1"
        assert len(result.topics) == 1
        assert result.topics[0].title == "Archive Test"
        assert len(result.topics[0].viewpoints) == 1
        assert result.topics[0].viewpoints[0].camera_view_point.x == 10.0
        assert result.topics[0].viewpoints[0].snapshot_data == snapshot

    def test_full_roundtrip_21(self) -> None:
        original = ParsedBcf(
            version="2.1",
            topics=[
                ParsedTopic(
                    guid="topic-rt-1",
                    title="RT Topic 1",
                    topic_type="Issue",
                    topic_status="Open",
                    creation_author="test@test.com",
                    creation_date=datetime(2026, 6, 1, 12, 0, 0, tzinfo=timezone.utc),
                    viewpoints=[
                        ParsedViewpoint(
                            guid="vp-rt-1",
                            camera_type="perspective",
                            camera_view_point=Vec3(1, 2, 3),
                            camera_direction=Vec3(0, 0, -1),
                            camera_up_vector=Vec3(0, 1, 0),
                            field_of_view=60.0,
                            snapshot_data=b"png-bytes",
                        ),
                    ],
                    comments=[
                        ParsedComment(
                            guid="c-rt-1",
                            text="A comment",
                            author="commenter@test.com",
                            date=datetime(2026, 6, 2, 8, 0, 0, tzinfo=timezone.utc),
                        ),
                    ],
                ),
            ],
        )

        archive = generate_bcf_archive(original)
        parsed = parse_bcf_archive(archive)

        assert parsed.version == "2.1"
        assert len(parsed.topics) == 1
        t = parsed.topics[0]
        assert t.guid == "topic-rt-1"
        assert t.title == "RT Topic 1"
        assert len(t.viewpoints) == 1
        assert t.viewpoints[0].camera_view_point.x == 1.0
        assert t.viewpoints[0].snapshot_data == b"png-bytes"
        assert len(t.comments) == 1
        assert t.comments[0].text == "A comment"

    def test_full_roundtrip_30(self) -> None:
        original = ParsedBcf(
            version="3.0",
            topics=[
                ParsedTopic(
                    guid="topic-rt-30",
                    title="BCF 3.0 Topic",
                    topic_type="Request",
                    topic_status="Active",
                    priority="Normal",
                    labels=["Structural"],
                    creation_author="test@30.com",
                    creation_date=datetime(2026, 6, 3, 10, 0, 0, tzinfo=timezone.utc),
                    viewpoints=[
                        ParsedViewpoint(
                            guid="vp-rt-30",
                            camera_type="orthographic",
                            camera_view_point=Vec3(5, 5, 0),
                            camera_direction=Vec3(0, 0, -1),
                            camera_up_vector=Vec3(0, 1, 0),
                            field_of_height=10.0,
                        ),
                    ],
                ),
            ],
        )

        archive = generate_bcf_archive(original)
        parsed = parse_bcf_archive(archive)

        assert parsed.version == "3.0"
        assert len(parsed.topics) == 1
        t = parsed.topics[0]
        assert t.guid == "topic-rt-30"
        assert t.title == "BCF 3.0 Topic"
        assert t.labels == ["Structural"]
        assert len(t.viewpoints) == 1
        assert t.viewpoints[0].camera_type == "orthographic"
        assert t.viewpoints[0].field_of_height == 10.0

    def test_empty_archive(self) -> None:
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            zf.writestr("bcf.version", _make_version_xml("2.1"))
        result = parse_bcf_archive(buf.getvalue())
        assert result.version == "2.1"
        assert result.topics == []

    def test_multiple_topics(self) -> None:
        original = ParsedBcf(
            version="2.1",
            topics=[
                ParsedTopic(
                    guid=f"multi-{i}",
                    title=f"Topic {i}",
                    creation_author="a@b.com",
                    creation_date=datetime(2026, 6, 1, tzinfo=timezone.utc),
                )
                for i in range(5)
            ],
        )

        archive = generate_bcf_archive(original)
        parsed = parse_bcf_archive(archive)

        assert len(parsed.topics) == 5
        guids = {t.guid for t in parsed.topics}
        assert guids == {f"multi-{i}" for i in range(5)}

    def test_generate_single_topic(self) -> None:
        topic = ParsedTopic(
            guid="single",
            title="Single",
            creation_author="a@b.com",
        )
        archive = generate_single_topic_archive(topic, version="2.1")
        parsed = parse_bcf_archive(archive)
        assert len(parsed.topics) == 1
        assert parsed.topics[0].guid == "single"

    def test_missing_bcf_version_defaults_21(self) -> None:
        buf = io.BytesIO()
        guid = "no-version-topic"
        with zipfile.ZipFile(buf, "w") as zf:
            zf.writestr(f"{guid}/markup.bcf", _minimal_markup(guid=guid))
        result = parse_bcf_archive(buf.getvalue())
        assert result.version == "2.1"
        assert len(result.topics) == 1


# ---------------------------------------------------------------------------
# Header / File (model reference) round-trip
# ---------------------------------------------------------------------------


class TestHeaderFileRoundTrip:
    def test_markup_xml_header_round_trip(self) -> None:
        topic = ParsedTopic(
            guid="t-hdr",
            title="Has files",
            creation_author="a@b.com",
            files=[
                ParsedFile(
                    ifc_project="2O2Fr$t4X7Zf8NOew3FNr2",
                    filename="tower.ifc",
                    date=datetime(2026, 1, 2, 3, 4, 5, tzinfo=timezone.utc),
                    is_external=True,
                ),
            ],
        )
        xml = serialize_markup_xml(topic)
        assert b"<Header>" in xml
        assert b"tower.ifc" in xml
        parsed = parse_markup_xml(xml)
        assert len(parsed.files) == 1
        f = parsed.files[0]
        assert f.ifc_project == "2O2Fr$t4X7Zf8NOew3FNr2"
        assert f.filename == "tower.ifc"
        assert f.date is not None

    def test_topic_json_files_round_trip(self) -> None:
        topic = ParsedTopic(
            guid="t-json",
            title="Has files",
            creation_author="a@b.com",
            files=[ParsedFile(ifc_project="GUID123", filename="m.ifc", is_external=False)],
        )
        data = serialize_topic_json(topic)
        parsed = parse_topic_json(data)
        assert len(parsed.files) == 1
        assert parsed.files[0].ifc_project == "GUID123"
        assert parsed.files[0].filename == "m.ifc"
        assert parsed.files[0].is_external is False

    def test_archive_round_trip_preserves_files(self) -> None:
        topic = ParsedTopic(
            guid="t-arc",
            title="Archive files",
            creation_author="a@b.com",
            files=[ParsedFile(ifc_project="ABC", filename="x.ifc")],
        )
        for version in ("2.1", "3.0"):
            archive = generate_bcf_archive(ParsedBcf(version=version, topics=[topic]))
            parsed = parse_bcf_archive(archive)
            assert len(parsed.topics[0].files) == 1, version
            assert parsed.topics[0].files[0].ifc_project == "ABC", version
