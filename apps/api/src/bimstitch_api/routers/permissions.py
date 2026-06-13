"""Project-role permission matrix endpoint.

Serves the `auth/permissions.py` matrix verbatim so the portal can gate its UI
with the *exact* same policy the API enforces — no hand-maintained copy of the
matrix on the frontend, no drift. The payload is static reference data (it only
changes when the matrix in code changes), so it is cacheable and role-agnostic:
any verified user gets the same map. Per-caller context (which role *you* hold on
a given project) is delivered separately via `ProjectRead.my_role`.
"""

from fastapi import APIRouter, Depends, Response

from bimstitch_api.auth.fastapi_users import current_verified_user
from bimstitch_api.auth.permissions import serialize_matrix
from bimstitch_api.cache import CACHE_TTL_JURISDICTIONS, cache_response

router = APIRouter(prefix="/permissions", tags=["permissions"])


@router.get("/matrix", dependencies=[Depends(current_verified_user)])
async def get_permission_matrix(response: Response) -> dict[str, dict[str, list[str]]]:
    """Return the full role -> resource -> actions matrix.

    Reuses the long jurisdictions TTL: like the jurisdictions catalog, this only
    changes on a code deploy, so the portal can cache it aggressively. Auth is
    required (any verified user) but role-agnostic — the matrix is the same for
    everyone.
    """
    cache_response(response, CACHE_TTL_JURISDICTIONS)
    return serialize_matrix()
