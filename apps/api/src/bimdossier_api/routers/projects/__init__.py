from bimdossier_api.routers.projects import crud as crud
from bimdossier_api.routers.projects import invitations as invitations
from bimdossier_api.routers.projects import members as members
from bimdossier_api.routers.projects import overview as overview
from bimdossier_api.routers.projects._shared import router

__all__ = ["router"]
