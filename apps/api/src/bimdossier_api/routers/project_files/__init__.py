from bimdossier_api.routers.project_files._shared import router, project_viewer_router
from bimdossier_api.routers.project_files import upload as upload  # noqa: F401 — registers @router endpoints
from bimdossier_api.routers.project_files import access as access  # noqa: F401 — registers @router endpoints

__all__ = ["router", "project_viewer_router"]
