"""Per-project BCF (BIM Collaboration Format) topic CRUD + import/export.

BCF topics are the issue-tracking layer of the IFC viewer. Each topic captures
a viewpoint (camera, visibility, section planes) and a screenshot, plus free-text
comments.  Topics may be linked to compliance findings or models.

Router follows the same tenant-scoped, permission-gated, audit-logged pattern as
``risks.py``.  Snapshot upload uses the two-phase presigned pattern.

This package splits the original single-file router into endpoint groups; the
shared ``router`` instance + helpers live in ``_shared``. Each endpoint module is
imported here for its ``@router`` decorator side effects.
"""

from bimstitch_api.routers.bcf._shared import router

# Import order matters: literal-path routes (/import, /export) must register
# before the /{topic_id} catch-all in `topics`, or FastAPI parses "import"/
# "export" as a UUID path param and 422s. This mirrors the original single-file
# ordering, where import_bcf/export_bcf were defined above get_topic.
from bimstitch_api.routers.bcf import import_export as import_export  # noqa: F401,E402 — registers @router endpoints
from bimstitch_api.routers.bcf import topics as topics  # noqa: F401,E402
from bimstitch_api.routers.bcf import comments as comments  # noqa: F401,E402
from bimstitch_api.routers.bcf import viewpoints as viewpoints  # noqa: F401,E402

__all__ = ["router"]
