"""BCF 3.0 JSON serialization and deserialization.

BCF 3.0 uses JSON inside the same ZIP structure: topic.json instead of
markup.bcf, viewpoint.json instead of *.bcfv.  Structurally identical
data, different wire format.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime

from bimstitch_api.bcf.types import (
    BcfComponents,
    ClippingPlane,
    ParsedComment,
    ParsedTopic,
    ParsedViewpoint,
    Vec3,
)


def _parse_dt(raw: str | None) -> datetime | None:
    if not raw:
        return None
    raw = raw.strip()
    for fmt in (
        "%Y-%m-%dT%H:%M:%S%z",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%dT%H:%M:%S.%f%z",
        "%Y-%m-%dT%H:%M:%S.%f",
    ):
        try:
            dt = datetime.strptime(raw, fmt)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=UTC)
            return dt
        except ValueError:
            continue
    return None


def _dt_str(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt.strftime("%Y-%m-%dT%H:%M:%S%z")


def _vec3_from_dict(d: dict[str, object] | None) -> Vec3:
    if not d:
        return Vec3()
    return Vec3(
        x=float(d.get("x", 0)),
        y=float(d.get("y", 0)),
        z=float(d.get("z", 0)),
    )


def _vec3_to_dict(v: Vec3) -> dict[str, float]:
    return {"x": v.x, "y": v.y, "z": v.z}


# ---------------------------------------------------------------------------
# Parse
# ---------------------------------------------------------------------------


def parse_viewpoint_json(data: bytes) -> ParsedViewpoint:
    """Parse a BCF 3.0 viewpoint JSON file."""
    d = json.loads(data)

    guid = d.get("guid", "")
    camera_type = "perspective"
    fov = None
    foh = None

    cam_data = d.get("perspective_camera") or d.get("orthogonal_camera")
    if d.get("perspective_camera"):
        camera_type = "perspective"
        fov = float(d["perspective_camera"].get("field_of_view", 60))
    elif d.get("orthogonal_camera"):
        camera_type = "orthographic"
        foh = float(d["orthogonal_camera"].get("view_to_world_scale", 1.0))

    view_point = Vec3()
    direction = Vec3()
    up_vector = Vec3(0, 1, 0)
    if cam_data:
        view_point = _vec3_from_dict(cam_data.get("camera_view_point"))
        direction = _vec3_from_dict(cam_data.get("camera_direction"))
        up_vector = _vec3_from_dict(cam_data.get("camera_up_vector"))

    vp = ParsedViewpoint(
        guid=guid,
        camera_type=camera_type,
        camera_view_point=view_point,
        camera_direction=direction,
        camera_up_vector=up_vector,
        field_of_view=fov,
        field_of_height=foh,
    )

    # Components
    comps = d.get("components")
    if comps:
        vis = comps.get("visibility", {})
        default_vis = vis.get("default_visibility", True)
        exceptions = [
            c["ifc_guid"]
            for c in vis.get("exceptions", [])
            if "ifc_guid" in c
        ]
        selection = [
            c["ifc_guid"]
            for c in comps.get("selection", [])
            if "ifc_guid" in c
        ]
        vp.components = BcfComponents(
            default_visibility=default_vis,
            visibility_exceptions=exceptions,
            selection=selection,
        )

    # Clipping planes
    for cp in d.get("clipping_planes", []):
        vp.clipping_planes.append(
            ClippingPlane(
                location=_vec3_from_dict(cp.get("location")),
                direction=_vec3_from_dict(cp.get("direction")),
            )
        )

    return vp


def parse_topic_json(data: bytes) -> ParsedTopic:
    """Parse a BCF 3.0 topic.json file."""
    d = json.loads(data)

    topic = ParsedTopic(
        guid=d.get("guid", ""),
        title=d.get("title", ""),
        description=d.get("description", ""),
        topic_type=d.get("topic_type", "Issue"),
        topic_status=d.get("topic_status", "Open"),
        priority=d.get("priority"),
        stage=d.get("stage"),
        assigned_to=d.get("assigned_to"),
        labels=d.get("labels", []),
        due_date=d.get("due_date"),
        creation_author=d.get("creation_author", ""),
        creation_date=_parse_dt(d.get("creation_date")),
        modified_author=d.get("modified_author"),
        modified_date=_parse_dt(d.get("modified_date")),
        reference_links=d.get("reference_links", []),
    )

    # Viewpoint references
    for i, vp_ref in enumerate(d.get("viewpoints", [])):
        vp_guid = vp_ref.get("guid", "")
        if vp_guid:
            topic.viewpoints.append(ParsedViewpoint(guid=vp_guid, index=i))

    # Comments
    for c in d.get("comments", []):
        topic.comments.append(
            ParsedComment(
                guid=c.get("guid", ""),
                text=c.get("comment", ""),
                author=c.get("author", ""),
                date=_parse_dt(c.get("date")) or datetime.now(UTC),
                modified_author=c.get("modified_author"),
                modified_date=_parse_dt(c.get("modified_date")),
                viewpoint_guid=c.get("viewpoint_guid"),
            )
        )

    return topic


# ---------------------------------------------------------------------------
# Serialize
# ---------------------------------------------------------------------------


def serialize_viewpoint_json(vp: ParsedViewpoint) -> bytes:
    """Serialize a viewpoint to BCF 3.0 JSON."""
    d: dict[str, object] = {"guid": vp.guid}

    if vp.camera_type == "perspective":
        d["perspective_camera"] = {
            "camera_view_point": _vec3_to_dict(vp.camera_view_point),
            "camera_direction": _vec3_to_dict(vp.camera_direction),
            "camera_up_vector": _vec3_to_dict(vp.camera_up_vector),
            "field_of_view": vp.field_of_view or 60.0,
        }
    else:
        d["orthogonal_camera"] = {
            "camera_view_point": _vec3_to_dict(vp.camera_view_point),
            "camera_direction": _vec3_to_dict(vp.camera_direction),
            "camera_up_vector": _vec3_to_dict(vp.camera_up_vector),
            "view_to_world_scale": vp.field_of_height or 1.0,
        }

    if vp.components:
        comps: dict[str, object] = {}
        comps["visibility"] = {
            "default_visibility": vp.components.default_visibility,
            "exceptions": [{"ifc_guid": g} for g in vp.components.visibility_exceptions],
        }
        if vp.components.selection:
            comps["selection"] = [{"ifc_guid": g} for g in vp.components.selection]
        d["components"] = comps

    if vp.clipping_planes:
        d["clipping_planes"] = [
            {
                "location": _vec3_to_dict(cp.location),
                "direction": _vec3_to_dict(cp.direction),
            }
            for cp in vp.clipping_planes
        ]

    return json.dumps(d, indent=2).encode("utf-8")


def serialize_topic_json(topic: ParsedTopic) -> bytes:
    """Serialize a topic to BCF 3.0 topic.json."""
    d: dict[str, object] = {
        "guid": topic.guid,
        "title": topic.title,
        "topic_type": topic.topic_type,
        "topic_status": topic.topic_status,
        "creation_author": topic.creation_author,
    }

    if topic.description:
        d["description"] = topic.description
    if topic.priority:
        d["priority"] = topic.priority
    if topic.stage:
        d["stage"] = topic.stage
    if topic.assigned_to:
        d["assigned_to"] = topic.assigned_to
    if topic.labels:
        d["labels"] = topic.labels
    if topic.due_date:
        d["due_date"] = topic.due_date
    if topic.creation_date:
        d["creation_date"] = _dt_str(topic.creation_date)
    if topic.modified_author:
        d["modified_author"] = topic.modified_author
    if topic.modified_date:
        d["modified_date"] = _dt_str(topic.modified_date)
    if topic.reference_links:
        d["reference_links"] = topic.reference_links

    # Viewpoint references
    if topic.viewpoints:
        d["viewpoints"] = [
            {"guid": vp.guid, "viewpoint": f"{vp.guid}.json"}
            for vp in topic.viewpoints
        ]

    # Comments
    if topic.comments:
        comments: list[dict[str, object]] = []
        for c in topic.comments:
            cd: dict[str, object] = {
                "guid": c.guid,
                "comment": c.text,
                "author": c.author,
            }
            dt = _dt_str(c.date)
            if dt:
                cd["date"] = dt
            if c.modified_author:
                cd["modified_author"] = c.modified_author
            if c.modified_date:
                cd["modified_date"] = _dt_str(c.modified_date)
            if c.viewpoint_guid:
                cd["viewpoint_guid"] = c.viewpoint_guid
            comments.append(cd)
        d["comments"] = comments

    return json.dumps(d, indent=2).encode("utf-8")
