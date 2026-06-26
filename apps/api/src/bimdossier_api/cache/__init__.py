from fastapi import Response

from bimdossier_api.cache.client import close_redis, get_redis, get_redis_dep

__all__ = [
    "CACHE_TTL_COMPLIANCE",
    "CACHE_TTL_DOCUMENTS_LIST",
    "CACHE_TTL_DOCUMENT_DETAIL",
    "CACHE_TTL_JURISDICTIONS",
    "CACHE_TTL_PROJECT_DETAIL",
    "CACHE_TTL_PROJECT_LIST",
    "cache_response",
    "close_redis",
    "get_redis",
    "get_redis_dep",
]


def cache_response(
    response: Response,
    max_age_seconds: int = 300,
    is_public: bool = False,
) -> Response:
    """Add Cache-Control headers to a response.

    Args:
        response: FastAPI Response object
        max_age_seconds: TTL in seconds (default 5 minutes)
        is_public: Whether to allow public caching (default private)

    Returns:
        The response with updated Cache-Control header
    """
    cache_type = "public" if is_public else "private"
    response.headers["Cache-Control"] = f"{cache_type}, max-age={max_age_seconds}"
    return response


# Cache TTL recommendations:
# - Project list: 60s (frequently changes with uploads)
# - Project detail: 120s (metadata changes with uploads)
# - Documents list: 60s (frequently added/removed)
# - Document detail: 120s (status changes)
# - Compliance data: 300s (static after check completes)
# - Jurisdictions: 3600s (rarely changes)

CACHE_TTL_PROJECT_LIST = 60
CACHE_TTL_PROJECT_DETAIL = 120
CACHE_TTL_DOCUMENTS_LIST = 60
CACHE_TTL_DOCUMENT_DETAIL = 120
CACHE_TTL_COMPLIANCE = 300
CACHE_TTL_JURISDICTIONS = 3600

