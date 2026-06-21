from bimstitch_api.routers.projects._shared import router
from bimstitch_api.routers.projects import crud as crud  # noqa: F401 — registers @router endpoints
from bimstitch_api.routers.projects import members as members  # noqa: F401
from bimstitch_api.routers.projects import invitations as invitations  # noqa: F401

__all__ = ["router"]
