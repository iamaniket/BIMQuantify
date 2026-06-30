"""Back-compat shim. The free-tier Document/File/Finding surface moved to the
`routers.pooled` subpackage; this re-exports the symbols other modules + tests
still import from `routers.pooled_documents`."""

from bimdossier_api.routers.pooled._shared import (
    PooledDocumentCreate as PooledDocumentCreate,
)
from bimdossier_api.routers.pooled._shared import (
    PooledDocumentUpdate as PooledDocumentUpdate,
)
from bimdossier_api.routers.pooled._shared import (
    PooledFindingCreate as PooledFindingCreate,
)
from bimdossier_api.routers.pooled._shared import (
    PooledFindingUpdate as PooledFindingUpdate,
)
from bimdossier_api.routers.pooled._shared import (
    internal_router as internal_router,
)
from bimdossier_api.routers.pooled._shared import (
    router as router,
)
from bimdossier_api.routers.pooled.documents import (
    create_pooled_document as create_pooled_document,
)
from bimdossier_api.routers.pooled.documents import (
    delete_pooled_document as delete_pooled_document,
)
from bimdossier_api.routers.pooled.documents import (
    get_pooled_document as get_pooled_document,
)
from bimdossier_api.routers.pooled.documents import (
    list_pooled_project_documents as list_pooled_project_documents,
)
from bimdossier_api.routers.pooled.documents import (
    update_pooled_document as update_pooled_document,
)
from bimdossier_api.routers.pooled.files import (
    pooled_file_viewer_bundle as pooled_file_viewer_bundle,
)
from bimdossier_api.routers.pooled.files import (
    pooled_project_viewer_bundle as pooled_project_viewer_bundle,
)
