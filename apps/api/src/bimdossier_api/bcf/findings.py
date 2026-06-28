"""Map a Bevinding (Finding) to a BCF topic and back.

This is the bridge that lets our snags speak openBIM: a finding exported as a
BCF topic carries its IFC element GlobalId in the viewpoint's component
*selection*, which is exactly what BIMcollab / Solibri / Navisworks read to
re-attach the issue to the right component in the authoring model. Pure
functions (no DB / FastAPI) so they stay unit-testable like the rest of `bcf/`.
"""

from __future__ import annotations

import math
from typing import TYPE_CHECKING
from uuid import uuid4

from bimdossier_api.bcf.types import (
    BcfComponents,
    ParsedComment,
    ParsedTopic,
    ParsedViewpoint,
    Vec3,
)
from bimdossier_api.models.finding import FindingSeverity, FindingStatus

if TYPE_CHECKING:
    from datetime import datetime

# Finding lifecycle → BCF topic status. BCF has no notion of our `draft`
# (unpublished) vs `open`; both surface as the coordination-standard "Open".
_STATUS_TO_BCF: dict[FindingStatus, str] = {
    FindingStatus.draft: "Open",
    FindingStatus.open: "Open",
    FindingStatus.in_progress: "In Progress",
    FindingStatus.resolved: "Resolved",
    FindingStatus.verified: "Closed",
}
_BCF_TO_STATUS: dict[str, FindingStatus] = {
    "open": FindingStatus.open,
    "in progress": FindingStatus.in_progress,
    "inprogress": FindingStatus.in_progress,
    "resolved": FindingStatus.resolved,
    "closed": FindingStatus.verified,
}

_SEVERITY_TO_PRIORITY: dict[FindingSeverity, str] = {
    FindingSeverity.low: "Low",
    FindingSeverity.medium: "Normal",
    FindingSeverity.high: "High",
}

# Default camera stand-off (metres) when a finding carries a 3D anchor point —
# pull the camera back along a diagonal so the selected element frames nicely.
_CAMERA_STANDOFF_M = 8.0


def _normalize(v: Vec3) -> Vec3:
    length = math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z)
    if length == 0:
        return Vec3(0.0, 0.0, -1.0)
    return Vec3(v.x / length, v.y / length, v.z / length)


def _element_viewpoint(
    global_id: str, anchor: Vec3 | None
) -> ParsedViewpoint:
    """A viewpoint that SELECTS the element by GlobalId (the re-attach payload).

    When the finding has a 3D anchor point we also frame a camera looking at it
    (Y-up — this codebase is Y-up); without one we still emit the selection so
    the importing tool can re-attach, with a neutral camera.
    """
    components = BcfComponents(default_visibility=True, selection=[global_id])
    if anchor is not None:
        eye = Vec3(
            anchor.x + _CAMERA_STANDOFF_M,
            anchor.y + _CAMERA_STANDOFF_M,
            anchor.z + _CAMERA_STANDOFF_M,
        )
        direction = _normalize(Vec3(anchor.x - eye.x, anchor.y - eye.y, anchor.z - eye.z))
        return ParsedViewpoint(
            guid=str(uuid4()),
            camera_type="perspective",
            camera_view_point=eye,
            camera_direction=direction,
            camera_up_vector=Vec3(0.0, 1.0, 0.0),
            field_of_view=60.0,
            components=components,
        )
    return ParsedViewpoint(
        guid=str(uuid4()),
        camera_type="perspective",
        camera_view_point=Vec3(0.0, 0.0, 0.0),
        camera_direction=Vec3(0.0, 0.0, -1.0),
        camera_up_vector=Vec3(0.0, 1.0, 0.0),
        field_of_view=60.0,
        components=components,
    )


def finding_to_parsed_topic(
    *,
    finding_id: str,
    title: str,
    description: str,
    status: FindingStatus,
    severity: FindingSeverity,
    created_at: datetime,
    bbl_article_ref: str | None = None,
    deadline_date: str | None = None,
    assignee_email: str | None = None,
    creator_email: str | None = None,
    linked_element_global_id: str | None = None,
    anchor: Vec3 | None = None,
    comments: list[ParsedComment] | None = None,
) -> ParsedTopic:
    """Build a BCF topic from a finding's fields.

    The topic `guid` is the finding id, so a re-import round-trips to the same
    identity. A linked IFC element becomes a selection viewpoint (re-attach); the
    bbl article becomes a label; the assignee email maps to `assigned_to`.
    """
    viewpoints: list[ParsedViewpoint] = []
    if linked_element_global_id:
        viewpoints.append(_element_viewpoint(linked_element_global_id, anchor))
    return ParsedTopic(
        guid=finding_id,
        title=title,
        description=description or "",
        topic_type="Issue",
        topic_status=_STATUS_TO_BCF.get(status, "Open"),
        priority=_SEVERITY_TO_PRIORITY.get(severity),
        assigned_to=assignee_email,
        labels=[bbl_article_ref] if bbl_article_ref else [],
        due_date=deadline_date,
        creation_author=creator_email or "",
        creation_date=created_at,
        viewpoints=viewpoints,
        comments=comments or [],
    )


def parsed_topic_to_finding_fields(topic: ParsedTopic) -> dict[str, object]:
    """Extract create-a-draft-finding fields from an imported BCF topic.

    Pulls the IFC GlobalId out of the first viewpoint's component selection so
    the imported finding re-anchors to the same element. Imported findings always
    start as `draft` (a human triages before promotion); we never trust an
    inbound BCF to set our lifecycle past draft.
    """
    global_id: str | None = None
    for vp in topic.viewpoints:
        if vp.components and vp.components.selection:
            global_id = vp.components.selection[0]
            break
    fields: dict[str, object] = {
        "title": (topic.title or "Untitled")[:255],
        "description": topic.description or topic.title or "(imported from BCF)",
    }
    if global_id:
        fields["linked_element_global_id"] = global_id[:255]
    return fields
