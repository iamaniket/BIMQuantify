"""BCF 2.1 XML serialization and deserialization.

Handles markup.bcf (topic + comments + viewpoint refs) and *.bcfv (viewpoint
camera/components/clipping).  Uses only stdlib xml.etree.ElementTree.
"""

from __future__ import annotations

import xml.etree.ElementTree as ET
from datetime import UTC, datetime

from bimstitch_api.bcf.types import (
    BcfComponents,
    ClippingPlane,
    ParsedComment,
    ParsedTopic,
    ParsedViewpoint,
    Vec3,
)

_ISO = "%Y-%m-%dT%H:%M:%S%z"
_ISO_NO_TZ = "%Y-%m-%dT%H:%M:%S"


def _parse_dt(raw: str | None) -> datetime | None:
    if not raw:
        return None
    raw = raw.strip()
    for fmt in (_ISO, _ISO_NO_TZ, "%Y-%m-%dT%H:%M:%S.%f%z", "%Y-%m-%dT%H:%M:%S.%f"):
        try:
            dt = datetime.strptime(raw, fmt)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=UTC)
            return dt
        except ValueError:
            continue
    return None


def _text(el: ET.Element | None) -> str:
    if el is None:
        return ""
    return (el.text or "").strip()


def _float(el: ET.Element | None, default: float = 0.0) -> float:
    txt = _text(el)
    if not txt:
        return default
    try:
        return float(txt)
    except ValueError:
        return default


# ---------------------------------------------------------------------------
# Parse
# ---------------------------------------------------------------------------

def _parse_vec3(el: ET.Element | None) -> Vec3:
    if el is None:
        return Vec3()
    return Vec3(
        x=_float(el.find("X")),
        y=_float(el.find("Y")),
        z=_float(el.find("Z")),
    )


def parse_viewpoint_xml(data: bytes) -> ParsedViewpoint:
    """Parse a BCF 2.1 viewpoint (.bcfv) XML file."""
    root = ET.fromstring(data)
    guid = root.get("Guid", "")

    persp = root.find("PerspectiveCamera")
    ortho = root.find("OrthogonalCamera")

    if persp is not None:
        cam = persp
        camera_type = "perspective"
        fov = _float(cam.find("FieldOfView"), 60.0)
        foh = None
    elif ortho is not None:
        cam = ortho
        camera_type = "orthographic"
        fov = None
        foh = _float(cam.find("ViewToWorldScale"), 1.0)
    else:
        return ParsedViewpoint(guid=guid)

    vp = ParsedViewpoint(
        guid=guid,
        camera_type=camera_type,
        camera_view_point=_parse_vec3(cam.find("CameraViewPoint")),
        camera_direction=_parse_vec3(cam.find("CameraDirection")),
        camera_up_vector=_parse_vec3(cam.find("CameraUpVector")),
        field_of_view=fov,
        field_of_height=foh,
    )

    # Components
    comps_el = root.find("Components")
    if comps_el is not None:
        vis_el = comps_el.find("Visibility")
        default_vis = True
        exceptions: list[str] = []
        if vis_el is not None:
            default_vis = vis_el.get("DefaultVisibility", "true").lower() == "true"
            for comp in vis_el.findall("Exceptions/Component"):
                ifc_guid = comp.get("IfcGuid", "")
                if ifc_guid:
                    exceptions.append(ifc_guid)

        selection: list[str] = []
        for comp in comps_el.findall("Selection/Component"):
            ifc_guid = comp.get("IfcGuid", "")
            if ifc_guid:
                selection.append(ifc_guid)

        vp.components = BcfComponents(
            default_visibility=default_vis,
            visibility_exceptions=exceptions,
            selection=selection,
        )

    # Clipping planes
    for plane_el in root.findall("ClippingPlanes/ClippingPlane"):
        vp.clipping_planes.append(
            ClippingPlane(
                location=_parse_vec3(plane_el.find("Location")),
                direction=_parse_vec3(plane_el.find("Direction")),
            )
        )

    return vp


def parse_markup_xml(data: bytes) -> ParsedTopic:
    """Parse a BCF 2.1 markup.bcf XML file."""
    root = ET.fromstring(data)

    topic_el = root.find("Topic")
    if topic_el is None:
        raise ValueError("markup.bcf missing <Topic> element")

    guid = topic_el.get("Guid", "")
    topic_type = topic_el.get("TopicType", "Issue")
    topic_status = topic_el.get("TopicStatus", "Open")

    topic = ParsedTopic(
        guid=guid,
        title=_text(topic_el.find("Title")),
        description=_text(topic_el.find("Description")),
        topic_type=topic_type,
        topic_status=topic_status,
        priority=_text(topic_el.find("Priority")) or None,
        stage=_text(topic_el.find("Stage")) or None,
        assigned_to=_text(topic_el.find("AssignedTo")) or None,
        due_date=_text(topic_el.find("DueDate")) or None,
        creation_author=_text(topic_el.find("CreationAuthor")),
        creation_date=_parse_dt(_text(topic_el.find("CreationDate"))),
        modified_author=_text(topic_el.find("ModifiedAuthor")) or None,
        modified_date=_parse_dt(_text(topic_el.find("ModifiedDate"))),
    )

    for label_el in topic_el.findall("Labels"):
        label = _text(label_el)
        if label:
            topic.labels.append(label)

    for ref_el in topic_el.findall("ReferenceLink"):
        link = _text(ref_el)
        if link:
            topic.reference_links.append(link)

    # Viewpoint references (GUIDs only — actual viewpoint data comes from .bcfv files)
    vp_guids: list[str] = []
    for vp_el in root.findall("Viewpoints"):
        vp_guid = vp_el.get("Guid", "")
        if vp_guid:
            vp_guids.append(vp_guid)

    # Placeholder viewpoints — will be merged with parsed .bcfv data later.
    for i, vp_guid in enumerate(vp_guids):
        topic.viewpoints.append(ParsedViewpoint(guid=vp_guid, index=i))

    # Comments
    for comment_el in root.findall("Comment"):
        comment_guid = comment_el.get("Guid", "")
        vp_ref = comment_el.find("Viewpoint")
        vp_ref_guid = vp_ref.get("Guid", "") if vp_ref is not None else None

        topic.comments.append(
            ParsedComment(
                guid=comment_guid,
                text=_text(comment_el.find("Comment")),
                author=_text(comment_el.find("Author")),
                date=_parse_dt(_text(comment_el.find("Date"))) or datetime.now(UTC),
                modified_author=_text(comment_el.find("ModifiedAuthor")) or None,
                modified_date=_parse_dt(_text(comment_el.find("ModifiedDate"))),
                viewpoint_guid=vp_ref_guid or None,
            )
        )

    return topic


# ---------------------------------------------------------------------------
# Serialize
# ---------------------------------------------------------------------------

def _dt_str(dt: datetime | None) -> str:
    if dt is None:
        return ""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt.strftime(_ISO)


def _add_sub(parent: ET.Element, tag: str, text: str | None) -> None:
    if text:
        ET.SubElement(parent, tag).text = text


def _vec3_el(parent: ET.Element, tag: str, v: Vec3) -> None:
    el = ET.SubElement(parent, tag)
    ET.SubElement(el, "X").text = str(v.x)
    ET.SubElement(el, "Y").text = str(v.y)
    ET.SubElement(el, "Z").text = str(v.z)


def serialize_viewpoint_xml(vp: ParsedViewpoint) -> bytes:
    """Serialize a viewpoint to BCF 2.1 .bcfv XML."""
    root = ET.Element("VisualizationInfo", Guid=vp.guid)

    if vp.camera_type == "perspective":
        cam = ET.SubElement(root, "PerspectiveCamera")
        _vec3_el(cam, "CameraViewPoint", vp.camera_view_point)
        _vec3_el(cam, "CameraDirection", vp.camera_direction)
        _vec3_el(cam, "CameraUpVector", vp.camera_up_vector)
        ET.SubElement(cam, "FieldOfView").text = str(vp.field_of_view or 60.0)
    else:
        cam = ET.SubElement(root, "OrthogonalCamera")
        _vec3_el(cam, "CameraViewPoint", vp.camera_view_point)
        _vec3_el(cam, "CameraDirection", vp.camera_direction)
        _vec3_el(cam, "CameraUpVector", vp.camera_up_vector)
        ET.SubElement(cam, "ViewToWorldScale").text = str(vp.field_of_height or 1.0)

    if vp.components:
        comps = ET.SubElement(root, "Components")
        default_vis_str = str(vp.components.default_visibility).lower()
        vis = ET.SubElement(comps, "Visibility", DefaultVisibility=default_vis_str)
        if vp.components.visibility_exceptions:
            exceptions = ET.SubElement(vis, "Exceptions")
            for ifc_guid in vp.components.visibility_exceptions:
                ET.SubElement(exceptions, "Component", IfcGuid=ifc_guid)
        if vp.components.selection:
            sel = ET.SubElement(comps, "Selection")
            for ifc_guid in vp.components.selection:
                ET.SubElement(sel, "Component", IfcGuid=ifc_guid)

    if vp.clipping_planes:
        planes = ET.SubElement(root, "ClippingPlanes")
        for cp in vp.clipping_planes:
            plane = ET.SubElement(planes, "ClippingPlane")
            _vec3_el(plane, "Location", cp.location)
            _vec3_el(plane, "Direction", cp.direction)

    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def serialize_markup_xml(topic: ParsedTopic) -> bytes:
    """Serialize a topic to BCF 2.1 markup.bcf XML."""
    root = ET.Element("Markup")

    topic_el = ET.SubElement(
        root,
        "Topic",
        Guid=topic.guid,
        TopicType=topic.topic_type,
        TopicStatus=topic.topic_status,
    )

    _add_sub(topic_el, "Title", topic.title)
    _add_sub(topic_el, "Description", topic.description)
    _add_sub(topic_el, "Priority", topic.priority)
    _add_sub(topic_el, "Stage", topic.stage)
    _add_sub(topic_el, "AssignedTo", topic.assigned_to)
    _add_sub(topic_el, "DueDate", topic.due_date)
    _add_sub(topic_el, "CreationAuthor", topic.creation_author)
    _add_sub(topic_el, "CreationDate", _dt_str(topic.creation_date))
    _add_sub(topic_el, "ModifiedAuthor", topic.modified_author)
    _add_sub(topic_el, "ModifiedDate", _dt_str(topic.modified_date))

    for label in topic.labels:
        _add_sub(topic_el, "Labels", label)

    for ref in topic.reference_links:
        _add_sub(topic_el, "ReferenceLink", ref)

    # Viewpoint references
    for vp in topic.viewpoints:
        vp_el = ET.SubElement(root, "Viewpoints", Guid=vp.guid)
        ET.SubElement(vp_el, "Viewpoint").text = f"{vp.guid}.bcfv"
        if vp.snapshot_data:
            ET.SubElement(vp_el, "Snapshot").text = f"{vp.guid}.png"

    # Comments
    for comment in topic.comments:
        c_el = ET.SubElement(root, "Comment", Guid=comment.guid)
        _add_sub(c_el, "Date", _dt_str(comment.date))
        _add_sub(c_el, "Author", comment.author)
        ET.SubElement(c_el, "Comment").text = comment.text
        _add_sub(c_el, "ModifiedAuthor", comment.modified_author)
        _add_sub(c_el, "ModifiedDate", _dt_str(comment.modified_date))
        if comment.viewpoint_guid:
            ET.SubElement(c_el, "Viewpoint", Guid=comment.viewpoint_guid)

    return ET.tostring(root, encoding="utf-8", xml_declaration=True)
