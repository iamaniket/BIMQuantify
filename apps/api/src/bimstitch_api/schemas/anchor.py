"""Shared validation for the generalized anchor used by findings.

The anchor is the trio ``(linked_element_global_id, linked_file_type, geometry)``
alongside the ``linked_model_id`` / ``linked_file_id`` provenance links. The
geometry lives in dedicated scalar columns (no JSONB):

    ``anchor_x``, ``anchor_y``, ``anchor_z`` (float) and ``anchor_page`` (int).

``linked_file_type`` is the single source of truth for which columns are active:

==========  =================================  ===========================
file type   active columns                     meaning
==========  =================================  ===========================
``ifc``     ``anchor_x``/``y``/``z``           3D world coordinates (meters)
``pdf``     ``anchor_page`` + ``anchor_x``/``y``  page >= 1; x, y normalized 0..1
``image``   ``anchor_x``/``y``                 normalized 0..1
``dxf``     ``anchor_x``/``y``                 drawing model-space units
``dwg``     ``anchor_x``/``y``                 drawing model-space units
==========  =================================  ===========================

``linked_file_type`` is stored as a ``String`` + CHECK constraint (never a
Postgres enum) per the CLAUDE.md "Enum evolution rule": the value set is
growable and a Postgres enum is redefined per tenant schema, so adding a value
would be a fan-out migration.
"""

from __future__ import annotations

# The set of anchor file types. Grows over time (DXF/DWG/image already here;
# future formats append). Mirrored as a CHECK constraint on each anchorable
# table and as the Zod ``LinkedFileType`` enum in the portal.
LINKED_FILE_TYPES: frozenset[str] = frozenset({"ifc", "pdf", "dxf", "dwg", "image"})


def validate_linked_anchor(
    linked_file_type: str | None,
    *,
    anchor_x: float | None,
    anchor_y: float | None,
    anchor_z: float | None,
    anchor_page: int | None,
) -> None:
    """Cross-field validation of an anchor's file type and scalar geometry.

    Rules:
      * any anchor coordinate requires a ``linked_file_type``;
      * the coordinates present must match that type's shape — required columns
        present, no stray columns for the type, and ranges respected;
      * a file type without geometry is allowed (entity-only / type-only anchor);
      * everything absent is allowed (unanchored).

    Raises ``ValueError`` with a SCREAMING_SNAKE code on violation
    (``LINKED_FILE_TYPE_INVALID``, ``LINKED_FILE_TYPE_REQUIRED_FOR_POINT``,
    ``LINKED_POINT_SHAPE_MISMATCH``). Callers invoke this from a Pydantic
    ``@model_validator(mode="after")`` so the code surfaces in the 422 envelope.
    The DB CHECK on ``linked_file_type`` is the backstop behind this.
    """
    if linked_file_type is not None and linked_file_type not in LINKED_FILE_TYPES:
        raise ValueError("LINKED_FILE_TYPE_INVALID")

    has_point = any(v is not None for v in (anchor_x, anchor_y, anchor_z, anchor_page))
    if not has_point:
        return
    if linked_file_type is None:
        raise ValueError("LINKED_FILE_TYPE_REQUIRED_FOR_POINT")

    # x and y are required for every anchored type.
    if anchor_x is None or anchor_y is None:
        raise ValueError("LINKED_POINT_SHAPE_MISMATCH")

    if linked_file_type == "ifc":
        # 3D world point: z required, no page.
        if anchor_z is None or anchor_page is not None:
            raise ValueError("LINKED_POINT_SHAPE_MISMATCH")
    elif linked_file_type == "pdf":
        # page >= 1, x/y normalized 0..1, no z.
        if anchor_z is not None or anchor_page is None or anchor_page < 1:
            raise ValueError("LINKED_POINT_SHAPE_MISMATCH")
        if not (0.0 <= anchor_x <= 1.0 and 0.0 <= anchor_y <= 1.0):
            raise ValueError("LINKED_POINT_SHAPE_MISMATCH")
    elif linked_file_type == "image":
        # x/y normalized 0..1, no z, no page.
        if anchor_z is not None or anchor_page is not None:
            raise ValueError("LINKED_POINT_SHAPE_MISMATCH")
        if not (0.0 <= anchor_x <= 1.0 and 0.0 <= anchor_y <= 1.0):
            raise ValueError("LINKED_POINT_SHAPE_MISMATCH")
    else:  # dxf, dwg — drawing model-space x/y, no z, no page.
        if anchor_z is not None or anchor_page is not None:
            raise ValueError("LINKED_POINT_SHAPE_MISMATCH")
