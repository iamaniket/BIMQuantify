from bimdossier_api.routers.pooled import documents as documents
from bimdossier_api.routers.pooled import files as files
from bimdossier_api.routers.pooled import findings as findings
from bimdossier_api.routers.pooled import internal as internal
from bimdossier_api.routers.pooled._shared import internal_router, router

__all__ = ["internal_router", "router"]
